import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, type Composition, type Placement, type Project } from "./model";
import * as ops from "./ops";
import { canPromote, cutPart, droppedProps, promoteOverlay } from "./promote";
import { syncPlan } from "./storySync";

const S = 120000;
const vid = (id: string, start: number, dur: number, extra: Partial<Placement> = {}): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "video", source: { kind: "assetVersion", assetId: id, versionId: id }, ...extra } as Placement);
const txt = (id: string, start: number, dur: number, parent?: string): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "text", text: { text: id }, source: { kind: "assetVersion", assetId: "", versionId: "" }, ...(parent ? { link: { parent } } : {}) } as Placement);

function build(mains: Placement[], overlay: Placement, texts: Placement[] = []): Composition {
  const p = createProject("t");
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "video", "ovt", "overlay");
  c = ops.addTrack(c, "text", "tt");
  const m = ops.mainTrack(c)!;
  return { ...c, tracks: c.tracks.map((t) => (t.id === m.id ? { ...t, placements: mains } : t.id === "ovt" ? { ...t, placements: [overlay] } : t.id === "tt" ? { ...t, placements: texts } : t)) };
}
const mainOf = (c: Composition) => ops.mainTrack(c)!.placements.map((p) => [p.id, p.startTicks / S, (p.startTicks + p.durationTicks) / S, p.sourceInTicks / S]);
let n = 0; const ids = () => `n${++n}`;

describe("promote overlay: replace (P20)", () => {
  it("S1 0-6, S2 6-12, overlay 4-8 → S1 0-4, promoted 4-8, S2 8-12 with S2 in point +2s", () => {
    const c = build([vid("s1", 0, 6 * S), vid("s2", 6 * S, 6 * S)], vid("ov", 4 * S, 4 * S));
    const { comp, plan } = promoteOverlay(c, "ov", { ids });
    expect(mainOf(comp)).toEqual([["s1", 0, 4, 0], ["ov", 4, 8, 0], ["s2", 8, 12, 2]]);
    expect(comp.tracks.find((t) => t.id === "ovt")!.placements).toEqual([]);
    expect(plan.durationAfter).toBe(plan.durationBefore);
  });
  it("one main clip spanning 0-12 splits into S1a 0-4, promoted 4-8, S1b 8-12 (in point continues)", () => {
    n = 0;
    const c = build([vid("s1", 0, 12 * S, { sourceInTicks: S, fadeInTicks: S / 2, fadeOutTicks: S / 2 })], vid("ov", 4 * S, 4 * S));
    const { comp } = promoteOverlay(c, "ov", { ids });
    expect(mainOf(comp)).toEqual([["s1", 0, 4, 1], ["ov", 4, 8, 0], ["n1", 8, 12, 9]]);
    const [a, , b] = ops.mainTrack(comp)!.placements;
    expect(a.fadeOutTicks).toBeUndefined(); expect(a.fadeInTicks).toBe(S / 2);
    expect(b.fadeInTicks).toBeUndefined(); expect(b.fadeOutTicks).toBe(S / 2);
  });
  it("on exact boundaries: replaces the clips it covers and trims nothing else", () => {
    const c = build([vid("s1", 0, 4 * S), vid("s2", 4 * S, 4 * S), vid("s3", 8 * S, 4 * S)], vid("ov", 4 * S, 4 * S));
    const { comp, plan } = promoteOverlay(c, "ov");
    expect(mainOf(comp)).toEqual([["s1", 0, 4, 0], ["ov", 4, 8, 0], ["s3", 8, 12, 0]]);
    expect(plan.notes.some((x) => x.includes("Removes main clip s2"))).toBe(true);
  });
  it("covering several main clips: trims the outer two and removes the ones inside", () => {
    const c = build([vid("s1", 0, 3 * S), vid("s2", 3 * S, 2 * S), vid("s3", 5 * S, 2 * S), vid("s4", 7 * S, 3 * S)], vid("ov", 2 * S, 6 * S));
    expect(mainOf(promoteOverlay(c, "ov").comp)).toEqual([["s1", 0, 2, 0], ["ov", 2, 8, 0], ["s4", 8, 10, 1]]);
  });
  it("partial overlap at the end of the main track extends it", () => {
    const c = build([vid("s1", 0, 6 * S)], vid("ov", 4 * S, 6 * S));
    const { comp, plan } = promoteOverlay(c, "ov");
    expect(mainOf(comp)).toEqual([["s1", 0, 4, 0], ["ov", 4, 10, 0]]);
    expect([plan.durationBefore / S, plan.durationAfter / S]).toEqual([6, 10]);
  });
  it("overlay fully beyond the end keeps its time and reports the gap", () => {
    const c = build([vid("s1", 0, 6 * S)], vid("ov", 8 * S, 2 * S));
    const { comp, plan } = promoteOverlay(c, "ov");
    expect(mainOf(comp)).toEqual([["s1", 0, 6, 0], ["ov", 8, 10, 0]]);
    expect(plan.notes.some((x) => x.includes("gap"))).toBe(true);
  });
  it("reverse and still clips: cut parts keep the right source", () => {
    const r = vid("r", 0, 10 * S, { reverse: true });
    expect(cutPart(r, 0, 4 * S).sourceInTicks).toBe(6 * S);
    expect(cutPart(r, 6 * S, 10 * S).sourceInTicks).toBe(0);
    expect(cutPart({ ...r, clipType: "image", reverse: false }, 6 * S, 10 * S).sourceInTicks).toBe(0);
    expect(cutPart(vid("x", 0, 10 * S, { speed: 2 }), 4 * S, 10 * S).sourceInTicks).toBe(8 * S);
  });
  it("drops blend and chroma key, keeps the transform by default, keeps audio", () => {
    const ov = vid("ov", 4 * S, 2 * S, { blend: "screen", chromaKey: { color: "#00ff00", range: 0.4, spill: 0.5 }, transform: { x: 0.2, y: 0, scale: 0.5, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } }, volume: 0.7, link: { parent: "s1" } });
    expect(droppedProps(ov)).toEqual(["blend mode (screen)", "chroma key"]);
    expect(droppedProps(ov, false)).toContain("position / scale / rotation / opacity / crop");
    const c = build([vid("s1", 0, 12 * S)], ov);
    const kept = ops.mainTrack(promoteOverlay(c, "ov").comp)!.placements.find((p) => p.id === "ov")!;
    expect(kept.blend).toBeUndefined(); expect(kept.chromaKey).toBeUndefined(); expect(kept.link).toBeUndefined();
    expect(kept.transform?.scale).toBe(0.5); expect(kept.volume).toBe(0.7);
    const reset = ops.mainTrack(promoteOverlay(c, "ov", { keepTransform: false }).comp)!.placements.find((p) => p.id === "ov")!;
    expect(reset.transform).toBeUndefined();
  });
  it("linked clips: re-link to the main clip under their start, cut to it, removed when nothing is left", () => {
    n = 0;
    const c = build([vid("s1", 0, 12 * S)], vid("ov", 4 * S, 4 * S), [txt("t0", S, 2 * S, "s1"), txt("t1", 3 * S, 3 * S, "s1"), txt("t2", 5 * S, S, "s1"), txt("t3", 9 * S, S, "s1"), txt("free", 5 * S, S)]);
    const tt = promoteOverlay(c, "ov", { ids }).comp.tracks.find((t) => t.id === "tt")!.placements;
    const m = Object.fromEntries(tt.map((p) => [p.id, [p.startTicks / S, (p.startTicks + p.durationTicks) / S, p.link?.parent]]));
    expect(m).toEqual({ t0: [1, 3, "s1"], t1: [3, 4, "s1"], t2: [5, 6, "ov"], t3: [9, 10, "n1"], free: [5, 6, undefined] });
  });
});

