import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, sourceAt, type Asset, type Placement, type Project } from "./model";
import * as ops from "./ops";
import * as slip from "./slip";
import { audioPlan } from "../render/export/plan";

const S = 120000;
const clip = (id: string, start: number, dur: number, extra: Partial<Placement> = {}): Placement =>
  ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "video", source: { kind: "assetVersion", assetId: id, versionId: id }, ...extra } as Placement);
const asset = (id: string, kind: Asset["kind"], secs?: number): Asset =>
  ({ id, kind, name: id, versions: [{ id, createdAt: "", media: { blobKey: id, mime: "x", ...(secs ? { durationTicks: secs * S } : {}) }, provenance: { source: "import", inputs: [] } }] } as Asset);
const root = (p: Project) => p.compositions[p.rootCompositionId];
function setup(main: Placement[], over: Placement[] = [], assets: Asset[] = []) {
  const p = createProject("t");
  let c = root(p);
  c = ops.addTrack(c, "audio", "au");
  const m = ops.mainTrack(c)!;
  c = { ...c, tracks: c.tracks.map((t) => (t.id === m.id ? { ...t, placements: main } : t.id === "au" ? { ...t, placements: over } : t)) };
  const e = new Engine({ ...p, assets: Object.fromEntries(assets.map((a) => [a.id, a])), compositions: { [c.id]: c } });
  const get = (id: string) => root(e.getState().project).tracks.flatMap((t) => t.placements).find((x) => x.id === id)!;
  return { e, get };
}

describe("P26 slip (Adjust range)", () => {
  it("slips 3–6 s to 4–7 s: start and length stay, one undo step", () => {
    const { e, get } = setup([clip("v", 2 * S, 3 * S, { sourceInTicks: 3 * S, storyTrim: { inTicks: 0, outTicks: 1 } as never })], [], [asset("v", "video", 10)]);
    expect(e.dispatch(cmd.slipClip("v", 4 * S))).toBe(true);
    expect(get("v")).toMatchObject({ startTicks: 2 * S, durationTicks: 3 * S, sourceInTicks: 4 * S });
    expect(get("v").storyTrim).toBeUndefined();
    e.undo();
    expect(get("v").sourceInTicks).toBe(3 * S);
  });
  it("clamps to the media (in + length ≤ media) and to 0", () => {
    const { e, get } = setup([clip("v", 0, 3 * S)], [], [asset("v", "video", 10)]);
    e.dispatch(cmd.slipClip("v", 50 * S)); expect(get("v").sourceInTicks).toBe(7 * S);
    e.dispatch(cmd.slipClip("v", -5 * S)); expect(get("v").sourceInTicks).toBe(0);
  });
  it("speed counts: a 2× clip of 3 s uses 6 s of source", () => {
    const { e, get } = setup([clip("v", 0, 3 * S, { speed: 2 })], [], [asset("v", "video", 10)]);
    e.dispatch(cmd.slipClip("v", 9 * S)); expect(get("v").sourceInTicks).toBe(4 * S);
  });
  it("moves linked audio by the same delta when asked, each clamped", () => {
    const kid = clip("a", S, 2 * S, { clipType: "audio", sourceInTicks: S, link: { parent: "v" } });
    const { e, get } = setup([clip("v", 0, 3 * S)], [kid], [asset("v", "video", 10), asset("a", "audio", 4)]);
    e.dispatch(cmd.slipClip("v", 2 * S, false)); expect(get("a")).toMatchObject({ sourceInTicks: S, startTicks: S, durationTicks: 2 * S });
    e.dispatch(cmd.slipClip("v", 0, false));
    e.dispatch(cmd.slipClip("v", 5 * S, true));
    expect(get("v").sourceInTicks).toBe(5 * S);
    expect(get("a").sourceInTicks).toBe(2 * S); // 1 + 5 = 6 clamped to 4 − 2
    expect(get("a").startTicks).toBe(S);
  });
  it("HTML clips slip their time offset; images, text and freeze frames do not slip", () => {
    const { e, get } = setup([clip("h", 0, 3 * S, { clipType: "html" }), clip("i", 3 * S, S, { clipType: "image" }), clip("f", 4 * S, S, { freeze: true } as never)], [], [asset("h", "html"), asset("i", "image"), asset("f", "video", 5)]);
    e.dispatch(cmd.slipClip("h", 2.5 * S)); expect(get("h").sourceInTicks).toBe(2.5 * S);
    expect(sourceAt(get("h"), S)).toBe(3.5 * S);
    expect(slip.slipBounds(e.getState().project, get("i"))).toBeUndefined();
    expect(slip.slipBounds(e.getState().project, get("f"))).toBeUndefined();
    expect(e.dispatch(cmd.slipClip("i", S))).toBe(false);
  });
  it("unlocked: in/out set the length (start stays)", () => {
    const { e, get } = setup([clip("v", 0, 3 * S)], [], [asset("v", "video", 10)]);
    e.dispatch(cmd.setSlipRange("v", S, 5 * S));
    expect(get("v")).toMatchObject({ startTicks: 0, sourceInTicks: S, durationTicks: 4 * S });
  });
  it("export plays the slipped range (audio plan offset)", () => {
    const { e } = setup([clip("v", 0, 3 * S)], [clip("a", 0, 2 * S, { clipType: "audio" })], [asset("v", "video", 10), asset("a", "audio", 9)]);
    e.dispatch([cmd.slipClip("a", 4 * S)], "Adjust range");
    expect(audioPlan(e.getState().project).find((x) => x.blobKey === "a")?.offset).toBe(4);
  });
});

