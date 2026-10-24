import { describe, expect, it } from "vitest";
import { boxDistance, hitCandidates, hitTest, inBox, isBackdrop, pickAt } from "./hit";
import type { Placed } from "./frame";
import { pinchPatch } from "../ui/gestures";

const box = (cx: number, cy: number, w: number, h: number, rot = 0): Placed => ({ cx, cy, w, h, rot, alpha: 1, sx: 0, sy: 0, sw: w, sh: h });

describe("preview hit-testing", () => {
  it("respects rotation", () => {
    const b = box(100, 100, 200, 20, Math.PI / 2); // now tall and thin
    expect(inBox(b, 100, 180)).toBe(true);
    expect(inBox(b, 180, 100)).toBe(false);
  });
  it("picks the topmost (last drawn) element", () => {
    const m = new Map([["bottom", box(100, 100, 200, 200)], ["top", box(100, 100, 50, 50)]]);
    expect(hitTest(m, 100, 100)).toBe("top");
    expect(hitTest(m, 20, 20)).toBe("bottom");
    expect(hitTest(m, 500, 500)).toBeUndefined();
  });
  it("pinch scales by distance ratio and twist rotates", () => {
    const p = pinchPatch({ scale: 1, rotation: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 20 });
    expect(p.scale).toBeCloseTo(2);
    expect(p.rotation).toBeCloseTo(90);
  });
});

describe("V2-113 forgiving hit-testing", () => {
  it("gives tiny elements a minimum hit box and near-miss tolerance", () => {
    const m = new Map([["tiny", box(100, 100, 6, 4)]]);
    expect(hitTest(m, 115, 100)).toBeUndefined();
    expect(hitCandidates(m, 115, 100, { min: 48 })).toEqual(["tiny"]); // inside the 48px box
    expect(hitCandidates(m, 130, 100, { min: 48 })).toEqual([]);
    expect(hitCandidates(m, 125, 100, { tol: 24 })).toEqual(["tiny"]); // 22px from the edge
    expect(boxDistance(box(0, 0, 10, 10), 8, 0)).toBe(3);
    expect(boxDistance(box(0, 0, 10, 10, Math.PI / 4), 5, 5)).toBeCloseTo(Math.hypot(5, 5) - 5);
  });
  it("prefers the smallest element, then the topmost, and skips hidden ones", () => {
    const m = new Map([["video", box(500, 500, 1000, 1000)], ["text", box(100, 100, 30, 20)], ["ghost", box(100, 100, 10, 10)], ["img", box(100, 100, 30, 20)]]);
    m.get("ghost")!.alpha = 0;
    expect(hitCandidates(m, 100, 100, { tol: 24, min: 48 })).toEqual(["img", "text", "video"]);
    expect(pickAt(m, 100, 100, { tol: 24 })).toBe("img");
    expect(pickAt(m, 900, 900, { tol: 24 })).toBe("video");
    expect(pickAt(m, 2000, 2000, { tol: 24 })).toBeUndefined();
  });
  it("a repeated tap at the same spot cycles through overlapping elements", () => {
    const m = new Map([["video", box(500, 500, 1000, 1000)], ["a", box(100, 100, 40, 40)], ["b", box(110, 100, 60, 40)]]);
    const o = { tol: 24, min: 48 };
    expect(pickAt(m, 105, 100, o)).toBe("a");
    expect(pickAt(m, 105, 100, { ...o, current: "a", cycle: true })).toBe("b");
    expect(pickAt(m, 105, 100, { ...o, current: "b", cycle: true })).toBe("video");
    expect(pickAt(m, 105, 100, { ...o, current: "video", cycle: true })).toBe("a");
    expect(pickAt(m, 105, 100, { ...o, current: "a", cycle: false })).toBe("a");
    expect(pickAt(m, 105, 100, { ...o, skip: (id) => id === "video", current: "b", cycle: true })).toBe("a");
  });
  it("treats near-full-frame boxes as backdrops", () => {
    expect(isBackdrop(box(500, 500, 1000, 1000), 1000, 1000)).toBe(true);
    expect(isBackdrop(box(500, 500, 600, 600), 1000, 1000)).toBe(false);
  });
});
