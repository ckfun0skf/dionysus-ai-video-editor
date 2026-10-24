import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, type Project } from "./model";
import { DEFAULT_TEXT } from "./text";
import { effectivePlacement, isCustom, SUBTITLE_STYLE } from "./layerStyle";
import { Player } from "../render";
import { createMemoryStorage } from "../persistence";

const root = (p: Project) => p.compositions[p.rootCompositionId];
const srt = [{ id: "s1", startTicks: 0, durationTicks: 240000, text: "One" }, { id: "s2", startTicks: 240000, durationTicks: 240000, text: "Two" }];
function setup() {
  const e = new Engine(createProject("x"));
  e.dispatch(cmd.importSrtLayer(srt, "sub"));
  const track = () => root(e.getState().project).tracks.find((t) => t.id === "sub")!;
  return { e, track };
}

describe("layer styles (V2-103)", () => {
  it("merge precedence: default ← layer ← clip override", () => {
    const track = { layerStyle: { text: { color: "#ff0000", size: 0.08 }, transform: { y: 0.3 } } };
    const p = { id: "a", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "", versionId: "" }, clipType: "text" as const, text: { text: "Hi", size: 0.2 } as never, transform: { x: 0.1 } as never };
    const eff = effectivePlacement(track, p);
    expect(eff.text).toMatchObject({ text: "Hi", color: "#ff0000", size: 0.2, font: DEFAULT_TEXT.font });
    expect(eff.transform).toMatchObject({ x: 0.1, y: 0.3 });
    expect(effectivePlacement(undefined, p)).toBe(p); // unstyled layers: legacy clips unchanged
  });
  it("SRT import makes a subtitle layer whose clips store only their words", () => {
    const { track } = setup();
    expect(track().layerStyle).toEqual(SUBTITLE_STYLE);
    expect(track().placements.map((p) => p.text)).toEqual([{ text: "One" }, { text: "Two" }]);
    expect(track().placements.some((p) => isCustom(track(), p))).toBe(false);
  });
  it("Edit all updates every clip, clears their overrides for that key, and a slider gesture is one undo step", () => {
    const { e, track } = setup();
    const [a] = track().placements;
    e.dispatch(cmd.updateText(a.id, { color: "#00ff00" }));
    expect(isCustom(track(), track().placements[0])).toBe(true);
    e.beginGesture();
    for (const s of [0.07, 0.08, 0.09]) e.dispatch(cmd.setLayerStyle("sub", { text: { size: s } }));
    e.endGesture();
    e.dispatch(cmd.setLayerStyle("sub", { text: { color: "#ffff00" } }));
    expect(track().placements.map((p) => effectivePlacement(track(), p).text!.color)).toEqual(["#ffff00", "#ffff00"]);
    expect(track().placements.map((p) => effectivePlacement(track(), p).text!.size)).toEqual([0.09, 0.09]);
    expect(isCustom(track(), track().placements[0])).toBe(false);
    e.undo(); // color
    expect(effectivePlacement(track(), track().placements[0]).text!.color).toBe("#00ff00");
    e.undo(); // whole size drag
    expect(track().layerStyle!.text!.size).toBe(SUBTITLE_STYLE.text!.size);
  });
  it("Reset to layer style drops a clip's overrides; Whole-layer transform moves all clips", () => {
    const { e, track } = setup();
    const id = track().placements[1].id;
    e.dispatch(cmd.updateText(id, { bold: false }));
    e.dispatch(cmd.setTransform(id, { x: 0.2 }));
    expect(isCustom(track(), track().placements[1])).toBe(true);
    e.dispatch(cmd.resetToLayerStyle(id));
    expect(track().placements[1]).not.toHaveProperty("transform");
    expect(track().placements[1].text).toEqual({ text: "Two" });
    e.dispatch(cmd.setLayerStyle("sub", { transform: { y: -0.3 } }));
    expect(track().placements.map((p) => effectivePlacement(track(), p).transform!.y)).toEqual([-0.3, -0.3]);
  });
  it("legacy full-style text clips keep rendering the same and are not marked custom by default", () => {
    const e = new Engine(createProject("x"));
    e.dispatch(cmd.addTextClip(0, { text: "Old" }, "o"));
    const t = () => root(e.getState().project).tracks.find((x) => x.placements.some((p) => p.id === "o"))!;
    e.dispatch(cmd.setLayerStyle(t().id, { text: { size: 0.05 } }));
    const p = t().placements[0];
    expect(isCustom(t(), p)).toBe(false);
    expect(effectivePlacement(t(), p).text!.size).toBe(0.05);
  });
  it("render/export path draws with the effective style (position and colour from the layer)", () => {
    const { e } = setup();
    e.dispatch(cmd.setLayerStyle("sub", { text: { color: "#123456" } }));
    const fills: string[] = [];
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (o, k) => (k in o ? o[k] : k === "measureText" ? () => ({ width: 10 }) : () => undefined),
      set: (o, k, v) => { if (k === "fillStyle") fills.push(v); o[k] = v; return true; },
    });
    const canvas = { width: 1000, height: 500, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const player = new Player(e.getState().project, createMemoryStorage().blobs, { kind: "wall", now: () => 0 } as never);
    player.canvas = canvas;
    player.draw();
    const id = root(e.getState().project).tracks.find((t) => t.id === "sub")!.placements[0].id;
    expect(player.boxes.get(id)!.cy).toBeCloseTo(250 + 0.38 * 500);
    expect(fills).toContain("#123456");
  });
});