describe("P26 replace asset", () => {
  const props = { volume: 0.5, transform: { x: 0.1 } as never, effect: undefined, keyframes: { opacity: [{ t: 0, v: 1 }] } as never, link: undefined, position: { azimuth: 30, distance: 0.2 } };
  it("keeps position, length, transform, volume, keyframes and the in point when the source is long enough", () => {
    const { e, get } = setup([clip("v", 2 * S, 3 * S, { sourceInTicks: 2 * S, ...props })], [], [asset("v", "video", 10), asset("w", "video", 8)]);
    expect(e.dispatch(cmd.replaceClipAsset("v", "w"))).toBe(true);
    expect(get("v")).toMatchObject({ startTicks: 2 * S, durationTicks: 3 * S, sourceInTicks: 2 * S, volume: 0.5, source: { assetId: "w", versionId: "w" }, position: props.position, keyframes: props.keyframes });
    e.undo(); expect(get("v").source.assetId).toBe("v");
  });
  it("shifts the in point earlier when the end would pass the new source", () => {
    const { e, get } = setup([clip("v", 0, 3 * S, { sourceInTicks: 6 * S })], [], [asset("v", "video", 10), asset("w", "video", 4)]);
    e.dispatch(cmd.replaceClipAsset("v", "w")); expect(get("v").sourceInTicks).toBe(S);
  });
  it("a shorter source needs a choice: shorten or hold the last frame", () => {
    const { e, get } = setup([clip("v", 0, 5 * S), clip("n", 5 * S, S)], [], [asset("v", "video", 10), asset("w", "video", 2), asset("n", "video", 5)]);
    const r = slip.replaceClipAsset(e.getState().project, "v", "w");
    expect(r.ok).toBe(false); expect(!r.ok && r.needsChoice).toBe(true);
    expect(e.dispatch(cmd.replaceClipAsset("v", "w"))).toBe(false);
    e.dispatch(cmd.replaceClipAsset("v", "w", "shorten"));
    expect(get("v")).toMatchObject({ durationTicks: 2 * S, sourceInTicks: 0 }); expect(get("n").startTicks).toBe(5 * S);
    e.undo();
    e.dispatch(cmd.replaceClipAsset("v", "w", "hold"));
    expect(get("v").durationTicks).toBe(5 * S);
    expect(sourceAt(get("v"), 4 * S)).toBe(slip.holdPoint(2 * S));
    expect(sourceAt(get("v"), S)).toBe(S);
  });
  it("rejects other kinds and text clips", () => {
    const { e } = setup([clip("v", 0, 3 * S), clip("t", 3 * S, S, { clipType: "text" })], [], [asset("v", "video", 10), asset("a", "audio", 10)]);
    expect(slip.replaceError(e.getState().project, "v", "a")).toMatch(/same kind/);
    expect(slip.replaceError(e.getState().project, "t", "v")).toMatch(/text clip/);
  });
  it("a later slip after replace + hold stays one undo step when dispatched together", () => {
    const { e, get } = setup([clip("v", 0, 3 * S)], [], [asset("v", "video", 10), asset("w", "video", 8)]);
    e.dispatch([cmd.replaceClipAsset("v", "w"), cmd.slipClip("v", 4 * S)], "Replace asset");
    expect(get("v")).toMatchObject({ sourceInTicks: 4 * S, source: { assetId: "w" } });
    e.undo(); expect(get("v")).toMatchObject({ sourceInTicks: 0, source: { assetId: "v" } });
  });
});
