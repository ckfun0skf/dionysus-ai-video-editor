import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, type Composition, type Placement } from "./model";
import * as ops from "./ops";
import { canMergeUp, mergeLayerUp, mergeTarget, planMergeUp } from "./mergeLayer";
import * as mergeLayer from "./mergeLayer";

const S = 120000;
const vid = (id: string, start: number, dur: number): Placement => ({ id, startTicks: start * S, durationTicks: dur * S, sourceInTicks: 0, clipType: "image", source: { kind: "assetVersion", assetId: id, versionId: id } } as Placement);
const txt = (id: string, start: number, dur: number): Placement => ({ id, startTicks: start * S, durationTicks: dur * S, sourceInTicks: 0, clipType: "text", text: { text: id }, source: { kind: "assetVersion", assetId: "", versionId: "" } } as Placement);

/** Overlay group: "top" above "low" (array index 0 = top layer). */
function build(top: Placement[], low: Placement[]): Composition {
  const p = createProject("t");
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "video", "low", "overlay");
  c = ops.addTrack(c, "video", "top", "overlay");
  c = ops.addTrack(c, "text", "t1");
  const fill = (id: string, xs: Placement[]) => (t: Composition["tracks"][number]) => (t.id === id ? { ...t, placements: xs } : t);
  c = { ...c, tracks: c.tracks.map(fill("top", top)).map(fill("low", low)) };
  const ti = c.tracks.findIndex((t) => t.id === "top"), li = c.tracks.findIndex((t) => t.id === "low");
  if (ti > li) { const tr = [...c.tracks]; [tr[ti], tr[li]] = [tr[li], tr[ti]]; c = { ...c, tracks: tr }; }
  return c;
}
const spans = (c: Composition, id = "top") => c.tracks.find((t) => t.id === id)!.placements.map((p) => [p.id, p.startTicks / S, (p.startTicks + p.durationTicks) / S]);
let n = 0; const ids = () => `n${++n}`;

describe("merge layer up (P32)", () => {
  it("targets the layer above in the same group; never main, never the top layer, never across groups", () => {
    const c = build([], []);
    expect(mergeTarget(c, "low")?.id).toBe("top");
    expect(canMergeUp(c, "top")).toBe(false);
    expect(canMergeUp(c, ops.mainTrack(c)!.id)).toBe(false);
    expect(canMergeUp(c, "t1")).toBe(false);
    expect(() => planMergeUp(c, "low", "t1")).toThrow(/same group/);
  });
  it("no overlaps: clips move up and the empty layer is removed", () => {
    const c = build([vid("a", 0, 2)], [vid("b", 3, 2)]);
    const r = mergeLayerUp(c, "low");
    expect(r.plan.conflicts).toEqual([]);
    expect(spans(r.comp)).toEqual([["a", 0, 2], ["b", 3, 5]]);
    expect(r.comp.tracks.some((t) => t.id === "low")).toBe(false);
  });
  it("overlaps without a resolution throw and list the clips", () => {
    const c = build([vid("a", 0, 4)], [vid("b", 2, 4)]);
    expect(planMergeUp(c, "low").conflicts).toEqual([{ incomingId: "b", existingIds: ["a"], startTicks: 2 * S, endTicks: 4 * S }]);
    expect(() => mergeLayerUp(c, "low")).toThrow(/choose a resolution/);
  });
  it("shift: the incoming clip moves to the first gap that holds it", () => {
    const c = build([vid("a", 0, 4), vid("c", 5, 3)], [vid("b", 2, 2)]);
    expect(spans(mergeLayerUp(c, "low", { resolve: "shift" }).comp)).toEqual([["a", 0, 4], ["c", 5, 8], ["b", 8, 10]]);
    const c2 = build([vid("a", 0, 4), vid("c", 7, 3)], [vid("b", 2, 2)]);
    expect(spans(mergeLayerUp(c2, "low", { resolve: "shift" }).comp)).toEqual([["a", 0, 4], ["b", 4, 6], ["c", 7, 10]]);
  });
  it("trimExisting: the target clip is cut away under the incoming one (split when it spans it)", () => {
    n = 0;
    const c = build([vid("a", 0, 10)], [vid("b", 4, 2)]);
    expect(spans(mergeLayerUp(c, "low", { resolve: "trimExisting", ids }).comp)).toEqual([["a", 0, 4], ["b", 4, 6], ["n1", 6, 10]]);
  });
  it("trimIncoming: only the parts in the gaps are kept; a fully covered clip is dropped", () => {
    n = 0;
    const c = build([vid("a", 2, 2)], [vid("b", 0, 6)]);
    expect(spans(mergeLayerUp(c, "low", { resolve: "trimIncoming", ids }).comp)).toEqual([["b", 0, 2], ["a", 2, 4], ["n1", 4, 6]]);
    const r = mergeLayerUp(build([vid("a", 0, 6)], [vid("b", 1, 2)]), "low", { resolve: "trimIncoming" });
    expect(r.dropped).toEqual(["b"]); expect(spans(r.comp)).toEqual([["a", 0, 6]]);
  });
  it("pushLater: target clips from the incoming start move later; a spanning clip is split", () => {
    n = 0;
    const c = build([vid("a", 0, 4), vid("c", 6, 2)], [vid("b", 2, 3)]);
    expect(spans(mergeLayerUp(c, "low", { resolve: "pushLater", ids }).comp)).toEqual([["a", 0, 2], ["b", 2, 5], ["n1", 5, 7], ["c", 9, 11]]);
  });
  it("per-clip resolutions", () => {
    const c = build([vid("a", 0, 2), vid("c", 6, 2)], [vid("b", 1, 2), vid("d", 7, 2)]);
    const r = mergeLayerUp(c, "low", { resolve: { b: "shift", d: "trimIncoming" } });
    expect(spans(r.comp)).toEqual([["a", 0, 2], ["b", 2, 4], ["c", 6, 8], ["d", 8, 9]]);
  });
  it("text clips keep their look: the source layer style is baked in", () => {
    let c = build([], []);
    c = ops.addTrack(c, "text", "t0");
    const tracks = c.tracks.filter((t) => t.kind === "text");
    const [upper, lower] = tracks;
    c = { ...c, tracks: c.tracks.map((t) => (t.id === lower.id ? { ...t, layerStyle: { text: { color: "#ff0000" } }, placements: [txt("x", 0, 2)] } : t.id === upper.id ? { ...t, layerStyle: { text: { color: "#00ff00" } } } : t)) };
    const r = mergeLayerUp(c, lower.id);
    expect(r.comp.tracks.find((t) => t.id === upper.id)!.placements[0].text?.color).toBe("#ff0000");
  });
  it("the command is one undo step", () => {
    const p = createProject("t");
    const e = new Engine(p);
    e.dispatch(cmd.addTrack("video")); e.dispatch(cmd.addTrack("video"));
    const comp = () => e.getState().project.compositions[e.getState().project.rootCompositionId];
    const ov = comp().tracks.filter((t) => ops.groupOf(comp(), t) === "overlay");
    expect(ov.length).toBe(2);
    const before = comp().tracks.length;
    expect(e.dispatch(cmd.mergeLayerUp(ov[1].id))).toBeTruthy();
    expect(comp().tracks.length).toBe(before - 1);
    e.undo();
    expect(comp().tracks.length).toBe(before);
  });
});

