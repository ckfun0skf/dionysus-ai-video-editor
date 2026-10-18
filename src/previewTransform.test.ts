import { describe, expect, it } from "vitest";
import { moveNormalizedFrame, resizeNormalizedFrame } from "./previewTransform";

describe("normalized preview frame transforms", () => {
  it("moves a frame while keeping it inside the canvas", () => {
    expect(moveNormalizedFrame({ x: 10, y: 15, width: 40, height: 30 }, 12, -6))
      .toEqual({ x: 22, y: 9, width: 40, height: 30 });
    expect(moveNormalizedFrame({ x: 90, y: 90, width: 40, height: 30 }, 10, 10))
      .toEqual({ x: 60, y: 70, width: 40, height: 30 });
  });

  it("resizes from each corner and respects canvas boundaries", () => {
    expect(resizeNormalizedFrame({ x: 10, y: 10, width: 40, height: 30 }, "se", 10, 5))
      .toEqual({ x: 10, y: 10, width: 50, height: 35 });
    expect(resizeNormalizedFrame({ x: 10, y: 10, width: 40, height: 30 }, "nw", 5, 5))
      .toEqual({ x: 15, y: 15, width: 35, height: 25 });
    expect(resizeNormalizedFrame({ x: 10, y: 10, width: 40, height: 30 }, "se", 90, 90))
      .toEqual({ x: 10, y: 10, width: 90, height: 90 });
  });

  it("never permits a zero-sized or off-canvas frame", () => {
    const frame = resizeNormalizedFrame({ x: 0, y: 0, width: 8, height: 8 }, "nw", 100, 100);
    expect(frame.width).toBeGreaterThanOrEqual(2);
    expect(frame.height).toBeGreaterThanOrEqual(2);
    expect(frame.x + frame.width).toBeLessThanOrEqual(100);
    expect(frame.y + frame.height).toBeLessThanOrEqual(100);
  });
});
