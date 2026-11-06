/**
 * P43: inputs are three reference types (graphic, audio, tracker; the older names scene, beat, track map onto them via
 * refType). A tracker reference may also name a tracker that is not set yet — "clip:<clipId>#@<name>" — which a
 * storyboard writes; it resolves as soon as a tracker with that name exists on the clip (until then found:false).
 *
 * P38 (item 5): where a code clip's `inputs` read from. A beat input listens to the Mix (default), an audio-carrying
 * track or one clip; a scene input looks at the Program (default: the picture under the clip), a video track or one
 * clip. Bindings store ids ("track:<id>", "clip:<id>"); names are only shown and used to resolve what an AI asks for.
 */
import type { Composition, Placement, Project, Track } from "./model";
import { refType, type InputType, type RefType } from "./htmlClipPackage";
import { parseTrackSource, trackedClips, tracksOf } from "./tracking";

const DEFAULTS: Record<RefType, string> = { audio: "mix", graphic: "program", tracker: "none" };
export const DEFAULT_SOURCE: Record<InputType, string> = { ...DEFAULTS, beat: "mix", scene: "program", track: "none" };
export interface SourceChoice { source: string; label: string; kind: "mix" | "program" | "none" | "track" | "clip"; trackId?: string }

const root = (p: Project): Composition => p.compositions[p.rootCompositionId];
const hearable = (t: Track) => t.kind === "audio" || t.kind === "video";
const visible = (t: Track) => t.kind === "video";
const clipName = (p: Project, pl: Placement) => p.assets[pl.source.assetId]?.name?.replace(/\.[a-z0-9]+$/i, "") || pl.id;

/** The source an input of this clip reads (its binding when still valid, else the default). */
export function inputSourceOf(p: Project, pl: Placement, name: string, type: InputType): string {
  const s = pl.htmlInputs?.[name];
  if (s && refType(type) === "tracker" && pendingTracker(s)) return namedTracker(p, s) ?? DEFAULT_SOURCE[type];
  return s && sourceIssue(p, s, type) === undefined ? s : DEFAULT_SOURCE[type];
}

