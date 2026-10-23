/** Multi-clip editing: ripple delete/trim, duplicate, copy/paste. Pure; returns new Compositions. */
import { findPlacement, newId, trackKindFor, type Composition, type Placement, type TrackKind } from "./model";
import { firstFreeStart, insertPlacement, trimPlacement } from "./ops";

const end = (p: Placement) => p.startTicks + p.durationTicks;

/** Delete clips; with `ripple`, later clips on each affected track slide left to close the gaps. */
export function deleteMany(comp: Composition, ids: string[], ripple = false): Composition {
  const gone = new Set(ids);
  return {
    ...comp,
    tracks: comp.tracks.map((t) => {
      const removed = t.placements.filter((p) => gone.has(p.id));
      if (!removed.length) return t;
      const kept = t.placements.filter((p) => !gone.has(p.id));
      if (!ripple) return { ...t, placements: kept };
      // Shift each kept clip left by the total length removed before it (gaps are not closed, only removed clips).
      return { ...t, placements: kept.map((p) => {
        const shift = removed.filter((r) => end(r) <= p.startTicks).reduce((s, r) => s + r.durationTicks, 0);
        return shift ? { ...p, startTicks: p.startTicks - shift } : p;
      }) };
    }),
  };
}

/**
 * Ripple trim: the clip keeps its start, its length changes, and every later clip on the
 * track moves by the same amount (so trimming never leaves a gap and extending pushes clips).
 */
export function rippleTrim(comp: Composition, id: string, edge: "left" | "right", toTicks: number, maxSourceTicks?: number): Composition {
  const found = findPlacement(comp, id);
  if (!found) throw new Error(`Unknown placement ${id}`);
  const p = found.placement;
  // Trim in isolation so neighbours don't clamp extension.
  const solo: Composition = { ...comp, tracks: [{ ...found.track, placements: [p] }] };
  const trimmed = trimPlacement(solo, id, edge, toTicks, maxSourceTicks).tracks[0].placements[0];
  const delta = trimmed.durationTicks - p.durationTicks;
  if (!delta) return comp;
  const next = { ...trimmed, startTicks: p.startTicks };
  return {
    ...comp,
    tracks: comp.tracks.map((t) => (t.id !== found.track.id ? t : {
      ...t,
      placements: t.placements.map((o) => (o.id === id ? next : o.startTicks >= end(p) ? { ...o, startTicks: o.startTicks + delta } : o)),
    })),
  };
}

export interface ClipboardItem { trackId: string; kind: TrackKind; offset: number; placement: Placement }

/** Snapshot selected clips with start offsets relative to the earliest one. */
export function copyClips(comp: Composition, ids: string[]): ClipboardItem[] {
  const items = ids.map((id) => findPlacement(comp, id)).filter((f): f is NonNullable<typeof f> => !!f);
  const t0 = Math.min(...items.map((f) => f.placement.startTicks));
  return items.map((f) => ({ trackId: f.track.id, kind: f.track.kind, offset: f.placement.startTicks - t0, placement: f.placement }));
}

/** Paste at `at` on the original tracks (or the first track of the right kind). Overlaps slide to the next free slot. Returns new ids. */
export function pasteClips(comp: Composition, items: ClipboardItem[], at: number, makeId = () => newId("plc")): { comp: Composition; ids: string[] } {
  const ids: string[] = [];
  for (const it of [...items].sort((a, b) => a.offset - b.offset)) {
    const track = comp.tracks.find((t) => t.id === it.trackId) ?? comp.tracks.find((t) => t.kind === trackKindFor(it.placement.clipType));
    if (!track) continue;
    const id = makeId();
    comp = insertPlacement(comp, track.id, { ...it.placement, id, startTicks: Math.max(0, at + it.offset) });
    ids.push(id);
  }
  return { comp, ids };
}

/** Duplicate each clip right after the selection's end, preserving relative layout. */
export function duplicateClips(comp: Composition, ids: string[], makeId = () => newId("plc")): { comp: Composition; ids: string[] } {
  const items = copyClips(comp, ids);
  if (!items.length) return { comp, ids: [] };
  const last = Math.max(...items.map((i) => end(i.placement)));
  return pasteClips(comp, items, last, makeId);
}

