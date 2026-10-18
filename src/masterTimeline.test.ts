import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { getMasterShotIndexAtTime, getMasterShotStart, getMasterShotStarts, getMasterTimelineDuration, setMasterShotDuration, setMasterShotStart } from "./masterTimeline";

describe("Master Timeline Shot placement", () => {
  it("keeps legacy projects in their original sequential layout", () => {
    const shots = structuredClone(sampleProject.shots);
    expect(getMasterShotStarts(shots)).toEqual([0, shots[0].duration, shots[0].duration + shots[1].duration]);
    expect(getMasterShotStart(shots, shots[2].id)).toBe(shots[0].duration + shots[1].duration);
    expect(getMasterTimelineDuration(shots)).toBe(shots.reduce((sum, shot) => sum + shot.duration, 0));
  });

  it("moves one Shot independently while preserving the other Shot positions", () => {
    const shots = structuredClone(sampleProject.shots);
    const moved = setMasterShotStart(shots, shots[1].id, 19.25);
    expect(getMasterShotStarts(moved)).toEqual([0, 19.25, shots[0].duration + shots[1].duration]);
    expect(moved.every(shot => typeof shot.masterStart === "number")).toBe(true);
    expect(getMasterShotStart(moved, "missing")).toBe(0);
  });

  it("changes Shot duration without resizing any Version or rippling other Shots", () => {
    const shots = structuredClone(sampleProject.shots);
    const versionsBefore = shots.map(shot => shot.slots.map(slot => slot.versions.map(version => version.duration)));
    const updated = setMasterShotDuration(shots, shots[0].id, 9);
    expect(getMasterShotStarts(updated)).toEqual(getMasterShotStarts(shots));
    expect(updated[0].duration).toBe(9);
    expect(updated.slice(1).map(shot => shot.duration)).toEqual(shots.slice(1).map(shot => shot.duration));
    expect(updated.map(shot => shot.slots.map(slot => slot.versions.map(version => version.duration)))).toEqual(versionsBefore);
    expect(getMasterTimelineDuration(updated)).toBe(Math.max(9, ...getMasterShotStarts(updated).slice(1).map((start, index) => start + updated[index+1].duration)));
  });

  it("finds the active Shot by its absolute placement, including gaps and array order changes", () => {
    const shots = structuredClone(sampleProject.shots);
    const secondStart = 6;
    const thirdStart = 11;
    const gapTime = thirdStart + shots[2].duration + 0.1;
    shots[0].masterStart = gapTime + 5;
    shots[1].masterStart = secondStart;
    shots[2].masterStart = thirdStart;

    expect(getMasterShotIndexAtTime(shots, 7)).toBe(1);
    expect(getMasterShotIndexAtTime(shots, 12)).toBe(2);
    expect(getMasterShotIndexAtTime(shots, gapTime)).toBe(2);
    expect(getMasterShotIndexAtTime(shots, gapTime + 6)).toBe(0);
    expect(getMasterShotIndexAtTime(shots, 1)).toBe(1);
    expect(getMasterShotIndexAtTime([], 0)).toBe(-1);
  });

  it("clamps negative Master start and short Shot duration to valid minima", () => {
    const shots = structuredClone(sampleProject.shots);
    expect(getMasterShotStart(setMasterShotStart(shots, shots[0].id, -10), shots[0].id)).toBe(0);
    expect(setMasterShotDuration(shots, shots[0].id, 0)[0].duration).toBe(0.1);
  });
});
