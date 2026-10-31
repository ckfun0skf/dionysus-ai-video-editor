/**
 * P10-SYNC "Sync to Storyboard": writes timeline edits back to the board (the inverse of Send to Timeline).
 * - A main-track clip sent from a shot (`storyShot`) writes its length (`durationSec`), its place in the order and its
 *   trim (the shot asset's version trim) back to the shot; its linked clips write back layers (`storyLayer`), effects
 *   and audio cues (`storyCue`: start, length, volume).
 * - A main-track clip with no shot becomes a new shot; another clip with no storyboard origin becomes a layer (or, for
 *   audio, a cue) of the shot of its link parent (else the main clip under its start). Both are flagged `needsPrompt`
 *   (the AI must describe them), and are tagged on the timeline so the next sync updates them in place.
 * - A shot, layer or cue whose clip is gone from the timeline is never deleted: it is flagged `removedFromTimeline`
 *   (and comes back unflagged when its clip is back).
 * `syncPlan` returns the new project and a list of changes for the review sheet; nothing changes until it is applied.
 */
import type { Composition, Placement, Project } from "./model";
import { mainTrack } from "./ops";
import { normTrim, versionSpan, type AssetSlot, type Storyboard } from "./storyboard";
import { boxTransform, recordSent, captionText } from "./storySend";
import type { StoryAudio, StoryEffect, StoryLayer, StoryMediaLayer, StoryTextLayer } from "./storyJson";
import { getPreset, parsePresetRef } from "../registry";
import { TICKS_PER_SECOND } from "./time";

export type SyncChangeKind = "shot" | "newShot" | "removedShot" | "layer" | "newLayer" | "removedLayer" | "effects" | "cue" | "newCue" | "removedCue" | "order" | "trim";
export interface SyncChange { kind: SyncChangeKind; id: string; label: string; needsPrompt?: boolean }
export interface SyncPlan { project: Project; changes: SyncChange[] }

const sec = (t: number) => Math.round((t / TICKS_PER_SECOND) * 100) / 100;
const end = (p: Placement) => p.startTicks + p.durationTicks;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clampDur = (s: number) => Math.min(120, Math.max(0.5, s));

function uniqueId(base: string, taken: (id: string) => boolean): string {
  for (let i = 1; ; i++) { const id = `${base}${i}`; if (!taken(id)) return id; }
}

/** The board slot of a project asset, or a new "upload" slot for it (no prompt needed: the asset is the upload). */
function slotFor(b: Storyboard, p: Project, assetId: string): string {
  const hit = Object.values(b.slots).find((s) => s.assetId === assetId && !s.keyframeOf);
  if (hit) return hit.id;
  const a = p.assets[assetId];
  const type: AssetSlot["type"] = a?.kind === "video" ? "video" : a?.kind === "audio" ? "audio" : a?.kind === "html" ? "html" : "image";
  const id = uniqueId("tl-asset-", (x) => !!b.slots[x]);
  b.slots[id] = { id, name: a?.name ?? id, type, aspect: b.meta.aspect, prompt: "", references: [], source: { type: "upload" }, qa: [], assetId };
  return id;
}

