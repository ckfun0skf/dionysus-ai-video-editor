import { describe, expect, it } from "vitest";
import { createProject, IDENTITY_TRANSFORM, transformOf, type Composition, type Placement } from "./model";
import * as ops from "./ops";
import { placeRect } from "../render/frame";

const clip = (over: Partial<Placement> = {}): Placement => ({ id: "v", startTicks: 0, durationTicks: 120000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video", ...over });
const compWith = (p: Placement): Composition => {
  const c = Object.values(createProject().compositions)[0];
  return { ...c, tracks: c.tracks.map((t) => (t.kind === "video" ? { ...t, placements: [p] } : t)) };
};
const get = (c: Composition) => c.tracks.flatMap((t) => t.placements)[0];

describe("transform", () => {
  it("defaults to identity and merges patches", () => {
    expect(transformOf(clip())).toEqual(IDENTITY_TRANSFORM);
    const c = ops.setTransform(compWith(clip()), "v", { x: 0.25, crop: { l: 0.1 } });
    expect(transformOf(get(c))).toMatchObject({ x: 0.25, scale: 1, crop: { l: 0.1, r: 0 } });
  });
  it("clamps and resets", () => {
    let c = ops.setTransform(compWith(clip()), "v", { scale: 0, opacity: 5, crop: { l: 0.9, r: 0.9 } });
    const t = transformOf(get(c));
    expect(t.scale).toBe(0.05); expect(t.opacity).toBe(1); expect(t.crop.l + t.crop.r).toBeLessThanOrEqual(0.95);
    c = ops.setTransform(c, "v", null);
    expect(get(c).transform).toBeUndefined();
  });
  it("ignores audio clips", () => {
    const c = compWith(clip());
    const a = { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => ({ ...p, clipType: "audio" as const })) })) };
    expect(get(ops.setTransform(a, "v", { x: 1 })).transform).toBeUndefined();
  });
  it("placeRect applies scale, offset and crop", () => {
    const r = placeRect(clip({ transform: { ...IDENTITY_TRANSFORM, scale: 0.5, x: 0.1 } }), 1920, 1080, 1280, 720);
    expect(r).toMatchObject({ w: 640, h: 360, cx: 640 + 128, cy: 360 });
    const c = placeRect(clip({ transform: { ...IDENTITY_TRANSFORM, crop: { l: 0.5, t: 0, r: 0, b: 0 } } }), 100, 100, 100, 100);
    expect(c).toMatchObject({ sx: 50, sw: 50, w: 50, cx: 75 });
  });
});
