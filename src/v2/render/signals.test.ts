import { describe, expect, it } from "vitest";
import { analyzeAudio, beatAt, BAND_COUNT, mixBeats, sceneFrom, SILENT } from "./signals";

describe("computed signals (P38)", () => {
  it("audio: a 100 Hz burst every 0.5 s shows in rms, the bass band and onsets; silence is zero", () => {
    const rate = 8000, s = new Float32Array(rate * 2);
    for (let i = 0; i < s.length; i += 1) { const t = i / rate; if (t % 0.5 < 0.1) s[i] = 0.8 * Math.sin(2 * Math.PI * 100 * t); }
    const a = analyzeAudio(s, rate);
    const on = beatAt(a, 0.55), off = beatAt(a, 0.8);
    expect(on.rms).toBeGreaterThan(0.5);
    expect(on.bands).toHaveLength(BAND_COUNT);
    expect(on.bands[1]).toBeGreaterThan(on.bands[6]);
    expect(off.rms).toBeLessThan(0.01);
    expect(off.envelope).toBeGreaterThan(off.rms); // envelope releases slowly
    const onsets = Array.from(a.onset).map((v, i) => (v > 0.3 ? i : -1)).filter((i) => i >= 0);
    expect(onsets.some((i) => Math.abs(i - 30) <= 2)).toBe(true);
    expect(beatAt(a, 99)).toBe(SILENT);
    expect(analyzeAudio(s, rate).rms).toEqual(a.rms); // deterministic
  });
  it("mix: energies add, peaks take the max", () => {
    const b = { ...SILENT, rms: 0.3, peak: 0.5, bands: new Array(BAND_COUNT).fill(0.3) };
    const m = mixBeats([{ beat: b, gain: 1 }, { beat: b, gain: 1 }]);
    expect(m.rms).toBeCloseTo(Math.sqrt(0.18), 3);
    expect(m.peak).toBe(0.5);
    expect(mixBeats([])).toBe(SILENT);
  });
  it("scene: luma, colour, histogram and motion from a thumbnail", () => {
    const white = new Uint8ClampedArray(32 * 18 * 4).fill(255), black = new Uint8ClampedArray(32 * 18 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0));
    const w = sceneFrom(white), k = sceneFrom(black, white);
    expect(w.luma).toBe(1); expect(w.avgColor).toEqual([1, 1, 1]); expect(w.histogram[15]).toBe(1); expect(w.motion).toBe(0);
    expect(k.luma).toBe(0); expect(k.motion).toBe(1); expect(k.histogram[0]).toBe(1);
  });
});
