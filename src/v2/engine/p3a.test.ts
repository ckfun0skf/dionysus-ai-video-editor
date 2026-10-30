/** P3A: trim to playhead (15), frame-precise in/out (24) and Match frames joins (23). */
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { clipRange } from "../domain";
import { createProject, findPlacement, type Asset, type Project } from "../domain/model";
import { secondsToTicks as s, TICKS_PER_SECOND } from "../domain/time";

const asset = (id: string, seconds: number): Asset => ({ id, kind: "video", name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "video/mp4", durationTicks: s(seconds) }, provenance: { source: "import", inputs: [] } }] });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const pl = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement;
const F = TICKS_PER_SECOND / 30;
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", 10)), cmd.importAsset(asset("w", 6))]);
  const main = ops.mainTrack(root(e.getState().project))!.id;
  e.dispatch(cmd.addAssetToTimeline("v", 0, main, "A"));
  e.dispatch(cmd.addAssetToTimeline("w", s(10), main, "B"));
  e.dispatch(cmd.addAssetToTimeline("v", s(16), main, "C"));
  return e;
}

describe("P3A-15 trim to playhead", () => {
  it("trims start and end to the playhead in one undo step each, ripple shifting later clips", () => {
    const e = setup();
    expect([pl(e, "A").durationTicks, pl(e, "B").startTicks]).toEqual([s(10), s(10)]);
    e.dispatch([cmd.trimPlacement("A", "right", s(8), true)], "Trim end to playhead");
    expect(pl(e, "A").durationTicks).toBe(s(8));
    expect(pl(e, "B").startTicks).toBe(s(8));
    e.dispatch([cmd.trimPlacement("B", "left", s(9), false)], "Trim start to playhead");
    expect(pl(e, "B")).toMatchObject({ startTicks: s(9), sourceInTicks: s(1), durationTicks: s(5) });
    e.undo();
    expect(pl(e, "B").startTicks).toBe(s(8));
    e.undo();
    expect(pl(e, "A").durationTicks).toBe(s(10));
  });
});

describe("P3A-24 in/out frames", () => {
  it("maps ticks to frames and back exactly at the project fps", () => {
    expect(clipRange.ticksToFrame(clipRange.frameToTicks(123, 30), 30)).toBe(123);
    expect(clipRange.ticksToFrame(clipRange.frameToTicks(47, 24), 24)).toBe(47);
    expect(clipRange.ticksToFrame(F - 1, 30)).toBe(0);
  });
  it("sets in and out frames, keeps the start, clamps to the media and the next clip, and is undoable", () => {
    const e = setup();
    e.dispatch(cmd.setSourceRange("A", 30 * F, 90 * F));
    expect(pl(e, "A")).toMatchObject({ startTicks: 0, sourceInTicks: 30 * F, durationTicks: 60 * F });
    // Out past the next clip's start stops there (A starts at 0, B at 10 s).
    e.dispatch(cmd.setSourceRange("A", 0, s(20)));
    expect(pl(e, "A")).toMatchObject({ sourceInTicks: 0, durationTicks: s(10) });
    // Out past the media end stops at the end of the video.
    e.dispatch(cmd.setSourceRange("C", s(2), s(30)));
    expect(pl(e, "C")).toMatchObject({ sourceInTicks: s(2), durationTicks: s(8) });
    e.undo();
    expect(pl(e, "C")).toMatchObject({ sourceInTicks: 0, durationTicks: s(10) });
  });
  it("is a no-op for freeze frames and reversed clips", () => {
    const e = setup();
    e.dispatch(cmd.setReverse("A", true));
    const before = pl(e, "A");
    e.dispatch(cmd.setSourceRange("A", F, 10 * F));
    expect(pl(e, "A")).toEqual(before);
  });
});

describe("P3A-23 match join", () => {
  it("finds the adjacent pair from either side", () => {
    const e = setup(), p = e.getState().project;
    expect(clipRange.matchPair(p, root(p), "A")!.map((x) => x.id)).toEqual(["A", "B"]);
    expect(clipRange.matchPair(p, root(p), "C")!.map((x) => x.id)).toEqual(["B", "C"]);
  });
  it("sets A's out and B's in, keeps the cut closed and shifts later clips, as one undo step", () => {
    const e = setup();
    // A ends after its source frame at 9 s, B starts at 0.5 s into its video.
    e.dispatch(cmd.matchJoin("A", "B", s(9), s(0.5)));
    expect(pl(e, "A")).toMatchObject({ startTicks: 0, durationTicks: s(9) });
    expect(pl(e, "B")).toMatchObject({ startTicks: s(9), sourceInTicks: s(0.5), durationTicks: s(5.5) });
    expect(pl(e, "C").startTicks).toBe(s(14.5));
    expect(e.getState().canUndo).toBe(true);
    e.undo();
    expect([pl(e, "A").durationTicks, pl(e, "B").startTicks, pl(e, "B").sourceInTicks, pl(e, "C").startTicks]).toEqual([s(10), s(10), 0, s(16)]);
  });
});