describe("promote overlay: insert (P20)", () => {
  const two = () => build([vid("s1", 0, 6 * S), vid("s2", 6 * S, 6 * S)], vid("ov", 4 * S, 4 * S), [txt("t2", 7 * S, S, "s2"), txt("t1", S, S, "s1")]);
  it("inside a clip asks for before / after and changes nothing", () => {
    const { comp, plan } = promoteOverlay(two(), "ov", { mode: "insert" });
    expect(plan.inside).toEqual({ id: "s1", startTicks: 0, endTicks: 6 * S });
    expect(mainOf(comp)).toEqual([["s1", 0, 6, 0], ["s2", 6, 12, 0]]);
  });
  it("after the clip: lands at its end, the rest ripples by the overlay duration, linked clips follow", () => {
    const { comp, plan } = promoteOverlay(two(), "ov", { mode: "insert", position: "after" });
    expect(mainOf(comp)).toEqual([["s1", 0, 6, 0], ["ov", 6, 10, 0], ["s2", 10, 16, 0]]);
    expect(comp.tracks.find((t) => t.id === "tt")!.placements.map((p) => [p.id, p.startTicks / S])).toEqual([["t2", 11], ["t1", 1]]);
    expect([plan.durationBefore / S, plan.durationAfter / S]).toEqual([12, 16]);
    expect(plan.notes.join(" ")).toContain("+4s");
  });
  it("before the clip: lands at its start and moves it later", () => {
    expect(mainOf(promoteOverlay(two(), "ov", { mode: "insert", position: "before" }).comp)).toEqual([["ov", 0, 4, 0], ["s1", 4, 10, 0], ["s2", 10, 16, 0]]);
  });
  it("on a boundary: inserts without asking", () => {
    const c = build([vid("s1", 0, 6 * S), vid("s2", 6 * S, 6 * S)], vid("ov", 6 * S, 2 * S));
    const { comp, plan } = promoteOverlay(c, "ov", { mode: "insert" });
    expect(plan.inside).toBeUndefined();
    expect(mainOf(comp)).toEqual([["s1", 0, 6, 0], ["ov", 6, 8, 0], ["s2", 8, 14, 0]]);
  });
  it("beyond the end: appended at its own time, nothing ripples", () => {
    const c = build([vid("s1", 0, 6 * S)], vid("ov", 7 * S, 2 * S));
    expect(mainOf(promoteOverlay(c, "ov", { mode: "insert" }).comp)).toEqual([["s1", 0, 6, 0], ["ov", 7, 9, 0]]);
  });
  it("refuses main-track clips and non-visual clips", () => {
    const c = build([vid("s1", 0, 6 * S)], vid("ov", 0, S));
    expect(canPromote(c, "s1")).toBe(false);
    expect(canPromote(c, "ov")).toBe(true);
    expect(() => promoteOverlay(c, "s1")).toThrow();
  });
});

