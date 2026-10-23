import { describe, expect, it } from "vitest";
import { clampRowLeft, edgeSpeed, EDGE_MAX, EDGE_ZONE, reorderSlot } from "./Timeline";

describe("reorder edge auto-scroll (V2-095)", () => {
  it("is still in the middle and faster deeper into an edge zone", () => {
    expect(edgeSpeed(200, 390)).toBe(0);
    expect(edgeSpeed(390 - EDGE_ZONE / 2, 390)).toBeGreaterThan(0);
    expect(edgeSpeed(389, 390)).toBeGreaterThan(edgeSpeed(390 - EDGE_ZONE / 2, 390));
    expect(edgeSpeed(0, 390)).toBe(-EDGE_MAX);
    expect(edgeSpeed(5, 390)).toBeLessThan(edgeSpeed(EDGE_ZONE / 2, 390));
  });
  it("scrolling the row lets the first clip reach the last slot", () => {
    const n = 12, W = 390, base = 20;
    let left = base;
    for (let i = 0; i < 200; i++) left = clampRowLeft(left - edgeSpeed(385, W), base, n, W);
    expect(left).toBeLessThan(base);
    expect(reorderSlot(385, left, n)).toBe(n - 1);
    for (let i = 0; i < 200; i++) left = clampRowLeft(left - edgeSpeed(2, W), base, n, W);
    expect(left).toBe(Math.max(base, EDGE_ZONE));
  });
});