function effectOf(pl: Placement, start: number, len: number, old: StoryEffect | undefined): StoryEffect {
  const e = pl.effect!;
  const keepRef = old && parsePresetRef(old.preset)?.id === e.preset;
  const s = sec(pl.startTicks - start), en = sec(end(pl) - start);
  return {
    preset: keepRef ? old!.preset : e.preset, ...(e.params && Object.keys(e.params).length ? { params: structuredClone(e.params) as StoryEffect["params"] } : {}),
    ...(s > 0 ? { startSec: s } : {}), ...(en < sec(len) ? { endSec: en } : {}), ...(e.applyTo && e.applyTo !== "main" ? { applyTo: e.applyTo } : {}),
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/**
 * P13: layer box (frame fractions) of a media clip's transform — the inverse of Send's `boxTransform`: scale 1 is the
 * medium contain-fit to the frame, centred at the x/y offsets.
 */
function boxOf(p: Project, pl: Placement) {
  const v = p.assets[pl.source.assetId]?.versions.find((x) => x.id === pl.source.versionId);
  const fw = p.settings.width, fh = p.settings.height, mw = v?.media.width ?? fw, mh = v?.media.height ?? fh;
  const ma = mw > 0 && mh > 0 ? mw / mh : fw / fh, fa = fw / fh;
  const fitW = ma >= fa ? 1 : ma / fa, fitH = ma >= fa ? fa / ma : 1;
  const sc = pl.transform?.scale ?? 1, x = pl.transform?.x ?? 0, y = pl.transform?.y ?? 0;
  const w = sc * fitW, h = sc * fitH;
  return { x: r3(x + 0.5 - w / 2), y: r3(y + 0.5 - h / 2), width: r3(w), height: r3(h) };
}
const near = (a: object | undefined, b: object) => !!a && Object.entries(b).every(([k, v]) => Math.abs(((a as Record<string, number>)[k] ?? NaN) - (v as number)) < 0.002);

/** P13: the shot dialogue after its caption clip's text was edited (per line when the line count still matches). */
function writeCaption(s: Storyboard["shots"][string], text: string) {
  const parts = text.split("\n");
  if (s.lines?.length && s.lines.length === parts.length) s.lines = s.lines.map((l, i) => ({ ...l, text: parts[i] }));
  else { delete s.lines; s.dialogue = text; }
}

/** Compute what Sync to Storyboard would change. */
export function syncPlan(p: Project): SyncPlan {
  const b0 = p.storyboard;
  if (!b0) return { project: p, changes: [] };
  const b: Storyboard = structuredClone(b0);
  const changes: SyncChange[] = [];
  let comp: Composition = structuredClone(p.compositions[p.rootCompositionId]);
  const main = mainTrack(comp);
  const mainClips = [...(main?.placements ?? [])].sort((x, y) => x.startTicks - y.startTicks);
  const others = comp.tracks.filter((t) => t !== main).flatMap((t) => t.placements);

  // 1. Main clips → shots (existing or new).
  const shotOfClip = new Map<string, string>();
  const seen = new Set<string>();
  for (const pl of mainClips) {
    if (pl.storyShot && b.shots[pl.storyShot] && !seen.has(pl.storyShot)) { seen.add(pl.storyShot); shotOfClip.set(pl.id, pl.storyShot); continue; }
    if (pl.clipType === "text" || pl.clipType === "effect") continue;
    const id = uniqueId("shot-tl-", (x) => !!b.shots[x]);
    const a = p.assets[pl.source.assetId];
    b.shots[id] = { id, title: a?.name ?? "New shot", description: "", durationSec: clampDur(sec(pl.durationTicks)), prompt: "", slotIds: [], qa: [], ...(a ? { assetId: a.id } : {}), needsPrompt: true };
    pl.storyShot = id; seen.add(id); shotOfClip.set(pl.id, id);
    changes.push({ kind: "newShot", id, label: `New shot "${b.shots[id].title}" from the timeline`, needsPrompt: true });
  }
  const clipOfShot = new Map([...shotOfClip].map(([c, s]) => [s, mainClips.find((x) => x.id === c)!]));

  // 2. Order: timeline order fills the places of shots on the timeline; new shots follow the shot before them.
  const tl = mainClips.flatMap((pl) => (shotOfClip.has(pl.id) ? [shotOfClip.get(pl.id)!] : []));
  const groups: string[][] = [];
  for (const id of tl) { if (b0.shots[id] || !groups.length) groups.push([id]); else groups.at(-1)!.push(id); }
  if (groups.length && !b0.shots[groups[0][0]] && groups.length > 1) { groups[1].unshift(...groups[0]); groups.shift(); }
  const onTl = new Set(tl);
  const order: string[] = [];
  let g = 0;
  for (const id of b.order) { if (onTl.has(id) && b0.shots[id]) order.push(...(groups[g++] ?? [])); else order.push(id); }
  while (g < groups.length) order.push(...groups[g++]);
  if (!eq(order, b.order)) { b.order = order; changes.push({ kind: "order", id: "order", label: "Shot order follows the timeline" }); }

  // 3. Each shot on the timeline: length and trim; removed shots flagged.
  for (const id of b.order) {
    const s = b.shots[id], clip = clipOfShot.get(id), isNew = !b0.shots[id];
    if (!clip) {
      if (!s.removedFromTimeline && s.assetId && (b0.sent?.shots[id] !== undefined)) { s.removedFromTimeline = true; changes.push({ kind: "removedShot", id, label: `"${s.title}" removed from timeline (kept on the board)` }); }
      continue;
    }
    if (s.removedFromTimeline) { delete s.removedFromTimeline; changes.push({ kind: "shot", id, label: `"${s.title}" is back on the timeline` }); }
    if (isNew) continue;
    const d = clampDur(sec(clip.durationTicks));
    // A video clip still at the length Send placed it (its version's trim, else the whole clip) was not edited:
    // keep the planned durationSec (Send places video shots at their clip length, not durationSec).
    const a0 = p.assets[clip.source.assetId], v0 = a0?.versions.find((x) => x.id === clip.source.versionId);
    const asSent = !s.clipSlot && a0?.kind === "video" && !!v0 && clip.durationTicks === (versionSpan(b0, v0)?.lenTicks ?? v0.media.durationTicks) && (clip.speed ?? 1) === 1;
    if (!asSent && Math.abs(d - s.durationSec) >= 0.01) { changes.push({ kind: "shot", id, label: `"${s.title}" length ${s.durationSec}s → ${d}s` }); s.durationSec = d; }
    const a = p.assets[clip.source.assetId], v = a?.versions.find((x) => x.id === clip.source.versionId), info = b.versions[clip.source.versionId];
    if (!s.render && s.clipSlot && a?.kind === "video") {
      // P16: a shot that shares a clip keeps its own in point; the clip's trim belongs to every shot using it.
      const inSec = Math.round(sec(clip.sourceInTicks) * 100) / 100;
      if (Math.abs(inSec - (s.clipInSec ?? 0)) >= 0.01) {
        changes.push({ kind: "shot", id, label: `"${s.title}" clip in point ${s.clipInSec ?? 0}s → ${inSec}s` });
        if (inSec > 0) s.clipInSec = inSec; else delete s.clipInSec;
      }
    } else if (v?.media.durationTicks && info && (a.kind === "video") && !clip.freeze && !clip.reverse) {
      const t = normTrim({ inTicks: clip.sourceInTicks, outTicks: Math.min(v.media.durationTicks, clip.sourceInTicks + Math.round(clip.durationTicks * (clip.speed ?? 1))) }, v.media.durationTicks);
      if (!eq(t, normTrim(info.trim, v.media.durationTicks))) {
        if (t) info.trim = t; else delete info.trim;
        changes.push({ kind: "trim", id, label: `"${s.title}" trim ${t ? `${sec(t.inTicks)}s–${sec(t.outTicks)}s` : "cleared"}` });
      }
    }
  }

  // 4. Non-main clips → layers, effects, cues of their shot.
  const parentShot = (pl: Placement): string | undefined => {
    const anchor = pl.link?.parent ?? pl.storyLink?.anchor;
    const viaLink = anchor ? shotOfClip.get(anchor) : undefined;
    if (viaLink) return viaLink;
    const under = mainClips.find((m) => m.startTicks <= pl.startTicks && pl.startTicks < end(m));
    return under ? shotOfClip.get(under.id) : undefined;
  };
  const effectsBy = new Map<string, Placement[]>();
  const layerSeen = new Set<string>(), cueSeen = new Set<string>(), captionSeen = new Set<string>();
  for (const pl of others.sort((x, y) => x.startTicks - y.startTicks)) {
    const shotId = parentShot(pl);
    if (pl.clipType === "audio") {
      const cue = pl.storyCue ? b.audio?.find((c) => c.id === pl.storyCue) : undefined;
      const from = cue ? cue.from : shotId;
      const fromClip = from ? clipOfShot.get(from) : undefined;
      if (!from || !fromClip) continue;
      const at = Math.max(0, sec(pl.startTicks - fromClip.startTicks)), dur = sec(pl.durationTicks), vol = Math.round((pl.volume ?? 1) * 100) / 100;
      if (cue) {
        cueSeen.add(cue.id);
        const next: StoryAudio = { ...cue, atSec: at, ...(cue.to ? {} : { durationSec: dur }), volume: vol };
        if (next.removedFromTimeline) delete next.removedFromTimeline;
        if (!eq(next, cue)) { Object.assign(cue, next); if (!next.removedFromTimeline) delete cue.removedFromTimeline; changes.push({ kind: "cue", id: cue.id, label: `Audio cue "${cue.id}" at ${at}s for ${dur}s, volume ${vol}` }); }
        continue;
      }
      const id = uniqueId("cue-tl-", (x) => !!b.audio?.some((c) => c.id === x));
      b.audio = [...(b.audio ?? []), { id, asset: slotFor(b, p, pl.source.assetId), kind: "sfx", from, atSec: at, durationSec: dur, volume: vol, needsPrompt: true }];
      pl.storyCue = id; cueSeen.add(id);
      changes.push({ kind: "newCue", id, label: `New audio cue "${id}" on "${b.shots[from].title}"`, needsPrompt: true });
      continue;
    }
    if (!shotId) continue;
    const clip = clipOfShot.get(shotId)!, s = b.shots[shotId];
    if (pl.clipType === "effect") { if (pl.effect) effectsBy.set(shotId, [...(effectsBy.get(shotId) ?? []), pl]); continue; }
    if (pl.storyLayer === "captions" || (pl.clipType === "text" && s.captions && pl.storyLink && !pl.storyLayer && pl.text?.text === captionText(s))) {
      captionSeen.add(shotId);
      const t = (pl.text?.text ?? "").trim();
      if (s.captions && t && t !== captionText(s)) { writeCaption(s, t); changes.push({ kind: "layer", id: `${shotId}/captions`, label: `Captions of "${s.title}": "${t.slice(0, 40)}"` }); }
      continue;
    }
    const startSec = Math.max(0, sec(pl.startTicks - clip.startTicks)), endSec = sec(end(pl) - clip.startTicks);
    const layers = (s.layers ??= []);
    let l = pl.storyLayer ? layers.find((x) => x.id === pl.storyLayer) : undefined;
    // Clips sent before P10 have no storyLayer: match by text / asset among this shot's layers.
    if (!l && !pl.storyLayer && pl.storyLink) l = layers.find((x) => !layerSeen.has(`${shotId}/${x.id}`) && (x.type === "text" ? pl.clipType === "text" && x.text === pl.text?.text : b.slots[x.asset]?.assetId === pl.source.assetId));
    const opacity = pl.transform?.opacity;
    if (l) {
      layerSeen.add(`${shotId}/${l.id}`);
      const next = { ...l, startSec, endSec, ...(l.type === "text" && pl.text ? { text: pl.text.text } : {}), ...(opacity !== undefined && opacity !== 1 ? { opacity } : {}) } as StoryLayer;
      // P13: write back where the layer is — a media layer's box, a text layer's position (or its box, moved).
      if (next.type === "text") {
        const t = next as StoryTextLayer, cx = r3((pl.transform?.x ?? 0) + 0.5), cy = r3((pl.transform?.y ?? 0) + 0.5);
        if (t.box) { const nb = { ...t.box, x: r3(cx - t.box.width / 2), y: r3(cy - t.box.height / 2) }; if (!near(t.box, nb)) t.box = nb; }
        else if (t.position || cx !== 0.5 || cy !== 0.5) { const np = { x: cx, y: cy }; if (!near(t.position, np)) t.position = np; }
      } else if ((next as StoryMediaLayer).box) {
        // Only when the clip moved / resized from where the layer's box puts it (a box of another aspect than the
        // medium is contain-fitted by Send, so its box is not the fitted one).
        const m = next as StoryMediaLayer, v = p.assets[pl.source.assetId]?.versions.find((x) => x.id === pl.source.versionId);
        const want = boxTransform(m.box, v?.media.width ?? p.settings.width, v?.media.height ?? p.settings.height, p.settings.width, p.settings.height);
        const tf = { x: pl.transform?.x ?? 0, y: pl.transform?.y ?? 0, scale: pl.transform?.scale ?? 1 };
        if (!near(tf, { x: want.x ?? 0, y: want.y ?? 0, scale: want.scale ?? 1 })) m.box = boxOf(p, pl);
      }
      if (opacity === undefined || opacity === 1) delete next.opacity;
      delete next.removedFromTimeline;
      pl.storyLayer = l.id;
      if (!eq(next, l)) { Object.assign(l, next); if (!next.opacity) delete l.opacity; delete l.removedFromTimeline; changes.push({ kind: "layer", id: `${shotId}/${l.id}`, label: `Layer "${l.id}" of "${s.title}": ${startSec}s–${endSec}s${eq(l.box, (next as StoryMediaLayer).box) && eq((l as StoryTextLayer).position, (next as StoryTextLayer).position) ? "" : ", moved"}` }); }
      continue;
    }
    const id = uniqueId("tl-layer-", (x) => layers.some((y) => y.id === x));
    const base = { id, startSec, endSec, needsPrompt: true as const, ...(opacity !== undefined && opacity !== 1 ? { opacity } : {}) };
    let nl: StoryLayer;
    if (pl.clipType === "text") nl = { ...base, type: "text", text: pl.text?.text ?? "" } as StoryTextLayer;
    else nl = { ...base, type: pl.clipType === "video" ? "video" : pl.clipType === "html" ? "html" : "image", asset: slotFor(b, p, pl.source.assetId), box: boxOf(p, pl) } as StoryMediaLayer;
    layers.push(nl); layerSeen.add(`${shotId}/${id}`); pl.storyLayer = id;
    if (!pl.link) pl.link = { parent: clip.id };
    changes.push({ kind: "newLayer", id: `${shotId}/${id}`, label: `New ${nl.type} layer "${id}" on "${s.title}"`, needsPrompt: true });
  }

  // 5. Effects per shot on the timeline (unknown presets, never sent, are kept); layers and cues no longer there are flagged.
  for (const [shotId, clip] of clipOfShot) {
    const s = b.shots[shotId];
    if (!b0.shots[shotId] && !effectsBy.has(shotId)) continue;
    const old = s.effects ?? [];
    const unknown = old.filter((e) => { const r = parsePresetRef(e.preset); return !r || !getPreset("videoEffect", r.id); });
    const known = old.filter((e) => !unknown.includes(e));
    const fx = [...(effectsBy.get(shotId) ?? [])].map((pl, i) => effectOf(pl, clip.startTicks, clip.durationTicks, known[i]));
    const next = [...fx, ...unknown];
    if (!eq(next, old)) { if (next.length) s.effects = next; else delete s.effects; changes.push({ kind: "effects", id: shotId, label: `Effects of "${s.title}": ${next.length ? next.map((e) => e.preset).join(", ") : "none"}` }); }
    for (const l of s.layers ?? []) if (!layerSeen.has(`${shotId}/${l.id}`) && !l.removedFromTimeline) { l.removedFromTimeline = true; changes.push({ kind: "removedLayer", id: `${shotId}/${l.id}`, label: `Layer "${l.id}" of "${s.title}" removed from timeline (kept)` }); }
    if (s.layers && !s.layers.length) delete s.layers;
    if (s.captions && captionText(s) && b0.sent?.shots[shotId] !== undefined && !captionSeen.has(shotId)) { s.captions = false; changes.push({ kind: "removedLayer", id: `${shotId}/captions`, label: `Captions of "${s.title}" removed from timeline (dialogue kept, captions off)` }); }
  }
  const placedCues = new Set(others.flatMap((pl) => (pl.storyCue ? [pl.storyCue] : [])));
  for (const c of b.audio ?? []) if (!cueSeen.has(c.id) && !placedCues.has(c.id) && b0.sent?.cues[c.id] !== undefined && !c.removedFromTimeline) { c.removedFromTimeline = true; changes.push({ kind: "removedCue", id: c.id, label: `Audio cue "${c.id}" removed from timeline (kept)` }); }

  for (const s of Object.values(b.shots)) if (s.needsPrompt && s.prompt.trim()) delete s.needsPrompt;
  if (!changes.length) return { project: p, changes };
  comp = { ...comp };
  const next = recordSent({ ...p, storyboard: b, compositions: { ...p.compositions, [p.rootCompositionId]: comp } }, new Set([...Object.keys(b.shots), ...(b.audio ?? []).map((c) => `cue:${c.id}`)]));
  return { project: next, changes };
}

/** Everything on the board flagged `needsPrompt` (shots, layers, cues), for the AI to fill. */
export function needsPromptItems(b: Storyboard | undefined): { kind: "shot" | "layer" | "cue"; id: string; shot?: string; label: string }[] {
  if (!b) return [];
  const out: { kind: "shot" | "layer" | "cue"; id: string; shot?: string; label: string }[] = [];
  for (const id of b.order) {
    const s = b.shots[id];
    if (!s) continue;
    if (s.needsPrompt) out.push({ kind: "shot", id, label: `Shot "${s.title}": write description and prompt` });
    for (const l of s.layers ?? []) if (l.needsPrompt) out.push({ kind: "layer", id: l.id, shot: id, label: `Layer "${l.id}" of "${s.title}": write a description` });
  }
  for (const c of b.audio ?? []) if (c.needsPrompt) out.push({ kind: "cue", id: c.id, shot: c.from, label: `Audio cue "${c.id}": write a description` });
  return out;
}
