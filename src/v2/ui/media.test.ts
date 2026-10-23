import { describe, expect, it } from "vitest";
import { clipBars, computePeaks, nearestFrame } from "./media";

describe("waveform peaks", () => {
  it("buckets max |sample| across channels and normalises", () => {
    const l = new Float32Array([0.1, -0.2, 0, 0.5]);
    const r = new Float32Array([0, 0, -1, 0]);
    const p = computePeaks([l, r], 4, 2); // 2 samples per bucket
    expect(Array.from(p.data)).toEqual([0.2, 1].map((x) => Math.fround(x)));
  });
  it("slices the used source span, respecting speed and reverse", () => {
    const peaks = { perSecond: 1, data: new Float32Array([0, 0.25, 0.5, 0.75, 1]) };
    expect(clipBars(peaks, 1, 2, 1, false, 2)).toEqual([0.25, 0.5]);
    expect(clipBars(peaks, 1, 2, 1, true, 2)).toEqual([0.5, 0.25]);
    expect(clipBars(peaks, 0, 2, 2, false, 2)).toEqual([0.25, 0.75]);
  });
});

describe("filmstrip", () => {
  it("picks the nearest sampled frame", () => {
    expect(nearestFrame([0.5, 1.5, 2.5], 0)).toBe(0);
    expect(nearestFrame([0.5, 1.5, 2.5], 1.9)).toBe(1);
    expect(nearestFrame([0.5, 1.5, 2.5], 99)).toBe(2);
  });
});
