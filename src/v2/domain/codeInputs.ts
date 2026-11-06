/**
 * P38 (item 5): where a code clip's `inputs` read from. A beat input listens to the Mix (default), an audio-carrying
 * track or one clip; a scene input looks at the Program (default: the picture under the clip), a video track or one
 * clip. Bindings store ids ("track:<id>", "clip:<id>"); names are only shown and used to resolve what an AI asks for.
 */
import type { Composition, Placement, Project, Track } from "./model";
import type { InputType } from "./htmlClipPackage";

export const DEFAULT_SOURCE: Record<InputType, string> = { beat: "mix", scene: "program" };
export interface SourceChoice { source: string; label: string; kind: "mix" | "program" | "track" | "clip"; trackId?: string }

const root = (p: Project): Composition => p.compositions[p.rootCompositionId];
const hearable = (t: Track) => t.kind === "audio" || t.kind === "video";
const visible = (t: Track) => t.kind === "video";
const clipName = (p: Project, pl: Placement) => p.assets[pl.source.assetId]?.name?.replace(/\.[a-z0-9]+$/i, "") || pl.id;

/** The source an input of this clip reads (its binding when still valid, else the default). */
export function inputSourceOf(p: Project, pl: Placement, name: string, type: InputType): string {
  const s = pl.htmlInputs?.[name];
  return s && sourceIssue(p, s, type) === undefined ? s : DEFAULT_SOURCE[type];
}

/** Everything a beat or scene input can read, in display order: the default, then each track and its clips. */
export function sourceChoices(p: Project, type: InputType, self?: string): SourceChoice[] {
  const out: SourceChoice[] = [{ source: DEFAULT_SOURCE[type], label: type === "beat" ? "Mix" : "Program", kind: type === "beat" ? "mix" : "program" }];
  for (const t of root(p).tracks) {
    if (!(type === "beat" ? hearable(t) : visible(t))) continue;
    out.push({ source: `track:${t.id}`, label: t.name, kind: "track", trackId: t.id });
    for (const c of t.placements) {
      if (c.id === self || c.placeholder || c.clipType === "text" || c.clipType === "effect") continue;
      if (type === "beat" && c.clipType !== "audio" && c.clipType !== "video") continue;
      if (type === "scene" && c.clipType === "audio") continue;
      out.push({ source: `clip:${c.id}`, label: clipName(p, c), kind: "clip", trackId: t.id });
    }
  }
  return out;
}

/** A readable name for a source ("Mix", a track's current name, a clip's asset name). */
export function sourceLabel(p: Project, source: string): string {
  if (source === "mix") return "Mix";
  if (source === "program") return "Program";
  const [k, id] = [source.slice(0, source.indexOf(":")), source.slice(source.indexOf(":") + 1)];
  const c = root(p);
  if (k === "track") return c.tracks.find((t) => t.id === id)?.name ?? "Missing track";
  const pl = c.tracks.flatMap((t) => t.placements).find((x) => x.id === id);
  return pl ? clipName(p, pl) : "Missing clip";
}

/** Why `source` can't feed a `type` input, else undefined. */
export function sourceIssue(p: Project, source: string, type: InputType): string | undefined {
  if (source === DEFAULT_SOURCE[type]) return undefined;
  if (source === "mix" || source === "program") return `"${source}" is for ${source === "mix" ? "beat" : "scene"} inputs.`;
  return sourceChoices(p, type).some((c) => c.source === source) ? undefined : `No ${type === "beat" ? "track or clip with sound" : "video track or clip"} "${source}".`;
}

/**
 * Resolve what an agent passes: "mix" / "program", "track:<id>" / "clip:<id>", a bare track or clip id, or a track
 * name (case-insensitive; must be unique).
 */
export function resolveSource(p: Project, raw: string, type: InputType): { source: string } | { error: string } {
  const v = raw.trim(), low = v.toLowerCase();
  if (low === "mix" || low === "program") { const e = sourceIssue(p, low, type); return e ? { error: e } : { source: low }; }
  const choices = sourceChoices(p, type);
  const direct = choices.find((c) => c.source === v || c.source === `track:${v}` || c.source === `clip:${v}`);
  if (direct) return { source: direct.source };
  const named = choices.filter((c) => c.kind === "track" && c.label.toLowerCase() === low);
  if (named.length === 1) return { source: named[0].source };
  if (named.length > 1) return { error: `Several tracks are named "${v}"; pass "track:<id>" (get_timeline lists track ids) or rename one with rename_track.` };
  return { error: `No ${type === "beat" ? "track or clip with sound" : "video track or clip"} matches "${v}". Use "${DEFAULT_SOURCE[type]}", a track name, "track:<id>" or "clip:<id>".` };
}
