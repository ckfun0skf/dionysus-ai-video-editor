/**
 * Storyboard linked items (format v1.1, V2-SB-113): text, media, caption and effect clips that "Send to timeline"
 * creates for a shot carry `storyLink.anchor`, the id of the shot's clip. When that clip moves or changes length
 * (a version swap, R01 ripple), every linked item keeps its offset from the clip start and is clamped to the
 * clip's new length, never dropped. A clamp is remembered so a later swap back to a longer version restores it.
 */
import type { Composition, Placement, Track } from "./model";
import { addTrack, groupOf, isFree, mainTrack } from "./ops";

/** Shortest linked item kept after a clamp (0.1 s). */
export const MIN_LINKED_TICKS = 12_000;

/**
 * Fit an item that wants [offset, offset + duration) into a clip `length` long. The end is clamped to the clip end;
 * an item that would start at or after the end keeps as much of its length as fits and ends at the clip end.
 */
export function clampToClip(offset: number, duration: number, length: number): { offset: number; duration: number } {
  const end = Math.min(offset + duration, length);
  if (end - offset >= Math.min(MIN_LINKED_TICKS, duration)) return { offset, duration: Math.max(1, end - offset) };
  const d = Math.max(1, Math.min(duration, length));
  return { offset: Math.max(0, length - d), duration: d };
}

const anchors = (c: Composition) => new Map(c.tracks.flatMap((t) => t.placements.map((p) => [p.id, p] as const)));

/** Re-place every linked item of `after` whose anchor clip moved or changed length since `before`. */
export function followStoryLinks(before: Composition, after: Composition): Composition {
  const was = anchors(before), now = anchors(after);
  const moved = new Map<string, Placement>();
  for (const t of after.tracks) for (const pl of t.placements) {
    const link = pl.storyLink;
    const a0 = link && was.get(link.anchor), a1 = link && now.get(link.anchor);
    if (!link || !a0 || !a1 || (a0.startTicks === a1.startTicks && a0.durationTicks === a1.durationTicks)) continue;
    const off = pl.startTicks - a0.startTicks;
    const memo = link.want && link.want.clampedOffset === off && link.want.clampedDuration === pl.durationTicks ? link.want : undefined;
    const wOff = memo?.offset ?? off, wDur = memo?.duration ?? pl.durationTicks;
    const r = clampToClip(wOff, wDur, a1.durationTicks);
    const next: Placement = { ...pl, startTicks: Math.max(0, a1.startTicks + r.offset), durationTicks: r.duration, storyLink: { anchor: link.anchor } };
    if (r.offset !== wOff || r.duration !== wDur) next.storyLink = { anchor: link.anchor, want: { offset: wOff, duration: wDur, clampedOffset: r.offset, clampedDuration: r.duration } };
    if (next.fadeInTicks && next.fadeInTicks > next.durationTicks) next.fadeInTicks = next.durationTicks;
    if (next.fadeOutTicks && next.fadeOutTicks > next.durationTicks) next.fadeOutTicks = next.durationTicks;
    moved.set(pl.id, next);
  }
  if (!moved.size) return after;
  let comp: Composition = { ...after, tracks: after.tracks.map((t) => (t.placements.some((p) => moved.has(p.id)) ? { ...t, placements: t.placements.map((p) => moved.get(p.id) ?? p).sort((a, b) => a.startTicks - b.startTicks) } : t)) };
  // A moved item that now overlaps another clip on its layer (one the user put there) goes to a free layer of the same kind.
  for (const pl of moved.values()) {
    const track = comp.tracks.find((t) => t.placements.some((p) => p.id === pl.id))!;
    if (isFree(track, pl.startTicks, pl.durationTicks, pl.id)) continue;
    comp = { ...comp, tracks: comp.tracks.map((t) => (t === track ? { ...t, placements: t.placements.filter((p) => p.id !== pl.id) } : t)) };
    comp = placeOnFreeTrack(comp, pl, sameKind(comp, track));
  }
  return comp;
}

/** Which layers can take a clip that lives on `track` (same kind, same group, plain text layers only). */
function sameKind(comp: Composition, track: Track): (t: Track) => boolean {
  const g = groupOf(comp, track);
  return (t) => t.kind === track.kind && groupOf(comp, t) === g && !!t.layerStyle?.subtitle === !!track.layerStyle?.subtitle && t.id !== mainTrack(comp)?.id;
}

/** Insert `pl` on the first layer accepted by `fits` with room for it, else on a new layer of that kind on top. */
export function placeOnFreeTrack(comp: Composition, pl: Placement, fits: (t: Track) => boolean, newTrack?: Partial<Track>): Composition {
  let track = comp.tracks.find((t) => fits(t) && isFree(t, pl.startTicks, pl.durationTicks));
  let c = comp;
  if (!track) {
    const kind = pl.clipType === "text" ? "text" : pl.clipType === "effect" ? "effect" : "video";
    const id = `trk_${pl.id}`;
    c = addTrack(c, kind, id);
    c = { ...c, tracks: c.tracks.map((t) => (t.id === id ? { ...t, ...newTrack, id } : t)) };
    track = c.tracks.find((t) => t.id === id)!;
  }
  const tid = track.id;
  return { ...c, tracks: c.tracks.map((t) => (t.id === tid ? { ...t, placements: [...t.placements, pl].sort((a, b) => a.startTicks - b.startTicks) } : t)) };
}
