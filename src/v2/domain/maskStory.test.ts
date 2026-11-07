import { describe, expect, it } from "vitest";
import { storyboardFromDoc } from "./storyboard";
import { storyDocJson, validateStoryboard } from "./storyJson";
import { storyboardToDoc } from "./storyRoundtrip";
import { TICKS_PER_SECOND as S } from "./time";
import { maskToJson } from "./mask";

const doc = {
  format: "dionysus.storyboard/1", schemaVersion: "3.1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "clip", name: "Clip", type: "video", prompt: "A street at dusk, no text.", source: "generate", qa: ["Is it dusk?"] },
    { id: "photo", name: "Photo", type: "image", prompt: "A paper sign, no text.", source: "generate", qa: ["Is it a sign?"] },
  ],
  shots: [{
    id: "s1", title: "S", description: "A street", durationSec: 3, clip: "clip", qa: [],
    mask: { shape: "ellipse", x: 0.5, y: 0.4, w: 0.4, h: 0.6, feather: 0.02, keys: { x: [{ t: 0, v: 0.5 }, { t: 1, v: 0.6 }] } },
    layers: [
      { id: "l1", type: "image", asset: "photo", startSec: 0, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 }, mask: { shape: "rect", x: 0.5, y: 0.5, w: 0.5, h: 0.4, radius: 0.2, invert: true } },
      { id: "bad", type: "image", asset: "photo", startSec: 0, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 }, mask: { shape: "path", closed: false, nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }] } },
    ],
  }],
};

describe("P49 storyboard mask", () => {
  it("round-trips seconds, keeps node ids, and warns instead of crashing on a bad path", () => {
    const parsed = validateStoryboard(doc);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => e.message).join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings.some((i) => /closed|at least 3/.test(i.message))).toBe(true);
    const board = storyboardFromDoc(parsed.doc);
    expect(board.shots.s1.mask?.keys?.x?.[1].t).toBe(S);
    expect(board.shots.s1.layers?.[1]).not.toHaveProperty("mask");
    const layer = board.shots.s1.layers?.[0];
    expect(layer && layer.type !== "text" && layer.mask?.invert).toBe(true);
    const again = JSON.parse(storyDocJson(storyboardToDoc(board)));
    expect(again.shots[0].mask).toMatchObject({ shape: "ellipse", feather: 0.02, keys: { x: [{ t: 0, v: 0.5 }, { t: 1, v: 0.6 }] } });
    expect(again.shots[0].layers[0].mask).toMatchObject({ shape: "rect", radius: 0.2, invert: true });
    expect(maskToJson(board.shots.s1.mask!).keys).toBeTruthy();
  });
});
