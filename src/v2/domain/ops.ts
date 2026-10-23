/** Pure placement operations. All return new Composition objects (no mutation). */
import { findPlacement, newId, trackKindFor, type Composition, type Placement, type Track } from "./model";

export const MIN_DURATION_TICKS = 1200; // 10 ms

function sortPlacements(ps: Placement[]): Placement[] {
  return [...ps].sort((a, b) => a.startTicks - b.startTicks);
}
function mapTrack(comp: Composition, trackId: string, fn: (t: Track) => Track): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

/** True when [start,start+dur) is free on the track (ignoring `ignoreId`). */
export function isFree(track: Track, start: number, dur: number, ignoreId?: string): boolean {
  return track.placements.every((p) => p.id === ignoreId || start + dur <= p.startTicks || start >= p.startTicks + p.durationTicks);
}

/** First free start >= desired on the track that fits `dur`. */
export function firstFreeStart(track: Track, desired: number, dur: number, ignoreId?: string): number {
  let start = Math.max(0, desired);
  for (const p of sortPlacements(track.placements)) {
    if (p.id === ignoreId) continue;
    if (start + dur <= p.startTicks) break;
    if (start < p.startTicks + p.durationTicks) start = p.startTicks + p.durationTicks;
  }
  return start;
}

export function addTrack(comp: Composition, kind: Track["kind"], id = newId("trk")): Composition {
  const n = comp.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = { id, kind, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, placements: [] };
  // Video tracks stack on top; audio go to the bottom.
  const tracks = kind === "audio" ? [...comp.tracks, track] : [track, ...comp.tracks];
  return { ...comp, tracks };
}

export function removeTrack(comp: Composition, trackId: string): Composition {
  return { ...comp, tracks: comp.tracks.filter((t) => t.id !== trackId) };
}

export function insertPlacement(comp: Composition, trackId: string, placement: Placement): Composition {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown track ${trackId}`);
  if (trackKindFor(placement.clipType) !== track.kind) throw new Error(`Cannot place ${placement.clipType} on ${track.kind} track`);
  const start = firstFreeStart(track, placement.startTicks, placement.durationTicks);
  return mapTrack(comp, trackId, (t) => ({ ...t, placements: sortPlacements([...t.placements, { ...placement, startTicks: start }]) }));
}

/** Move a placement to a (possibly different) track and start. Rejects overlaps by pushing to the next free slot. */
export function movePlacement(comp: Composition, placementId: string, toTrackId: string, startTicks: number): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const target = comp.tracks.find((t) => t.id === toTrackId);
  if (!target) throw new Error(`Unknown track ${toTrackId}`);
  if (trackKindFor(found.placement.clipType) !== target.kind) return comp;
  const start = firstFreeStart(target, startTicks, found.placement.durationTicks, placementId);
  const moved = { ...found.placement, startTicks: start };
  let next = mapTrack(comp, found.track.id, (t) => ({ ...t, placements: t.placements.filter((p) => p.id !== placementId) }));
  next = mapTrack(next, toTrackId, (t) => ({ ...t, placements: sortPlacements([...t.placements, moved]) }));
  return next;
}

/**
 * Trim an edge to a new timeline position. `maxSourceTicks` is the media length
 * (undefined for images = unlimited). Clamped by neighbours and source bounds.
 */
export function trimPlacement(comp: Composition, placementId: string, edge: "left" | "right", toTicks: number, maxSourceTicks?: number): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const p = found.placement;
  const others = found.track.placements.filter((o) => o.id !== p.id);
  const end = p.startTicks + p.durationTicks;
  let updated: Placement;
  if (edge === "left") {
    const prevEnd = Math.max(0, ...others.filter((o) => o.startTicks + o.durationTicks <= p.startTicks).map((o) => o.startTicks + o.durationTicks));
    let start = Math.min(Math.max(toTicks, prevEnd, p.startTicks - p.sourceInTicks), end - MIN_DURATION_TICKS);
    if (maxSourceTicks === undefined) start = Math.min(Math.max(toTicks, prevEnd), end - MIN_DURATION_TICKS);
    const delta = start - p.startTicks;
    updated = { ...p, startTicks: start, durationTicks: end - start, sourceInTicks: maxSourceTicks === undefined ? 0 : p.sourceInTicks + delta };
  } else {
    const nextStart = Math.min(Infinity, ...others.filter((o) => o.startTicks >= end).map((o) => o.startTicks));
    const sourceLimit = maxSourceTicks === undefined ? Infinity : p.startTicks + (maxSourceTicks - p.sourceInTicks);
    const newEnd = Math.max(Math.min(toTicks, nextStart, sourceLimit), p.startTicks + MIN_DURATION_TICKS);
    updated = { ...p, durationTicks: newEnd - p.startTicks };
  }
  return mapTrack(comp, found.track.id, (t) => ({ ...t, placements: t.placements.map((o) => (o.id === p.id ? updated : o)) }));
}

/** Split at absolute timeline time. Returns unchanged comp when `atTicks` is not strictly inside. */
export function splitPlacement(comp: Composition, placementId: string, atTicks: number, newIdValue = newId("plc")): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const p = found.placement;
  const offset = atTicks - p.startTicks;
  if (offset < MIN_DURATION_TICKS || p.durationTicks - offset < MIN_DURATION_TICKS) return comp;
  const left: Placement = { ...p, durationTicks: offset };
  const right: Placement = { ...p, id: newIdValue, startTicks: atTicks, durationTicks: p.durationTicks - offset, sourceInTicks: p.clipType === "image" ? 0 : p.sourceInTicks + offset };
  return mapTrack(comp, found.track.id, (t) => ({ ...t, placements: sortPlacements(t.placements.flatMap((o) => (o.id === p.id ? [left, right] : [o]))) }));
}

export function deletePlacement(comp: Composition, placementId: string): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.filter((p) => p.id !== placementId) })) };
}

/** Snap `ticks` to nearest candidate edge within `threshold`. */
export function snapTicks(comp: Composition, ticks: number, threshold: number, extra: number[] = [], ignoreId?: string): number {
  const candidates = [0, ...extra];
  for (const t of comp.tracks) for (const p of t.placements) if (p.id !== ignoreId) candidates.push(p.startTicks, p.startTicks + p.durationTicks);
  let best = ticks;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - ticks);
    if (d <= bestDist) { best = c; bestDist = d; }
  }
  return best;
}

/** Snap a moving block so either its start or end aligns with a candidate. */
export function snapMove(comp: Composition, start: number, dur: number, threshold: number, extra: number[] = [], ignoreId?: string): number {
  const s = snapTicks(comp, start, threshold, extra, ignoreId);
  if (s !== start) return s;
  const e = snapTicks(comp, start + dur, threshold, extra, ignoreId);
  return e !== start + dur ? e - dur : start;
}
