import { describe, expect, it } from "vitest";
import { hitTest, inBox } from "./hit";
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
