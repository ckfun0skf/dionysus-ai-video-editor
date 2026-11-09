/**
 * P51: where a new or pasted clip lands on the main track, and the ripple that keeps the cut closed.
 *
 * Current clip (always a main-track clip):
 *  1. One selected main-track clip → that clip.
 *  2. Several selected main-track clips → the one under `time` if it is selected, otherwise the earliest selected.
 *  3. Otherwise the main-track clip that contains `time` (`start <= time < end`). A clip that starts at `time`
 *     wins over one that ends there.
 *  4. Otherwise the nearest main-track clip that ends at or before `time`.
 *  5. Otherwise none: the playhead is before every main clip, or the main track is empty.
 *
 * Current chain: the maximal run of main-track clips that contains the current clip, where the next clip stays in
 * the run when it starts within one tick of the previous clip's end. A larger gap starts a new chain.
 *
 * "Insert after current clip" is the current clip's end. "At the end of the current chain" is that run's end.
 * With no current clip, the chain end is 0 (the start of the timeline).
 *
 * Ripple: every clip on the receiving track that starts at or after the insert point moves later by the inserted
 * span, so an existing gap keeps its length. Linked layers and subtitles (`link.parent`, including captions sent
 * with a shot) are not moved here — the engine's link step keeps their offset from the parent, the same as ripple
 * delete and promote-insert. A layer with no link stays put.
 */
import { trackKindFor, type Composition, type Placement, type Track, type TrackKind } from "./model";
import { addTrack, groupOf, mainTrack } from "./ops";

const end = (p: Placement) => p.startTicks + p.durationTicks;
/** Clips this close (ticks) still belong to the same chain. */
const CHAIN_GAP = 1;

export interface ChainPoint { selectedIds?: string[]; time?: number }
export interface ChainRun { clips: Placement[]; startTicks: number; endTicks: number }

export function mainClips(comp: Composition): Placement[] {
  return [...(mainTrack(comp)?.placements ?? [])].sort((a, b) => a.startTicks - b.startTicks || a.id.localeCompare(b.id));
}

/** The main-track clip the insert / paste actions call "current". See the file comment. */
export function currentMainClip(comp: Composition, opts: ChainPoint = {}): Placement | undefined {
  const mains = mainClips(comp);
  const byId = new Map(mains.map((p) => [p.id, p]));
  const selected = (opts.selectedIds ?? []).map((id) => byId.get(id)).filter((p): p is Placement => !!p);
  const time = opts.time ?? 0;
  const under = mains.find((p) => p.startTicks <= time && time < end(p));
  if (selected.length === 1) return selected[0];
  if (selected.length > 1) return (under && selected.includes(under) ? under : [...selected].sort((a, b) => a.startTicks - b.startTicks || a.id.localeCompare(b.id))[0]);
  if (under) return under;
  return [...mains].reverse().find((p) => end(p) <= time);
}

/** The contiguous main-track run that contains `clipId`. */
export function chainOf(comp: Composition, clipId: string): ChainRun | undefined {
  const mains = mainClips(comp);
  const i = mains.findIndex((p) => p.id === clipId);
  if (i < 0) return undefined;
  let a = i, b = i;
  while (a > 0 && mains[a].startTicks - end(mains[a - 1]) <= CHAIN_GAP) a -= 1;
  while (b + 1 < mains.length && mains[b + 1].startTicks - end(mains[b]) <= CHAIN_GAP) b += 1;
  const clips = mains.slice(a, b + 1);
  return { clips, startTicks: clips[0].startTicks, endTicks: end(clips[clips.length - 1]) };
}

/** Ticks where "insert after the current clip" lands, or undefined when there is no current clip. */
export function insertAfterTicks(comp: Composition, opts: ChainPoint = {}): number | undefined {
  const cur = currentMainClip(comp, opts);
  return cur ? end(cur) : undefined;
}

/**
 * Ticks where "at the end of the current chain" lands. With no current clip this is 0, so a paste starts the timeline
 * and ripples the first chain.
 */
export function chainEndTicks(comp: Composition, opts: ChainPoint = {}): number {
  const cur = currentMainClip(comp, opts);
  if (!cur) return 0;
  return chainOf(comp, cur.id)?.endTicks ?? end(cur);
}

export type PasteWhere = "after" | "end";
/** Paste origin for a placement choice. "after" is undefined when there is no current clip (the dialog disables it). */
export function pasteOrigin(comp: Composition, where: PasteWhere, opts: ChainPoint = {}): number | undefined {
  return where === "after" ? insertAfterTicks(comp, opts) : chainEndTicks(comp, opts);
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** Move clips on `trackId` that start at or after `at` later by `by`. Clips that start earlier stay. */
export function shiftTrackFrom(comp: Composition, trackId: string, at: number, by: number): Composition {
  if (!by) return comp;
  return {
    ...comp,
    tracks: comp.tracks.map((t) => (t.id !== trackId ? t : {
      ...t,
      placements: t.placements.map((p) => (p.startTicks >= at ? { ...p, startTicks: p.startTicks + by } : p)).sort((a, b) => a.startTicks - b.startTicks),
    })),
  };
}

function put(comp: Composition, trackId: string, pl: Placement): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === trackId ? { ...t, placements: [...t.placements, pl].sort((a, b) => a.startTicks - b.startTicks) } : t)) };
}