/** P43: "clip:<clipId>#@<name>" — a tracker referenced by name (set later by the user). */
export const pendingTracker = (source: string): { clipId: string; name: string } | undefined => {
  const m = /^clip:([^#]+)#@(.+)$/.exec(source);
  return m ? { clipId: m[1], name: m[2] } : undefined;
};
/** The concrete "clip:<id>#<trackId>" a named tracker reference points at now, else undefined (not set yet). */
export function namedTracker(p: Project, source: string): string | undefined {
  const r = pendingTracker(source); if (!r) return undefined;
  const pl = root(p).tracks.flatMap((t) => t.placements).find((x) => x.id === r.clipId);
  const tr = pl && tracksOf(pl).find((t) => t.name.trim().toLowerCase() === r.name.trim().toLowerCase());
  return tr ? `clip:${r.clipId}#${tr.id}` : undefined;
}
/** P43: tracker references that name a tracker nobody has set yet: { clip, input, name } per code clip input. */
export function missingTrackers(p: Project): { clipId: string; input: string; targetId: string; name: string }[] {
  return root(p).tracks.flatMap((t) => t.placements).flatMap((pl) => Object.entries(pl.htmlInputs ?? {}).flatMap(([input, s]) => {
    const r = pendingTracker(s);
    return r && !namedTracker(p, s) ? [{ clipId: pl.id, input, targetId: r.clipId, name: r.name }] : [];
  }));
}

/** Everything a beat or scene input can read, in display order: the default, then each track and its clips. */
export function sourceChoices(p: Project, input: InputType, self?: string): SourceChoice[] {
  const type = refType(input);
  if (type === "tracker") return [{ source: "none", label: "None", kind: "none" }, ...trackedClips(p).filter((c) => c.id !== self).flatMap((c) => tracksOf(c).map((tr) => ({ source: `clip:${c.id}#${tr.id}`, label: `${clipName(p, c)} · ${tr.name}`, kind: "clip" as const, trackId: root(p).tracks.find((t) => t.placements.includes(c))?.id })))];
  const out: SourceChoice[] = [{ source: DEFAULTS[type], label: type === "audio" ? "Mix" : "Program", kind: type === "audio" ? "mix" : "program" }];
  for (const t of root(p).tracks) {
    if (!(type === "audio" ? hearable(t) : visible(t))) continue;
    out.push({ source: `track:${t.id}`, label: t.name, kind: "track", trackId: t.id });
    for (const c of t.placements) {
      if (c.id === self || c.placeholder || c.clipType === "text" || c.clipType === "effect") continue;
      if (type === "audio" && c.clipType !== "audio" && c.clipType !== "video") continue;
      if (type === "graphic" && c.clipType === "audio") continue;
      out.push({ source: `clip:${c.id}`, label: clipName(p, c), kind: "clip", trackId: t.id });
    }
  }
  return out;
}

/** A readable name for a source ("Mix", a track's current name, a clip's asset name). */
export function sourceLabel(p: Project, source: string): string {
  if (source === "mix") return "Mix";
  if (source === "program") return "Program";
  if (source === "none") return "None";
  const [k, id] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
  const c = root(p);
  if (k === "track") return c.tracks.find((t) => t.id === id)?.name ?? "Missing track";
  const pend = pendingTracker(source);
  if (pend) { const pl = c.tracks.flatMap((t) => t.placements).find((x) => x.id === pend.clipId); return `${pl ? clipName(p, pl) : "Missing clip"} · ${pend.name}${namedTracker(p, source) ? "" : " (not set yet)"}`; }
  const mt = parseTrackSource(source);
  if (mt?.trackId) { const pl = c.tracks.flatMap((t) => t.placements).find((x) => x.id === mt.clipId), tr = pl && tracksOf(pl).find((x) => x.id === mt.trackId); return pl && tr ? `${clipName(p, pl)} · ${tr.name}` : "Missing tracker"; }
  const pl = c.tracks.flatMap((t) => t.placements).find((x) => x.id === id);
  return pl ? clipName(p, pl) : "Missing clip";
}

/** Why `source` can't feed a `type` input, else undefined. */
export function sourceIssue(p: Project, source: string, input: InputType): string | undefined {
  const type = refType(input);
  if (source === DEFAULTS[type]) return undefined;
  if (source === "none" || source === "mix" || source === "program") return `"${source}" is for ${source === "mix" ? "audio" : source === "none" ? "tracker" : "graphic"} references.`;
  if (type === "tracker" && pendingTracker(source)) return root(p).tracks.some((t) => t.placements.some((x) => x.id === pendingTracker(source)!.clipId)) ? undefined : `No clip "${pendingTracker(source)!.clipId}".`;
  return sourceChoices(p, type).some((c) => c.source === source) ? undefined : `No ${what(type)} "${source}".`;
}

/**
 * Resolve what an agent passes: "mix" / "program", "track:<id>" / "clip:<id>", a bare track or clip id, or a track
 * name (case-insensitive; must be unique).
 */
export function resolveSource(p: Project, raw: string, input: InputType): { source: string } | { error: string } {
  const type = refType(input);
  const v = raw.trim(), low = v.toLowerCase();
  if (low === "mix" || low === "program" || low === "none") { const e = sourceIssue(p, low, type); return e ? { error: e } : { source: low }; }
  const choices = sourceChoices(p, type);
  const direct = choices.find((c) => c.source === v || c.source === `track:${v}` || c.source === `clip:${v}`);
  if (direct) return { source: direct.source };
  const named = choices.filter((c) => c.kind === "track" && c.label.toLowerCase() === low);
  if (named.length === 1) return { source: named[0].source };
  if (named.length > 1) return { error: `Several tracks are named "${v}"; pass "track:<id>" (get_timeline lists track ids) or rename one with rename_track.` };
  if (type === "tracker") {
    if (pendingTracker(v)) { const e = sourceIssue(p, v, type); return e ? { error: e } : { source: namedTracker(p, v) ?? v }; }
    const ref = parseTrackSource(v.startsWith("clip:") ? v : `clip:${v}`), pl = ref && root(p).tracks.flatMap((t) => t.placements).find((x) => x.id === ref.clipId);
    const ts = pl ? tracksOf(pl) : [];
    if (ts.length > 1 && !ref?.trackId) return { error: `Clip ${ref!.clipId} has ${ts.length} trackers: pass "clip:${ref!.clipId}#<trackId>" (${ts.map((t) => `${t.id} "${t.name}"`).join(", ")}).` };
    if (ts.length === 1 && !ref?.trackId) return { source: `clip:${ref!.clipId}#${ts[0].id}` };
    if (pl && ref?.trackId) { const byName = ts.find((t) => t.name.toLowerCase() === ref.trackId!.toLowerCase()); if (byName) return { source: `clip:${pl.id}#${byName.id}` }; }
    return { error: `No tracked clip matches "${v}". Use "none", "clip:<clip id>#<tracker id>" (get_timeline lists trackers on a clip) or "clip:<clip id>#@<tracker name>" for a tracker the user will set.` };
  }
  return { error: `No ${what(type)} matches "${v}". Use "${DEFAULTS[type]}", a track name, "track:<id>" or "clip:<id>".` };
}

const what = (type: RefType) => (type === "audio" ? "track or clip with sound" : type === "tracker" ? "tracker" : "video track or clip");
