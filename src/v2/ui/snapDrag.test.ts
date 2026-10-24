import { describe, expect, it } from "vitest";
import { DISMISS, pickSnap, rubberBand, springAt, velocityOf } from "./snapDrag";

const P = [250, 460, 760]; // peek / half / full (px) on an 844px phone

describe("pickSnap — position + velocity → snap", () => {
  it("slow release goes to the nearest snap", () => {
    expect(pickSnap(P, 300, 0)).toBe(0);
    expect(pickSnap(P, 400, 0)).toBe(1);
    expect(pickSnap(P, 640, 0.1)).toBe(2);
    expect(pickSnap(P, 600, -0.1)).toBe(1);
  });
  it("projects the end position ~200ms ahead", () => {
    expect(pickSnap(P, 340, 0.4)).toBe(1); // 340 + 80 = 420 → half
    expect(pickSnap(P, 380, -0.45)).toBe(0); // 380 - 90 = 290 → peek
  });
  it("a flick (> 0.5 px/ms) always moves at least one snap in its direction", () => {
    expect(pickSnap(P, 470, 0.6)).toBe(2); // barely above half, flick up → full
    expect(pickSnap(P, 460, -0.6)).toBe(0); // at half, flick down → peek
    expect(pickSnap(P, 255, 0.6)).toBe(1);
    expect(pickSnap(P, 260, 3)).toBe(1); // even a hard flick moves one snap — predictable
  });
  it("dismisses only when allowed", () => {
    expect(pickSnap(P, 240, -0.6, { dismissible: true })).toBe(DISMISS);
    expect(pickSnap(P, 240, -0.6)).toBe(0);
    expect(pickSnap(P, 110, 0, { dismissible: true })).toBe(DISMISS);
    expect(pickSnap(P, 200, 0, { dismissible: true })).toBe(0);
    expect(pickSnap(P, 760, -4, { dismissible: true })).toBe(1); // hard flick from full → half, never straight to closed
  });
  it("flick at the top stays at the top", () => {
    expect(pickSnap(P, 780, 1)).toBe(2);
  });
});

describe("feel helpers", () => {
  it("rubber-bands past the ends but stays free inside", () => {
    expect(rubberBand(500, 250, 760)).toBe(500);
    const over = rubberBand(900, 250, 760);
    expect(over).toBeGreaterThan(760); expect(over).toBeLessThan(840);
    expect(rubberBand(2000, 250, 760)).toBeLessThan(841);
    expect(rubberBand(100, 250, 760)).toBeGreaterThan(170);
  });
  it("velocity uses only the last 100ms", () => {
    expect(velocityOf([[0, 0], [500, 1000], [550, 1010], [600, 1020]])).toBeCloseTo(0.2);
    expect(velocityOf([[0, 0]])).toBe(0);
  });
  it("critically damped spring settles in ~300ms without big overshoot", () => {
    expect(Math.abs(springAt(400, 460, 0, 300) - 460)).toBeLessThan(1);
    for (let t = 0; t < 600; t += 16) expect(springAt(400, 460, 0, t)).toBeLessThanOrEqual(460.01);
  });
});
