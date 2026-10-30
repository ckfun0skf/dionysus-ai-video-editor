/**
 * P3A: frame-precise clip ranges and join matching.
 * - Frames: a project frame n starts at n·TPS/fps ticks of source time. In = first frame shown, Out = last frame shown.
 * - setSourceRange keeps the clip's timeline start and changes its in and out points (its length follows).
 * - matchJoin cuts two adjacent clips where a chosen frame pair matches: A ends just before `aOut`, B starts at `bIn`,
 *   B stays butted against A and later clips on the track move by the change, so the join stays closed.
 */
import { TICKS_PER_SECOND } from "./time";
import { findPlacement, versionOf } from "./model";
import { MIN_DURATION_TICKS, mapTrack, shiftKeys } from "./ops";
import type { Composition, Placement, Project } from "./model";

export const frameTicks = (fps: number) => TICKS_PER_SECOND / fps;
/** The frame that contains `ticks` (half-tick tolerance so frame starts round-trip exactly). */
export const ticksToFrame = (ticks: number, fps: number) => Math.floor((ticks + 0.5) / frameTicks(fps));
export const frameToTicks = (frame: number, fps: number) => Math.round(frame * frameTicks(fps));

/** Source span of a clip: [inTicks, outTicks) in source time, and its media length (undefined for stills). */
export function sourceSpan(project: Project, p: Placement): { inTicks: number; outTicks: number; mediaTicks?: number } {
  const media = p.clipType === "video" || p.clipType === "audio" ? versionOf(project, p.source)?.media.durationTicks : undefined;
  return { inTicks: p.sourceInTicks, outTicks: p.sourceInTicks + Math.round(p.durationTicks * (p.speed ?? 1)), mediaTicks: media };
}

/** Whether in/out frames can be set: a forward, non-freeze video (or audio) clip with known media length. */
export const canSetRange = (project: Project, p: Placement) => (p.clipType === "video" || p.clipType === "audio") && !p.freeze && !p.reverse && !!sourceSpan(project, p).mediaTicks;

function nextStartOnTrack(comp: Composition, p: Placement, trackId: string): number {
  const t = comp.tracks.find((x) => x.id === trackId)!;
  const end = p.startTicks + p.durationTicks;
  return Math.min(Infinity, ...t.placements.filter((o) => o.id !== p.id && o.startTicks >= end).map((o) => o.startTicks));
}

/** Set a clip's source in and out (ticks, out exclusive). Its start stays; the end may not run into the next clip. */
export function setSourceRange(comp: Composition, id: string, inTicks: number, outTicks: number, mediaTicks: number): Composition {
  const f = findPlacement(comp, id);
  if (!f) throw new Error(`Unknown placement ${id}`);
  const p = f.placement, s = p.speed ?? 1;
  const room = nextStartOnTrack(comp, p, f.track.id) - p.startTicks; // longest timeline length before the next clip
  let a = Math.max(0, Math.min(Math.round(inTicks), mediaTicks - MIN_DURATION_TICKS * s));
  let b = Math.min(mediaTicks, Math.round(outTicks), a + room * s);
  if (b - a < MIN_DURATION_TICKS * s) { b = Math.min(mediaTicks, a + MIN_DURATION_TICKS * s); a = Math.max(0, b - Math.max(MIN_DURATION_TICKS * s, b - a)); }
  const durationTicks = Math.max(MIN_DURATION_TICKS, Math.round((b - a) / s));
  if (a === p.sourceInTicks && durationTicks === p.durationTicks) return comp;
  const shift = -Math.round((a - p.sourceInTicks) / s);
  const next: Placement = { ...p, sourceInTicks: a, durationTicks, ...(p.keyframes && shift ? { keyframes: shiftKeys(p.keyframes, shift) } : {}) };
  return mapTrack(comp, f.track.id, (t) => ({ ...t, placements: t.placements.map((o) => (o.id === id ? next : o)) }));
}

/** The clip right after `id` on its track that starts where it ends (within half a frame at 30 fps). */
export function nextAdjacent(comp: Composition, id: string, tol = 2000): Placement | undefined {
  const f = findPlacement(comp, id);
  if (!f) return undefined;
  const end = f.placement.startTicks + f.placement.durationTicks;
  return f.track.placements.find((o) => o.id !== id && Math.abs(o.startTicks - end) <= tol);
}
export function prevAdjacent(comp: Composition, id: string, tol = 2000): Placement | undefined {
  const f = findPlacement(comp, id);
  if (!f) return undefined;
  return f.track.placements.find((o) => o.id !== id && Math.abs(o.startTicks + o.durationTicks - f.placement.startTicks) <= tol);
}
/** Clips that can be frame-matched: forward, non-freeze video at any speed. */
export const matchable = (project: Project, p: Placement | undefined): p is Placement => !!p && p.clipType === "video" && canSetRange(project, p);

/** For a selected clip, the adjacent pair to match: [A, B] with the selection as A when it has a next clip, else as B. */
export function matchPair(project: Project, comp: Composition, id: string): [Placement, Placement] | undefined {
  const f = findPlacement(comp, id);
  if (!f || !matchable(project, f.placement)) return undefined;
  const n = nextAdjacent(comp, id);
  if (matchable(project, n)) return [f.placement, n];
  const pr = prevAdjacent(comp, id);
  if (matchable(project, pr)) return [pr, f.placement];
  return undefined;
}

/**
 * Join two adjacent clips at a matching frame pair: A's source out becomes `aOut` (exclusive, so A's last frame is the
 * one before it) and B's source in becomes `bIn`. B is moved to butt against A and later clips on the track shift by
 * the change in B's end, keeping every following cut closed.
 */
export function matchJoin(comp: Composition, aId: string, bId: string, aOut: number, bIn: number): Composition {
  const fa = findPlacement(comp, aId), fb = findPlacement(comp, bId);
  if (!fa || !fb || fa.track.id !== fb.track.id) throw new Error("Match frames needs two clips on the same track");
  const A = fa.placement, B = fb.placement, sa = A.speed ?? 1, sb = B.speed ?? 1;
  const aDur = Math.max(MIN_DURATION_TICKS, Math.round((Math.round(aOut) - A.sourceInTicks) / sa));
  const bEndSrc = B.sourceInTicks + B.durationTicks * sb;
  const newIn = Math.max(0, Math.min(Math.round(bIn), bEndSrc - MIN_DURATION_TICKS * sb));
  const bDur = Math.max(MIN_DURATION_TICKS, Math.round((bEndSrc - newIn) / sb));
  const bStart = A.startTicks + aDur;
  const oldBEnd = B.startTicks + B.durationTicks, delta = bStart + bDur - oldBEnd;
  const shift = -Math.round((newIn - B.sourceInTicks) / sb);
  const nA: Placement = { ...A, durationTicks: aDur };
  const nB: Placement = { ...B, startTicks: bStart, sourceInTicks: newIn, durationTicks: bDur, ...(B.keyframes && shift ? { keyframes: shiftKeys(B.keyframes, shift) } : {}) };
  return mapTrack(comp, fa.track.id, (t) => ({
    ...t,
    placements: t.placements.map((o) => (o.id === aId ? nA : o.id === bId ? nB : o.startTicks >= oldBEnd ? { ...o, startTicks: o.startTicks + delta } : o)),
  }));
}
