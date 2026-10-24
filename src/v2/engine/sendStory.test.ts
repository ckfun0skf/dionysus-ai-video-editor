import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { board, EXAMPLE_STORYBOARD } from "../domain";
import { createProject, type MediaRef, type Project } from "../domain/model";
import { validateStoryboard } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

const r = validateStoryboard(EXAMPLE_STORYBOARD);
if (!r.ok) throw new Error("bad example");
const clip = (sec: number): MediaRef => ({ blobKey: `b${sec}`, mime: "video/mp4", durationTicks: s(sec) });
const main = (p: Project) => ops.mainTrack(p.compositions[p.rootCompositionId])!;
const shotAsset = (e: Engine, id: string) => e.getState().project.storyboard!.shots[id].assetId!;

function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.ok ? r.doc : (undefined as never)));
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(5), { versionId: "a1" }));
  e.dispatch(cmd.addStoryVersion({ shot: "s3" }, clip(4), { versionId: "c1" }));
  return e;
}

describe("send storyboard to timeline", () => {
  it("appends shots with clips in story order, skips the rest, one undo", () => {
    const e = setup();
    expect(board.sendPlan(e.getState().project).map((x) => x.state)).toEqual(["ready", "missing", "ready"]);
    e.dispatch(cmd.sendStoryToTimeline());
    const pls = main(e.getState().project).placements;
    expect(pls.map((p) => [p.source.versionId, p.startTicks, p.durationTicks])).toEqual([["a1", 0, s(5)], ["c1", s(5), s(4)]]);
    expect(board.sendPlan(e.getState().project).map((x) => x.state)).toEqual(["placed", "missing", "placed"]);
    e.undo();
    expect(main(e.getState().project).placements).toHaveLength(0);
  });

  it("sending again only adds new shots, after what is already there", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, clip(6), { versionId: "b1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(main(e.getState().project).placements.map((p) => [p.source.versionId, p.startTicks])).toEqual([["a1", 0], ["c1", s(5)], ["b1", s(9)]]);
  });

  it("linked clips follow the picked version, keeping trims and clamping to shorter media", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    const id = main(e.getState().project).placements[0].id;
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(3), { versionId: "a2" }));
    let pl = main(e.getState().project).placements.find((p) => p.id === id)!;
    expect([pl.source.versionId, pl.durationTicks]).toEqual(["a2", s(3)]);
    e.dispatch(cmd.selectStoryVersion(shotAsset(e, "s1"), "a1"));
    pl = main(e.getState().project).placements.find((p) => p.id === id)!;
    expect([pl.source.versionId, pl.durationTicks]).toEqual(["a1", s(3)]);
    e.undo();
    expect(main(e.getState().project).placements.find((p) => p.id === id)!.source.versionId).toBe("a2");
  });

  it("skipped shots are not sent", () => {
    const e = setup();
    e.dispatch(cmd.setStorySkipped({ shot: "s3" }, true));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(main(e.getState().project).placements.map((p) => p.source.versionId)).toEqual(["a1"]);
  });
});
