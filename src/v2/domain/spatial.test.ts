import { describe, expect, it } from "vitest";
import { audioOutputOf, createProject, exampleStoryboardJson, keyPosAt, lerpAz, panToAzimuth, positionErrors, spatialParams, story } from ".";

describe("P14 spatial audio maths", () => {
  it("centre at width 1 is unity: no gain change, full stereo image, no filter", () => {
    const c = spatialParams({ azimuth: 0, distance: 0 });
    expect(c.midL).toBeCloseTo(1); expect(c.midR).toBeCloseTo(1); expect(c.side).toBeCloseTo(1); expect(c.gain).toBeCloseTo(1);
    expect(c.lowpass).toBeGreaterThanOrEqual(19000);
  });
  it("width keeps a stereo pair's image; width 0 is mono; mono input has no side so it is a point source", () => {
    expect(spatialParams({ azimuth: -90, distance: 0, width: 1 }).side).toBeCloseTo(1);
    expect(spatialParams({ azimuth: 0, distance: 0, width: 0 }).side).toBeCloseTo(0);
    const l = spatialParams({ azimuth: -90, distance: 0 });
    expect(l.midL).toBeGreaterThan(1.3); expect(l.midR).toBeCloseTo(0);
  });
  it("distance lowers gain, darkens and adds reverb; behind is darker than front", () => {
    const near = spatialParams({ azimuth: 0, distance: 0 }), far = spatialParams({ azimuth: 0, distance: 1 });
    expect(far.gain).toBeLessThan(near.gain); expect(far.lowpass).toBeLessThan(near.lowpass); expect(far.reverb).toBeGreaterThan(near.reverb);
    expect(spatialParams({ azimuth: 180, distance: 0.5 }).lowpass).toBeLessThan(spatialParams({ azimuth: 0, distance: 0.5 }).lowpass);
  });
  it("keys interpolate the shorter way round; pan maps to azimuth", () => {
    expect(lerpAz(170, -170, 0.5)).toBeCloseTo(180, 0);
    expect(keyPosAt([{ t: 0, azimuth: -60, distance: 0 }, { t: 10, azimuth: 60, distance: 1 }], 5)).toMatchObject({ azimuth: 0, distance: 0.5 });
    expect(panToAzimuth(-1)).toBe(-90);
  });
  it("validates ranges and old projects default to stereo / room", () => {
    expect(positionErrors("p", { azimuth: 0, distance: 0.5, width: 1 })).toEqual([]);
    expect(positionErrors("p", { azimuth: 400, distance: 2 }).length).toBeGreaterThan(0);
    expect(audioOutputOf(createProject("t"))).toEqual({ mode: "stereo", environment: "room" });
  });
  it("the guide example carries a moving wind and a placed chime", () => {
    const r = story.parseStoryboard(exampleStoryboardJson());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.audio?.find((a) => a.id === "wind")?.positionKeys).toHaveLength(2);
      expect(r.doc.audio?.find((a) => a.id === "chime")?.position).toEqual({ azimuth: 0, distance: 0.3 });
    }
  });
});
