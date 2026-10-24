import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { board } from "../domain";
import { LANTERN_KEEPER } from "../domain/__fixtures__/lanternKeeper";
import { createProject, type MediaRef, type Project } from "../domain/model";
import { validateStoryboard } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

const r = validateStoryboard(LANTERN_KEEPER);
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

  it("an untrimmed linked clip takes each version's full length and the main track ripples", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    const [id, next] = main(e.getState().project).placements.map((p) => p.id);
    const at = (pid: string) => main(e.getState().project).placements.find((p) => p.id === pid)!;
    const before = e.getState().project;
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(3), { versionId: "a2" }));
    expect([at(id).source.versionId, at(id).durationTicks]).toEqual(["a2", s(3)]);
    expect(at(next).startTicks).toBe(s(3));
    expect(board.linkedLengthChanges(before, e.getState().project, shotAsset(e, "s1"))).toEqual([{ placementId: id, fromTicks: s(5), toTicks: s(3) }]);
    // Switching back restores the longer take in full and pushes the next clip again.
    e.dispatch(cmd.selectStoryVersion(shotAsset(e, "s1"), "a1"));
    expect([at(id).source.versionId, at(id).durationTicks, at(next).startTicks]).toEqual(["a1", s(5), s(5)]);
    e.undo();
    expect([at(id).source.versionId, at(id).durationTicks, at(next).startTicks]).toEqual(["a2", s(3), s(3)]);
  });

  it("a trimmed linked clip keeps its trims, clamped to shorter media, and still ripples", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    const [id, next] = main(e.getState().project).placements.map((p) => p.id);
    const at = (pid: string) => main(e.getState().project).placements.find((p) => p.id === pid)!;
    e.dispatch(cmd.trimPlacement(id, "right", s(4), true));
    expect([at(id).durationTicks, at(next).startTicks]).toEqual([s(4), s(4)]);
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(6), { versionId: "a2" }));
    expect([at(id).durationTicks, at(next).startTicks]).toEqual([s(4), s(4)]);
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(3), { versionId: "a3" }));
    expect([at(id).source.versionId, at(id).durationTicks, at(next).startTicks]).toEqual(["a3", s(3), s(3)]);
  });

  it("a trim shortened by a version swap comes back when a longer version is picked again", () => {
    const e = setup();
    e.dispatch(cmd.sendStoryToTimeline());
    const [id, next] = main(e.getState().project).placements.map((p) => p.id);
    const at = (pid: string) => main(e.getState().project).placements.find((p) => p.id === pid)!;
    const s1 = shotAsset(e, "s1");
    e.dispatch(cmd.trimPlacement(id, "right", s(4), true));
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(3), { versionId: "a3" }));
    expect([at(id).durationTicks, at(next).startTicks]).toEqual([s(3), s(3)]);
    e.dispatch(cmd.selectStoryVersion(s1, "a1"));
    expect([at(id).durationTicks, at(next).startTicks, at(id).storyTrim]).toEqual([s(4), s(4), undefined]);
    // An edit after the clamp wins over the remembered trim.
    e.dispatch(cmd.selectStoryVersion(s1, "a3"));
    e.dispatch(cmd.trimPlacement(id, "right", s(2), true));
    e.dispatch(cmd.selectStoryVersion(s1, "a1"));
    expect(at(id).durationTicks).toBe(s(2));
  });

  it("on an overlay track a longer version grows only up to the next clip", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(3), { versionId: "a2" }));
    const p0 = e.getState().project;
    const s1 = shotAsset(e, "s1");
    const pl = (pid: string, start: number, dur: number, versionId: string, assetId = s1) => ({ id: pid, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "video" as const, source: { kind: "assetVersion" as const, assetId, versionId } });
    const comp = p0.compositions[p0.rootCompositionId];
    const overlay = { id: "ov", kind: "video" as const, name: "Overlay", placements: [pl("o1", 0, s(3), "a2"), pl("o2", s(4), s(1), "c1", shotAsset(e, "s3"))] };
    const withOverlay = { ...p0, compositions: { ...p0.compositions, [comp.id]: { ...comp, tracks: [overlay, ...comp.tracks] } } };
    const out = board.selectStoryVersion(withOverlay, s1, "a1").compositions[comp.id].tracks[0].placements;
    expect(out.map((x) => [x.id, x.startTicks, x.durationTicks])).toEqual([["o1", 0, s(4)], ["o2", s(4), s(1)]]);
  });

  it("skipped shots are not sent", () => {
    const e = setup();
    e.dispatch(cmd.setStorySkipped({ shot: "s3" }, true));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(main(e.getState().project).placements.map((p) => p.source.versionId)).toEqual(["a1"]);
  });
});
