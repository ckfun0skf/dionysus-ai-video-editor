import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { board, EXAMPLE_STORYBOARD, story } from "../domain";
import { createProject, type Placement } from "../domain/model";
import { secondsToTicks as s } from "../domain/time";

const doc = (() => { const r = story.validateStoryboard(JSON.parse(JSON.stringify(EXAMPLE_STORYBOARD))); if (!r.ok) throw new Error("bad"); return r.doc; })();
const setup = () => { const e = new Engine(createProject("t")); e.dispatch(cmd.createStoryboard(doc)); return e; };

describe("storyboard P2C domain", () => {
  it("usedModels merges case, ranks by use then recency, skips blanks", () => {
    const e = setup();
    expect(board.usedModels(e.getState().project)).toEqual([]);
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "a", mime: "video/mp4", durationTicks: s(4) }, { model: "Kling", now: "2026-10-01T00:00:00Z" }));
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, { blobKey: "b", mime: "video/mp4", durationTicks: s(4) }, { model: "Veo", now: "2026-10-02T00:00:00Z" }));
    e.dispatch(cmd.addStoryVersion({ shot: "s3" }, { blobKey: "c", mime: "video/mp4", durationTicks: s(4) }, { model: "  ", now: "2026-10-03T00:00:00Z" }));
    expect(board.usedModels(e.getState().project)).toEqual(["Veo", "Kling"]);
    e.dispatch(cmd.addStoryVersion({ shot: "s3" }, { blobKey: "d", mime: "video/mp4", durationTicks: s(4) }, { model: "kling", now: "2026-10-04T00:00:00Z" }));
    expect(board.usedModels(e.getState().project)[0].toLowerCase()).toBe("kling");
  });

  it("updateShot sets and clears html params", () => {
    const e = setup();
    e.dispatch(cmd.updateShot("s4", { params: { text: "FIN", color: "#ff0000" } }));
    expect(e.getState().project.storyboard!.shots.s4.params).toEqual({ text: "FIN", color: "#ff0000" });
    e.dispatch(cmd.updateShot("s4", { params: null }));
    expect(e.getState().project.storyboard!.shots.s4.params).toBeUndefined();
    e.dispatch(cmd.updateShot("s4", { params: {} }));
    expect(e.getState().project.storyboard!.shots.s4.params).toBeUndefined();
  });

  it("sending to the timeline honours an audio version's trim", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "dawn-wind" }, { blobKey: "w", mime: "audio/mpeg", durationTicks: s(30) }, { versionId: "w1" }));
    const id = e.getState().project.storyboard!.slots["dawn-wind"].assetId!;
    e.dispatch(cmd.setVersionTrim(id, "w1", { inTicks: s(2), outTicks: s(5) }));
    for (const sh of ["s1", "s2", "s3"]) e.dispatch(cmd.addStoryVersion({ shot: sh }, { blobKey: sh, mime: "video/mp4", durationTicks: s(5) }));
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project, comp = p.compositions[p.rootCompositionId];
    const clips = comp.tracks.flatMap((t) => t.placements).filter((c: Placement) => c.source.assetId === id);
    expect(clips.length).toBeGreaterThan(1); // 11 s of shots, 3 s audio: looped
    for (const c of clips) { expect(c.sourceInTicks).toBe(s(2)); expect(c.durationTicks).toBeLessThanOrEqual(s(3)); }
  });
});