describe("promote command (engine + storyboard)", () => {
  function engine(c: Composition, extra: Partial<Project> = {}) {
    const p = createProject("t");
    const asset = (id: string) => ({ id, kind: "video", name: id, versions: [{ id, createdAt: "", media: { blobKey: id, mime: "video/mp4", durationTicks: 60 * S }, provenance: { source: "import", inputs: [] } }] });
    return new Engine({ ...p, rootCompositionId: c.id, assets: Object.fromEntries(["s1", "s2", "ov"].map((id) => [id, asset(id)])) as Project["assets"], compositions: { [c.id]: c }, ...extra });
  }
  const rootOf = (e: Engine) => e.getState().project.compositions[e.getState().project.rootCompositionId];
  it("is one undo step and keeps linked clips consistent through applyLinks", () => {
    const c = build([vid("s1", 0, 6 * S), vid("s2", 6 * S, 6 * S)], vid("ov", 4 * S, 4 * S), [txt("t2", 9 * S, S, "s2"), txt("t1", 5 * S, S, "s1")]);
    const e = engine(c);
    expect(e.dispatch(cmd.promoteOverlay("ov"))).toBe(true);
    expect(mainOf(rootOf(e))).toEqual([["s1", 0, 4, 0], ["ov", 4, 8, 0], ["s2", 8, 12, 2]]);
    const tt = rootOf(e).tracks.find((t) => t.id === "tt")!.placements;
    expect(tt.map((p) => [p.id, p.startTicks / S, p.link?.parent])).toEqual([["t2", 9, "s2"], ["t1", 5, "ov"]]);
    e.undo();
    expect(mainOf(rootOf(e))).toEqual([["s1", 0, 6, 0], ["s2", 6, 12, 0]]);
  });
  it("insert inside a clip without a position is refused", () => {
    const e = engine(build([vid("s1", 0, 6 * S)], vid("ov", 2 * S, S)));
    expect(() => cmd.promoteOverlay("ov", { mode: "insert" }).apply(e.getState().project)).toThrow(/before.*after/);
    expect(e.dispatch(cmd.promoteOverlay("ov", { mode: "insert" }))).toBe(false);
  });
  it("storyboard sync: promoted clip → needsPrompt shot, split right part → continues the original shot", () => {
    const c = build([vid("s1", 0, 12 * S, { storyShot: "a" })], vid("ov", 4 * S, 4 * S));
    const shot = { id: "a", title: "Harbour", description: "d", durationSec: 12, prompt: "p", slotIds: [], qa: [], assetId: "s1" };
    const sb = { order: ["a"], shots: { a: shot }, slots: {}, versions: {} } as unknown as Project["storyboard"];
    const e = engine(c, { storyboard: sb });
    e.dispatch(cmd.promoteOverlay("ov"));
    const { project, changes } = syncPlan(e.getState().project);
    const b = project.storyboard!;
    expect(b.order).toEqual(["a", "shot-tl-1", "a-part-1"]);
    expect(b.shots["shot-tl-1"].needsPrompt).toBe(true);
    expect(b.shots["a-part-1"]).toMatchObject({ prompt: "p", assetId: "s1", durationSec: 4 });
    expect(b.shots["a-part-1"].needsPrompt).toBeUndefined();
    expect(changes.some((x) => x.label.includes("continues"))).toBe(true);
  });
  it("storyboard: an overlay whose asset is a shot's clip maps to that shot", () => {
    const c = build([vid("s1", 0, 6 * S, { storyShot: "a" })], vid("ov", 2 * S, 2 * S));
    const sb = { order: ["a", "b"], shots: { a: { id: "a", title: "A", description: "", durationSec: 6, prompt: "p", slotIds: [], qa: [], assetId: "s1" }, b: { id: "b", title: "B", description: "", durationSec: 2, prompt: "q", slotIds: [], qa: [], assetId: "ov" } }, slots: {}, versions: {} } as unknown as Project["storyboard"];
    const e = engine(c, { storyboard: sb });
    e.dispatch(cmd.promoteOverlay("ov"));
    expect(rootOf(e).tracks.flatMap((t) => t.placements).find((p) => p.id === "ov")!.storyShot).toBe("b");
  });
});
