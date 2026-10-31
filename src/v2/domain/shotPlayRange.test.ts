/** P15-TRIM-PREVIEW: the part of a clip a storyboard shot plays and thumbnails. */
import { describe, expect, it } from "vitest";
import { createProject, type MediaRef } from "./model";
import * as board from "./storyboard";
import { validateStoryboard } from "./storyJson";
import { TICKS_PER_SECOND } from "./time";

const T = TICKS_PER_SECOND;
const vid = (sec: number, key = "v"): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: sec * T });
const start = (layer: Record<string, unknown> | null) => {
  const r = validateStoryboard({
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "dust", name: "Dust", type: "video", prompt: "Dust", qa: [] }],
    shots: [{ id: "a", title: "A", description: "", durationSec: 4, prompt: "Walk", assets: [], qa: [],
      layers: layer ? [{ id: "d", type: "video", asset: "dust", startSec: 0, endSec: 2, box: { x: 0, y: 0, width: 1, height: 1 }, ...layer }] : [] }],
    connections: [],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return board.setStoryboard(createProject("p"), board.storyboardFromDoc(r.doc));
};

describe("shotPlayRange (P15-TRIM-PREVIEW)", () => {
  it("is the layer's inSec to inSec + its length for a reused video asset", () => {
    const p = board.addStoryVersion(start({ inSec: 3 }), { slot: "dust" }, vid(10), { versionId: "d1" });
    expect(board.shotPlayRange(p, p.storyboard!.shots.a)).toMatchObject({ slotId: "dust", versionId: "d1", blobKey: "v", inSec: 3, outSec: 5, fromLayer: true });
  });
  it("falls back to the asset's trim in point and clamps to the clip", () => {
    let p = board.addStoryVersion(start({}), { slot: "dust" }, vid(10), { versionId: "d1", trim: { inTicks: 6 * T, outTicks: 9 * T } });
    expect(board.shotPlayRange(p, p.storyboard!.shots.a)).toMatchObject({ inSec: 6, outSec: 8 });
    p = board.addStoryVersion(start({ inSec: 9.5 }), { slot: "dust" }, vid(10), { versionId: "d1" });
    expect(board.shotPlayRange(p, p.storyboard!.shots.a)).toMatchObject({ inSec: 9.5, outSec: 10 });
  });
  it("uses the shot's own trimmed clip first, and nothing without a video", () => {
    const p0 = start(null);
    expect(board.shotPlayRange(p0, p0.storyboard!.shots.a)).toBeUndefined();
    const p = board.addStoryVersion(p0, { shot: "a" }, vid(8, "own"), { versionId: "o1", trim: { inTicks: 2 * T, outTicks: 6 * T } });
    expect(board.shotPlayRange(p, p.storyboard!.shots.a)).toMatchObject({ versionId: "o1", inSec: 2, outSec: 6, fromLayer: false });
  });
  it("keys in-point thumbnails apart from whole-version ones", () => {
    expect(board.rangeThumbKey("v1", 0)).toBe("v1");
    expect(board.rangeThumbKey("v1", 1.23456)).toBe("v1@1.235");
  });
});
