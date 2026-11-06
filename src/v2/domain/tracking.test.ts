import { describe, expect, it } from "vitest";
import { createProject, type Placement, type Project } from "./model";
import { secondsToTicks as s } from "./time";
import { boxIssue, followKeys, sampleAt, thin, trackPosAt, trackSignal, type MotionTrack } from "./tracking";
import { inputSourceOf, resolveSource, sourceChoices } from "./codeInputs";

const track: MotionTrack = { srcW: 1920, srcH: 1080, samples: [0, 1, 2].map((i) => ({ s: s(i), x: 0.25 + i * 0.25, y: 0.5, w: 0.1, h: 0.1, scale: 1 + i * 0.5, conf: i === 1 ? 0.4 : 0.9 })) };
const clip = (o: Partial<Placement>): Placement => ({ id: "v", startTicks: 0, durationTicks: s(3), sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "a1" }, clipType: "video", ...o });
function proj(...pls: Placement[]): Project {
  const p = createProject("t");
  const c = p.compositions[p.rootCompositionId];
  c.tracks[0] = { ...c.tracks[0], placements: pls };
  return p;
}

describe("P39 tracking domain", () => {
  it("interpolates samples by source time and holds outside", () => {
    expect(sampleAt(track, s(0.5))!.x).toBeCloseTo(0.375);
    expect(sampleAt(track, s(9))!.x).toBe(0.75);
  });
  it("maps the box to canvas offsets through the clip transform", () => {
    const p = proj(clip({ motionTrack: track }));
    const v = p.compositions[p.rootCompositionId].tracks[0].placements[0];
    expect(trackPosAt(p, v, 0)!.x).toBeCloseTo(-0.25);
    const half = { ...v, transform: { x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } } };
    expect(trackPosAt(p, half, 0)!.x).toBeCloseTo(0.1 - 0.125);
  });
  it("bakes follow keyframes that keep the follower's offset and scale with the box", () => {
    const v = clip({ motionTrack: track }), t = clip({ id: "t", clipType: "text", transform: { x: 0.2, y: -0.1, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } } });
    const k = followKeys(proj(v, t), v, t, 0);
    expect(k.x![0].v).toBeCloseTo(0.2);
    expect(k.x![k.x!.length - 1].v).toBeCloseTo(0.2 + 0.5, 2);
    expect(k.y!.every((q) => Math.abs(q.v + 0.1) < 1e-6)).toBe(true);
    expect(k.scale![k.scale!.length - 1].v).toBeGreaterThan(1.9);
    expect(k.x!.length).toBeLessThan(10); // thinned: a straight line keeps only its ends and bends
  });
  it("thin keeps bends and drops collinear keys", () => {
    expect(thin([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 0 }]).map((k) => k.t)).toEqual([0, 2, 3]);
  });
  it("validates regions", () => {
    expect(boxIssue({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBeUndefined();
    expect(boxIssue({ x: 0.9, y: 0.1, w: 0.2, h: 0.2 })).toMatch(/inside/);
    expect(boxIssue({ x: 0.1, y: 0.1, w: 0.001, h: 0.2 })).toMatch(/small/);
    expect(boxIssue(undefined)).toMatch(/numbers/);
  });
  it("feeds a code clip's track input: numbers only, none by default, found false on weak frames", () => {
    const v = clip({ motionTrack: track }), h = clip({ id: "h", clipType: "html" });
    const p = proj(v, h);
    expect(sourceChoices(p, "track", "h").map((c) => c.source)).toEqual(["none", "clip:v"]);
    expect(inputSourceOf(p, h, "target", "track")).toBe("none");
    expect(resolveSource(p, "clip:v", "track")).toEqual({ source: "clip:v" });
    expect("error" in resolveSource(p, "program", "track")).toBe(true);
    expect(trackSignal(p, "none", 0).found).toBe(false);
    const sig = trackSignal(p, "clip:v", 0);
    expect(sig).toMatchObject({ x: 0.25, y: 0.5, found: true });
    expect(Object.values(sig).every((x) => typeof x === "number" || typeof x === "boolean")).toBe(true);
    expect(trackSignal(p, "clip:v", s(1)).found).toBe(false);
  });
});
