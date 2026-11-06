import { describe, expect, it } from "vitest";
import { createProject, type Placement, type Project } from "./model";
import { secondsToTicks as s } from "./time";
import { boxIssue, followKeys, missingRanges, nextTrackName, pickTrack, sampleAt, thin, trackPosAt, trackSignal, trackSpan, withRange, type NamedTrack } from "./tracking";
import { inputSourceOf, resolveSource, sourceChoices, sourceLabel } from "./codeInputs";

/** Box moving right and growing 1 → 2× over 0..2 s; frame 1 s weak; frame 3 s lost (left the picture). */
const mk = (id = "mt1", name = "Track 1", inS = 0, outS = s(4)): NamedTrack => ({ id, name, inS, outS, srcW: 1920, srcH: 1080,
  samples: [0, 1, 2, 3].map((i) => ({ s: s(i), x: 0.25 + Math.min(i, 2) * 0.25, y: 0.5, w: 0.1 * (1 + Math.min(i, 2) / 2), h: 0.1, scale: 1 + Math.min(i, 2) / 2, conf: i === 1 ? 0.5 : i === 3 ? 0.1 : 0.9, ...(i === 3 ? { lost: true } : {}) })) });
const clip = (o: Partial<Placement>): Placement => ({ id: "v", startTicks: 0, durationTicks: s(4), sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "a1" }, clipType: "video", ...o });
function proj(...pls: Placement[]): Project {
  const p = createProject("t");
  const c = p.compositions[p.rootCompositionId];
  c.tracks[0] = { ...c.tracks[0], placements: pls };
  return p;
}

describe("P39/P40 tracking domain", () => {
  it("interpolates samples, never interpolates into a lost frame, and is undefined outside the range", () => {
    const tr = mk();
    expect(sampleAt(tr, s(0.5))!.x).toBeCloseTo(0.375);
    expect(sampleAt(tr, s(2.5))!.lost).toBe(true);
    expect(sampleAt(withRange(tr, s(1), s(2)), s(0.5))).toBeUndefined();
  });
  it("maps the box to canvas offsets through the clip transform", () => {
    const tr = mk(), v = clip({ motionTracks: [tr] }), p = proj(v);
    expect(trackPosAt(p, v, 0, tr)!.x).toBeCloseTo(-0.25);
    const half = { ...v, transform: { x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } } };
    expect(trackPosAt(p, half, 0, tr)!.x).toBeCloseTo(0.1 - 0.125);
    expect(trackPosAt(p, v, s(3), tr)).toBeUndefined(); // lost: no position
  });
  it("bakes follow keys that keep the offset, follow the changing box size, and hold on lost frames", () => {
    const tr = mk(), v = clip({ motionTracks: [tr] }), t = clip({ id: "t", clipType: "text", transform: { x: 0.2, y: -0.1, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } } });
    const k = followKeys(proj(v, t), v, tr, t, 0);
    expect(k.x![0].v).toBeCloseTo(0.2);
    expect(Math.max(...k.x!.map((q) => q.v))).toBeCloseTo(0.7, 2);
    expect(Math.max(...k.scale!.map((q) => q.v))).toBeCloseTo(2, 1);
    expect(Math.max(...k.x!.map((q) => q.t))).toBeLessThan(s(2.6)); // no keys in the lost stretch
  });
  it("thin keeps bends and drops collinear keys", () => {
    expect(thin([{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 0 }]).map((q) => q.t)).toEqual([0, 2, 3]);
  });
  it("validates regions", () => {
    expect(boxIssue({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBeUndefined();
    expect(boxIssue({ x: 0.9, y: 0.1, w: 0.2, h: 0.2 })).toMatch(/inside/);
    expect(boxIssue({ x: 0.1, y: 0.1, w: 0.001, h: 0.2 })).toMatch(/small/);
    expect(boxIssue(undefined)).toMatch(/numbers/);
  });
  it("several named trackers per clip: names, picking, span and range edits", () => {
    const a = mk(), b = mk("mt2", "Ball", s(1), s(3)), v = clip({ motionTracks: [a, b] });
    expect(nextTrackName(v)).toEqual({ id: "mt3", name: "Track 3" });
    expect(pickTrack(v)).toMatch(/2 trackers: pass trackId/);
    expect((pickTrack(v, "ball") as NamedTrack).id).toBe("mt2");
    expect(trackSpan({ ...v, startTicks: s(10), speed: 2 }, b)).toEqual({ start: s(10.5), end: s(11.5) });
    expect(withRange(a, s(1), s(2)).samples.map((x) => x.s)).toEqual([s(1)]);
    const shrunk = withRange(a, s(1), s(2));
    expect(missingRanges(shrunk, 0, s(3)).map((m) => [m.from, m.seed.s])).toEqual([[0, s(1)], [s(1) + 1, s(1)]]);
    expect(missingRanges(a, 0, s(4))).toEqual([]);
  });
  it("feeds a code clip's track input per tracker: numbers only, found:false when weak, lost or out of range", () => {
    const a = mk(), b = mk("mt2", "Ball", s(1), s(4)), v = clip({ motionTracks: [a, b] }), h = clip({ id: "h", clipType: "html" });
    const p = proj(v, h);
    expect(sourceChoices(p, "track", "h").map((c) => c.source)).toEqual(["none", "clip:v#mt1", "clip:v#mt2"]);
    expect(sourceLabel(p, "clip:v#mt2")).toBe("a1 · Ball".replace("a1", sourceLabel(p, "clip:v#mt2").split(" · ")[0]));
    expect(inputSourceOf(p, h, "target", "track")).toBe("none");
    expect(resolveSource(p, "clip:v#mt2", "track")).toEqual({ source: "clip:v#mt2" });
    expect((resolveSource(p, "clip:v", "track") as { error: string }).error).toMatch(/2 trackers/);
    expect(resolveSource(proj(clip({ motionTracks: [a] }), h), "clip:v", "track")).toEqual({ source: "clip:v#mt1" });
    expect("error" in resolveSource(p, "program", "track")).toBe(true);
    const sig = trackSignal(p, "clip:v#mt1", 0);
    expect(sig).toMatchObject({ x: 0.25, y: 0.5, scale: 1, found: true });
    expect(Object.values(sig).every((x) => typeof x === "number" || typeof x === "boolean")).toBe(true);
    expect(trackSignal(p, "clip:v#mt1", s(2)).scale).toBeCloseTo(2);
    expect(trackSignal(p, "clip:v#mt1", s(1)).found).toBe(false); // weak
    expect(trackSignal(p, "clip:v#mt1", s(3))).toMatchObject({ found: false, width: 0 }); // lost: no invented position
    expect(trackSignal(p, "clip:v#mt2", s(0.5)).found).toBe(false); // before Ball's range
    expect(trackSignal(p, "none", 0).found).toBe(false);
  });
});
