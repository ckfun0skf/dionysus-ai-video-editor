import { describe, expect, it } from "vitest";
import { getAudioEnvelope } from "./audioEnvelope";

describe("audio envelope", () => {
  it("defaults to full volume and silences points outside the clip", () => {
    expect(getAudioEnvelope(undefined, undefined, undefined, 0, 4)).toBe(1);
    expect(getAudioEnvelope(undefined, undefined, undefined, 3.9, 4)).toBe(1);
    expect(getAudioEnvelope(undefined, undefined, undefined, -0.1, 4)).toBe(0);
    expect(getAudioEnvelope(undefined, undefined, undefined, 4, 4)).toBe(0);
  });

  it("clamps volume and applies independent fade-in and fade-out ramps", () => {
    expect(getAudioEnvelope(0.6, 2, 1, 0, 5)).toBe(0);
    expect(getAudioEnvelope(0.6, 2, 1, 1, 5)).toBeCloseTo(0.3, 6);
    expect(getAudioEnvelope(0.6, 2, 1, 2, 5)).toBeCloseTo(0.6, 6);
    expect(getAudioEnvelope(0.6, 2, 1, 4.5, 5)).toBeCloseTo(0.3, 6);
    expect(getAudioEnvelope(0.6, 2, 1, 5, 5)).toBe(0);
    expect(getAudioEnvelope(2, 0, 0, 1, 5)).toBe(1);
    expect(getAudioEnvelope(-1, 0, 0, 1, 5)).toBe(0);
  });

  it("combines fades when their ranges overlap and handles zero-duration clips", () => {
    expect(getAudioEnvelope(1, 4, 4, 2, 5)).toBeCloseTo(0.375, 6);
    expect(getAudioEnvelope(1, 1, 1, 0.5, 1)).toBeCloseTo(0.25, 6);
    expect(getAudioEnvelope(1, 1, 1, 0, 0)).toBe(0);
    expect(getAudioEnvelope(1, 1, 1, Number.NaN, 4)).toBe(0);
  });
});
