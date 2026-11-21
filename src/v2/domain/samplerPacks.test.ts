import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSamplerManifest, pickZone, SAMPLER_PACKS, velocityGain, type SamplerManifest } from "./samplerPacks";

const root = resolve(__dirname, "../../..");
const samples = resolve(root, "public/samples");
const zone = (root: number, lo: number, hi: number, velLo = 1, velHi = 127, file = `${root}.mp3`) => ({ file, root, lo, hi, velLo, velHi });

describe("sampler packs (P91)", () => {
  it("picks the velocity layer, then the nearest recording", () => {
    const m = { zones: [zone(48, 0, 50, 1, 80), zone(52, 51, 127, 1, 80), zone(48, 0, 50, 81, 127), zone(55, 51, 127, 81, 127)] };
    expect(pickZone(m, 48, 0.5)).toBe(0);
    expect(pickZone(m, 51, 0.5)).toBe(1); // inside the second zone's range
    expect(pickZone(m, 48, 0.9)).toBe(2);
    expect(pickZone(m, 60, 1)).toBe(3);
    expect(pickZone({ zones: [zone(40, 40, 40), zone(44, 44, 44)] }, 42, 0.5)).toBe(0); // no zone contains it: nearest root, ties low
    expect(pickZone({ zones: [zone(60, 0, 127, 100, 127)] }, 60, 0.1)).toBe(0); // no layer matches: all zones
    expect(pickZone({ zones: [] }, 60, 0.5)).toBe(-1);
  });

  it("scales velocity within a layer", () => {
    expect(velocityGain(1)).toBe(1);
    expect(velocityGain(80 / 127, 80)).toBeCloseTo(1, 9);
    expect(velocityGain(40 / 127, 80)).toBeCloseTo(Math.pow(0.5, 1.2), 9);
    expect(velocityGain(0.2)).toBeLessThan(velocityGain(0.6));
  });

  it("validates manifests and refuses unsafe file paths", () => {
    const ok = { format: "dionysus.samplerpack/1", id: "x", name: "X", kind: "sustain", attack: 0.01, release: 0.4, gain: 1, zones: [{ ...zone(60, 0, 127), file: "../cello/60-p.mp3", loopStart: 1, loopEnd: 3 }] };
    const m = parseSamplerManifest(ok, "x");
    expect(m.zones[0]).toMatchObject({ file: "../cello/60-p.mp3", loopStart: 1, loopEnd: 3 });
    for (const file of ["https://evil.test/a.mp3", "/abs.mp3", "../../a.mp3", "a/../../b.mp3", ""]) expect(() => parseSamplerManifest({ ...ok, zones: [{ ...ok.zones[0], file }] }, "x")).toThrow(/invalid/);
    expect(() => parseSamplerManifest({ ...ok, format: "x" }, "x")).toThrow(/"x" instrument's manifest is invalid/);
  });

  it("every built-in pack ships a valid manifest whose files exist, covering its range, within the size budget", () => {
    let bytes = 0;
    for (const p of SAMPLER_PACKS) {
      const dir = resolve(samples, p.id);
      const m: SamplerManifest = parseSamplerManifest(JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")), p.id);
      expect(m.id).toBe(p.id);
      expect(m.kind, p.id).toBe(p.kind);
      expect(m.license).toBe("CC0-1.0");
      for (const z of m.zones) {
        expect(existsSync(resolve(dir, z.file)), `${p.id}/${z.file}`).toBe(true);
        expect(z.lo <= z.root + 12 && z.hi >= z.root - 12, `${p.id} ${z.file} range`).toBe(true);
        if (p.kind === "sustain") expect(z.loopEnd! - z.loopStart!, `${p.id}/${z.file} loop`).toBeGreaterThan(1);
      }
      const roots = m.zones.map((z) => z.root);
      expect(Math.min(...roots), p.id).toBeLessThanOrEqual(p.range[0] + 4);
      expect(Math.max(...roots), p.id).toBeGreaterThanOrEqual(p.range[1] - 4);
      // Every note in the range and every velocity finds a recording no more than 7 semitones away.
      for (let k = p.range[0]; k <= p.range[1]; k++) for (const v of [0.2, 0.9]) expect(Math.abs(m.zones[pickZone(m, k, v)].root - k), `${p.id} ${k}`).toBeLessThanOrEqual(7);
      for (const f of readdirSync(dir)) bytes += statSync(resolve(dir, f)).size;
    }
    expect(bytes).toBeLessThan(15 * 1024 * 1024);
    expect(readFileSync(resolve(samples, "CREDITS.md"), "utf8")).toContain("VSCO-2-CE");
  });
});