/**
 * Place `placements` on `trackId` at the times they already carry. Clips on that track that start at or after the
 * block's start move later by the block's span first, so the new clips fit and later gaps keep their length.
 */
export function rippleInsert(comp: Composition, trackId: string, placements: Placement[]): Composition {
  if (!placements.length) return comp;
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown track ${trackId}`);
  for (const pl of placements) if (trackKindFor(pl.clipType) !== track.kind) throw new Error(`Cannot place ${pl.clipType} on ${track.kind} track`);
  const start = Math.min(...placements.map((p) => p.startTicks));
  const span = Math.max(...placements.map((p) => end(p))) - start;
  const shifted = shiftTrackFrom(comp, trackId, start, span);
  const busy = shifted.tracks.find((t) => t.id === trackId)!.placements.some((p) => placements.some((n) => overlaps(n.startTicks, end(n), p.startTicks, end(p))));
  if (busy) throw new Error("Can't insert here: a clip overlaps the insert point.");
  return placements.reduce((c, pl) => put(c, trackId, pl), shifted);
}

export interface RippleItem { trackId: string; placement: Placement }

/**
 * Paste `items` (starts already set) and ripple each receiving track. Main-track items ripple the main track.
 * Other items land on their track when the slot is free once linked clips have followed that ripple, otherwise on
 * another layer of the same kind and group, otherwise a new layer. `before` is the composition before this paste,
 * so link targets are read from it (this function may already have shifted the main track).
 */
export function pasteRipple(comp: Composition, items: RippleItem[], before: Composition = comp): Composition {
  if (!items.length) return comp;
  const mainId = mainTrack(comp)?.id;
  const onMain = mainId ? items.filter((i) => i.trackId === mainId) : [];
  let cur = comp;
  if (onMain.length && mainId) cur = rippleInsert(cur, mainId, onMain.map((i) => i.placement));
  const mainStart = onMain.length ? Math.min(...onMain.map((i) => i.placement.startTicks)) : Infinity;
  const mainSpan = onMain.length ? Math.max(...onMain.map((i) => end(i.placement))) - mainStart : 0;
  const shiftedParents = new Set((mainTrack(before)?.placements ?? []).filter((p) => p.startTicks >= mainStart).map((p) => p.id));
  const shiftOf = (p: Placement) => (p.link?.parent && shiftedParents.has(p.link.parent) ? mainSpan : 0);
  for (const it of items) {
    if (it.trackId === mainId) continue;
    cur = placeBeside(cur, it.trackId, it.placement, shiftOf);
  }
  return cur;
}

function sameLayer(comp: Composition, prefer: Track, t: Track): boolean {
  return t.kind === prefer.kind && groupOf(comp, t) === groupOf(comp, prefer) && !!t.layerStyle?.subtitle === !!prefer.layerStyle?.subtitle && t.id !== mainTrack(comp)?.id;
}

function freeAfter(t: Track, pl: Placement, shiftOf: (p: Placement) => number): boolean {
  return t.placements.every((p) => {
    const sh = shiftOf(p);
    return !overlaps(pl.startTicks, end(pl), p.startTicks + sh, p.startTicks + sh + p.durationTicks);
  });
}

/** Place `pl` on `preferId` or a sibling layer, accounting for linked clips that the engine will move by `shiftOf`. */
export function placeBeside(comp: Composition, preferId: string, pl: Placement, shiftOf: (p: Placement) => number): Composition {
  const prefer = comp.tracks.find((t) => t.id === preferId);
  if (!prefer) throw new Error(`Unknown track ${preferId}`);
  if (freeAfter(prefer, pl, shiftOf)) return put(comp, prefer.id, pl);
  const other = comp.tracks.find((t) => t.id !== prefer.id && sameLayer(comp, prefer, t) && freeAfter(t, pl, shiftOf));
  if (other) return put(comp, other.id, pl);
  const kind: TrackKind = prefer.kind;
  const id = `trk_${pl.id}`;
  const group = groupOf(comp, prefer) === "text" ? "text" as const : undefined;
  let c = addTrack(comp, kind, id, group);
  // A subtitle layer stays a subtitle layer so captions are not mixed into ordinary text.
  if (prefer.layerStyle?.subtitle) c = { ...c, tracks: c.tracks.map((t) => (t.id === id ? { ...t, layerStyle: { ...prefer.layerStyle } } : t)) };
  return put(c, id, pl);
}

/** Place sticker (text-group) clips at the times they carry, after a main-track ripple of `mainSpan` from `mainStart`. */
export function placeTextGroup(comp: Composition, placements: Placement[], mainStart: number, mainSpan: number, before: Composition): Composition {
  if (!placements.length) return comp;
  const shiftedParents = new Set((mainTrack(before)?.placements ?? []).filter((p) => p.startTicks >= mainStart).map((p) => p.id));
  const shiftOf = (p: Placement) => (p.link?.parent && shiftedParents.has(p.link.parent) ? mainSpan : 0);
  let cur = comp;
  for (const pl of placements) {
    const prefer = cur.tracks.find((t) => t.kind === "video" && groupOf(cur, t) === "text");
    if (!prefer) {
      const id = `trk_${pl.id}`;
      cur = addTrack(cur, "video", id, "text");
      cur = put(cur, id, pl);
    } else cur = placeBeside(cur, prefer.id, pl, shiftOf);
  }
  return cur;
}