describe("P33 dialog layout", () => {
  const P = (id: string, s: number, d: number) => ({ id, clipType: "text", startTicks: s, durationTicks: d, sourceInTicks: 0, source: { assetId: "", versionId: "" }, text: { text: id } }) as never;
  const comp = { id: "r", durationTicks: 0, tracks: [
    { id: "top", name: "T2", kind: "text", placements: [P("a", 0, 240000)] },
    { id: "low", name: "T1", kind: "text", placements: [P("b", 120000, 240000)] },
  ] } as never;
  const ids = () => "x1";
  it("overlaps are found, keepPrimary trims the other, moveInLayout clamps at 0", () => {
    const l = mergeLayer.initialLayout(mergeLayer.planMergeUp(comp, "low"));
    expect(mergeLayer.layoutOverlaps(l)).toEqual([{ a: "a", b: "b", startTicks: 120000, endTicks: 240000 }]);
    const kb = mergeLayer.keepPrimary(l, "b", ids);
    expect(kb.upper.map((p) => [p.startTicks, p.durationTicks])).toEqual([[0, 120000]]);
    expect(mergeLayer.layoutOverlaps(kb)).toEqual([]);
    expect(mergeLayer.moveInLayout(l, "b", -5).incoming[0].startTicks).toBe(0);
  });
  it("mergeLayerUp applies a clear layout in one step and refuses one with overlaps", () => {
    const l = mergeLayer.initialLayout(mergeLayer.planMergeUp(comp, "low"));
    expect(() => mergeLayer.mergeLayerUp(comp, "low", { layout: l })).toThrow(/overlap/);
    const moved = mergeLayer.moveInLayout(l, "b", 240000);
    const r = mergeLayer.mergeLayerUp(comp, "low", { layout: moved });
    expect(r.comp.tracks.map((t) => t.id)).toEqual(["top"]);
    expect(r.comp.tracks[0].placements.map((p) => [p.id, p.startTicks])).toEqual([["a", 0], ["b", 240000]]);
  });
  it("P34 trimThis carves the selected clip around the others; trimInLayout clamps; previewLayout drops the source", () => {
    const l = mergeLayer.initialLayout(mergeLayer.planMergeUp(comp, "low"));
    const tb = mergeLayer.trimThis(l, "b", ids);
    expect(tb.incoming.map((p) => [p.id, p.startTicks, p.durationTicks])).toEqual([["b", 240000, 120000]]);
    expect(tb.upper[0].durationTicks).toBe(240000);
    expect(mergeLayer.layoutOverlaps(tb)).toEqual([]);
    const ext = mergeLayer.trimInLayout(l, "b", "right", 600000, 300000);
    expect(ext.incoming[0].durationTicks).toBe(300000); // extends only as far as the source allows
    const cut = mergeLayer.trimInLayout(l, "b", "left", 240000);
    expect([cut.incoming[0].startTicks, cut.incoming[0].durationTicks]).toEqual([240000, 120000]);
    const pv = mergeLayer.previewLayout(comp, mergeLayer.planMergeUp(comp, "low"), cut);
    expect(pv.tracks.map((t) => t.id)).toEqual(["top"]);
    expect(pv.tracks[0].placements.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
