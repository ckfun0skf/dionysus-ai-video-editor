import { describe, expect, it } from "vitest";
import { editPoints, jumpEditPoint, SHORTCUT_GROUPS, splitTargets } from "./shortcuts";
import type { Composition } from "../../domain";

const comp = {
  id: "c", name: "c", tracks: [
    { id: "v", kind: "video", name: "Main", placements: [{ id: "a", startTicks: 0, durationTicks: 100 }, { id: "b", startTicks: 100, durationTicks: 50 }] },
    { id: "t", kind: "text", name: "Text", placements: [{ id: "x", startTicks: 30, durationTicks: 40 }] },
  ],
} as unknown as Composition;

describe("V2-110 NLE shortcuts", () => {
  it("edit points are every clip boundary, sorted and unique", () => {
    expect(editPoints(comp)).toEqual([0, 30, 70, 100, 150]);
  });
  it("↑/↓ step to the previous / next edit point and stop at the ends", () => {
    const pts = editPoints(comp);
    expect(jumpEditPoint(pts, 50, 1)).toBe(70);
    expect(jumpEditPoint(pts, 50, -1)).toBe(30);
    expect(jumpEditPoint(pts, 30, 1)).toBe(70);
    expect(jumpEditPoint(pts, 30, -1)).toBe(0);
    expect(jumpEditPoint(pts, 150, 1)).toBeUndefined();
    expect(jumpEditPoint(pts, 0, -1)).toBeUndefined();
  });
  it("split targets: selected clips spanning the playhead, else the main clip under it", () => {
    expect(splitTargets(comp, [], 50)).toEqual(["a"]);
    expect(splitTargets(comp, ["x", "b"], 50)).toEqual(["x"]);
    expect(splitTargets(comp, ["b"], 50)).toEqual(["a"]);
    expect(splitTargets(comp, [], 100)).toEqual([]);
  });
  it("the ? overlay lists Cmd/Ctrl+B, +K, +X and ↑/↓", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.keys));
    for (const k of ["B", "K", "X"]) expect(keys.some((x) => x.endsWith(` ${k}`))).toBe(true);
    expect(keys).toEqual(expect.arrayContaining(["↑", "↓"]));
  });
});
