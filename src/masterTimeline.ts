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
