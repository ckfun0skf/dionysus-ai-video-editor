/** P36: blank clips (item 6) and trimmed shots after Sync (item 10). */
import { describe, expect, it } from "vitest";
import { createProject, TICKS_PER_SECOND, type Project } from "../domain";
import { mainTrack } from "../domain/ops";
import * as board from "../domain/storyboard";
import { validateStoryboard } from "../domain/storyJson";
import { sendStory } from "../domain/storySend";
import { syncPlan } from "../domain/storySync";
import { cmd, Engine } from ".";

const S = TICKS_PER_SECOND;
const root = (p: Project) => p.compositions[p.rootCompositionId];

describe("blank clips (P36)", () => {
  it("main inserts a 3 s solid clip on the main track; overlay goes on an overlay layer; colour changes are one undo step", () => {
    const e = new Engine(createProject("b"));
    expect(e.dispatch(cmd.addBlankClip(0, "#FF0000", "main", undefined, "m1"))).toBe(true);
    const m = mainTrack(root(e.getState().project))!.placements.find((x) => x.id === "m1")!;
    expect(m).toMatchObject({ clipType: "image", durationTicks: 3 * S, blank: { color: "#ff0000" } });
    expect(e.dispatch(cmd.addBlankClip(S, "#00ff00", "overlay", 2 * S, "o1"))).toBe(true);
    const ov = root(e.getState().project).tracks.find((t) => t.placements.some((x) => x.id === "o1"))!;
    expect(ov.kind).toBe("video");
    expect(ov.id).not.toBe(mainTrack(root(e.getState().project))!.id);
    e.dispatch(cmd.setBlankColor("m1", "#123456"));
    expect(mainTrack(root(e.getState().project))!.placements[0].blank!.color).toBe("#123456");
    e.undo();
    expect(mainTrack(root(e.getState().project))!.placements[0].blank!.color).toBe("#ff0000");
  });
  it("rejects a colour that is not #rrggbb", () => {
    const e = new Engine(createProject("b"));
    expect(e.dispatch(cmd.addBlankClip(0, "red", "main"))).toBe(false);
  });
  it("Sync to Storyboard never turns a blank clip into a shot", () => {
    const e = new Engine(createProject("b"));
    const d = validateStoryboard({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [], shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [] }] });
    if (!d.ok) throw new Error("bad doc");
    let p = board.setStoryboard(e.getState().project, board.storyboardFromDoc(d.doc));
    p = sendStory(p).project;
    const e2 = new Engine(p);
    e2.dispatch(cmd.addBlankClip(20 * S, "#000000", "main"));
    e2.dispatch(cmd.addBlankClip(0, "#000000", "overlay"));
    const r = syncPlan(e2.getState().project);
    expect(r.project.storyboard!.order).toEqual(["a"]);
    expect(r.project.storyboard!.shots.a.layers ?? []).toEqual([]);
  });
});

describe("trimmed shot after Sync (P36 item 10)", () => {
  it("a version with no storyboard record still takes the timeline trim, so the shot plays only that part", () => {
    const d = validateStoryboard({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [], shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [] }] });
    if (!d.ok) throw new Error("bad doc");
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(d.doc));
    p = board.addStoryVersion(p, { shot: "a" }, { blobKey: "v", mime: "video/mp4", durationTicks: 8 * S }, { versionId: "v1" });
    p = structuredClone(sendStory(p).project);
    delete p.storyboard!.versions.v1;
    const clip = mainTrack(root(p))!.placements.find((x) => x.storyShot === "a")!;
    clip.sourceInTicks = 2 * S; clip.durationTicks = 3 * S;
    const r = syncPlan(p);
    expect(r.project.storyboard!.versions.v1.trim).toEqual({ inTicks: 2 * S, outTicks: 5 * S });
    expect(board.shotPlayRange(r.project, r.project.storyboard!.shots.a)).toMatchObject({ inSec: 2, outSec: 5 });
  });
});
