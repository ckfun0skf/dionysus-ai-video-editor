import type { Shot } from "./types";

/**
 * Master Timeline placement is independent from each Shot's internal Version
 * duration. Projects created before masterStart existed retain their historical
 * sequential layout until an edit explicitly materializes their positions.
 */
export function getMasterShotStarts(shots: Shot[]): number[] {
  let nextStart = 0;
  return shots.map(shot => {
    const start = typeof shot.masterStart === "number" && Number.isFinite(shot.masterStart) && shot.masterStart >= 0
      ? shot.masterStart
      : nextStart;
    nextStart = start + shot.duration;
    return start;
  });
}

export function getMasterShotStart(shots: Shot[], shotId: string): number {
  const index = shots.findIndex(shot => shot.id === shotId);
  if (index < 0) return 0;
  return getMasterShotStarts(shots)[index];
}

export function getMasterTimelineDuration(shots: Shot[]): number {
  const starts = getMasterShotStarts(shots);
  return shots.reduce((end, shot, index) => Math.max(end, starts[index] + shot.duration), 0);
}

/** Normalize legacy sequential positions before moving one Shot independently. */
export function setMasterShotStart(shots: Shot[], shotId: string, start: number): Shot[] {
  if (!Number.isFinite(start)) return shots;
  const safeStart = Math.max(0, start);
  const starts = getMasterShotStarts(shots);
  return shots.map((shot, index) => ({
    ...shot,
    masterStart: shot.id === shotId ? safeStart : starts[index],
  }));
}

/** Changing one Shot's duration does not ripple other Shots or resize Versions. */
export function setMasterShotDuration(shots: Shot[], shotId: string, duration: number): Shot[] {
  if (!Number.isFinite(duration)) return shots;
  const safeDuration = Math.max(0.1, duration);
  const starts = getMasterShotStarts(shots);
  return shots.map((shot, index) => ({
    ...shot,
    masterStart: starts[index],
    duration: shot.id === shotId ? safeDuration : shot.duration,
  }));
}

/** Return the Shot at the playhead, or the nearest earlier Shot when the timeline has a gap. */
export function getMasterShotIndexAtTime(shots: Shot[], seconds: number): number {
  if (!shots.length) return -1;
  const starts = getMasterShotStarts(shots);
  const containing = shots.findIndex((shot, index) => seconds >= starts[index] && seconds < starts[index] + shot.duration);
  if (containing >= 0) return containing;

  let earliestIndex = 0;
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] < starts[earliestIndex]) earliestIndex = index;
  }
  let nearestIndex = earliestIndex;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= seconds && starts[index] >= starts[nearestIndex]) nearestIndex = index;
  }
  return nearestIndex;
}

/**
 * Explicit ripple operation: move a Shot to a chronological insertion point,
 * close all gaps, and place the existing Shot durations back-to-back. The
 * storyboard array order is not changed; only masterStart is updated.
 */
export function rippleReorderMasterShots(shots: Shot[], shotId: string, targetCenter: number): Shot[] {
  if (!Number.isFinite(targetCenter) || !shots.some(shot => shot.id === shotId)) return shots;
  const starts = getMasterShotStarts(shots);
  const ordered = shots
    .map((shot, index) => ({ shot, start: starts[index], index }))
    .sort((a, b) => a.start - b.start || a.index - b.index);
  const moving = ordered.find(item => item.shot.id === shotId)!;
  const remaining = ordered.filter(item => item.shot.id !== shotId);
  const insertionIndex = remaining.findIndex(item => targetCenter < item.start + item.shot.duration / 2);
  remaining.splice(insertionIndex < 0 ? remaining.length : insertionIndex, 0, moving);

  let cursor = Math.max(0, Math.min(...starts));
  const nextStarts = new Map<string, number>();
  for (const item of remaining) {
    nextStarts.set(item.shot.id, cursor);
    cursor += item.shot.duration;
  }
  return shots.map(shot => ({
    ...shot,
    masterStart: nextStarts.get(shot.id) ?? getMasterShotStart(shots, shot.id)
  }));
}
