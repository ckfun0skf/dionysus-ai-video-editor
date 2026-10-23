import { describe, expect, it } from "vitest";
import { createProject, evalKeys, fadeAt, transformAt, type Composition, type Placement } from "./model";
import * as ops from "./ops";

const S = 120000;
const clip = (over: Partial<Placement> = {}): Placement => ({ id: "v", startTicks: S, durationTicks: 4 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video", ...over });
const comp = (p: Placement): Composition => {
  const c = Object.values(createProject().compositions)[0];
  return { ...c, tracks: c.tracks.map((t) => (t.kind === "video" ? { ...t, placements: [p] } : t)) };
};
const all = (c: Composition) => c.tracks.flatMap((t) => t.placements);

describe("fades and keyframes", () => {
  it("evalKeys interpolates and holds", () => {
    const k = [{ t: 0, v: 0 }, { t: 100, v: 1 }];
    expect(evalKeys(k, -5)).toBe(0); expect(evalKeys(k, 50)).toBe(0.5); expect(evalKeys(k, 500)).toBe(1); expect(evalKeys(undefined, 1)).toBeUndefined();
  });
  it("fades ramp and are clamped to the duration", () => {
    const c = ops.setFades(comp(clip()), "v", { in: S, out: 10 * S });
    const p = all(c)[0];
    expect(p.fadeInTicks).toBe(S); expect(p.fadeOutTicks).toBe(3 * S);
    expect(fadeAt(p, S)).toBe(0); expect(fadeAt(p, 1.5 * S)).toBe(0.5); expect(fadeAt(p, 5 * S)).toBe(0);
    expect(all(ops.setFades(c, "v", { in: 0 }))[0].fadeInTicks).toBeUndefined();
  });
  it("keyframes animate the transform; same-time keys replace; null removes", () => {
    let c = ops.setKeyframe(comp(clip()), "v", "x", 0, 0);
    c = ops.setKeyframe(c, "v", "x", 2 * S, 0.5);
    c = ops.setKeyframe(c, "v", "x", 2 * S + 100, 1);
    const p = all(c)[0];
    expect(p.keyframes!.x).toHaveLength(2);
    expect(transformAt(p, 3 * S).x).toBeCloseTo(1, 3);
    c = ops.setKeyframe(ops.setKeyframe(c, "v", "x", 0, null), "v", "x", 2 * S, null);
    expect(all(c)[0].keyframes).toBeUndefined();
  });
  it("split keeps animation continuous and fades on the outer edges", () => {
    let c = ops.setKeyframe(ops.setKeyframe(comp(clip({ fadeInTicks: S / 2, fadeOutTicks: S / 2 })), "v", "scale", 0, 1), "v", "scale", 4 * S, 2);
    const before = transformAt(all(c)[0], 4 * S).scale;
    c = ops.splitPlacement(c, "v", 3 * S, "r");
    const [l, r] = all(c);
    expect(transformAt(r, 4 * S).scale).toBeCloseTo(before);
    expect(l.fadeOutTicks).toBeUndefined(); expect(r.fadeInTicks).toBeUndefined();
    expect(l.fadeInTicks).toBe(S / 2); expect(r.fadeOutTicks).toBe(S / 2);
  });
  it("opacity combines keyframes and fade", () => {
    const p = clip({ fadeInTicks: 2 * S, keyframes: { opacity: [{ t: 0, v: 0.5 }] } });
    expect(transformAt(p, 2 * S).opacity).toBeCloseTo(0.25);
  });
});
