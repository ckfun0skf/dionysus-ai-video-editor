import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { board, slip, timelineReview } from "../domain";
import { LANTERN_KEEPER } from "../domain/__fixtures__/lanternKeeper";
import { createProject, type MediaRef, type Placement, type Project } from "../domain/model";
import { validateStoryboard } from "../domain/storyJson";
import { placeholderClips, placeholderLabel } from "../domain/storySend";
import { syncPlan } from "../domain/storySync";
import { secondsToTicks as s } from "../domain/time";

/** P35: storyboard shots with no clip yet are sent as placeholders and filled in place later. */
const r = validateStoryboard(LANTERN_KEEPER);
if (!r.ok) throw new Error("bad example");
const clip = (sec: number): MediaRef => ({ blobKey: `b${sec}`, mime: "video/mp4", durationTicks: s(sec) });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const main = (p: Project) => ops.mainTrack(root(p))!;
const all = (p: Project): Placement[] => root(p).tracks.flatMap((t) => t.placements);

function sent() {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.ok ? r.doc : (undefined as never)));
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip(5), { versionId: "a1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  return e;
}

describe("shot placeholders (P35)", () => {
  it("sends every shot in story order at its planned length; placeholders carry the shot label and its layers", () => {
    const e = sent(), p = e.getState().project, pls = main(p).placements;
    expect(pls.map((x) => [x.storyShot, x.startTicks, x.durationTicks, !!x.placeholder])).toEqual([["s1", 0, s(5), false], ["s2", s(5), s(6), true], ["s3", s(11), s(4), true]]);
    expect(pls[1].placeholder!.label).toBe("Shot 2 · Lighting the lamp — Inside the lamp room he lights the great lamp.");
    expect(pls[2]).toMatchObject({ clipType: "image", source: { assetId: "", versionId: "" } });
    // s3's title layer is placed and linked to its placeholder.
    expect(all(p).find((x) => x.clipType === "text" && x.text?.text === "THE LANTERN KEEPER")?.storyLink?.anchor).toBe(pls[2].id);
    expect(placeholderClips(p)).toHaveLength(2);
    // Sending again adds nothing.
    e.dispatch(cmd.updateStoryTimeline());
    expect(main(e.getState().project).placements).toHaveLength(3);
  });

  it("labels shorten long descriptions", () => {
    const b = { order: ["x"] } as unknown as Parameters<typeof placeholderLabel>[0];
    expect(placeholderLabel(b, { id: "x", title: "T", description: "a".repeat(80) } as never)).toBe(`Shot 1 · T — ${"a".repeat(47)}…`);
  });

  it("Update fills a placeholder in place, keeping id, start, links and edits; a shorter video ends with its media", () => {
    const e = sent();
    const ph = main(e.getState().project).placements[2];
    e.dispatch(cmd.addStoryVersion({ shot: "s3" }, clip(3), { versionId: "c1" }));
    expect(board.sendPlan(e.getState().project).map((x) => [x.state, !!x.placeholder])).toEqual([["placed", false], ["missing", true], ["placed", true]]);
    e.dispatch(cmd.updateStoryTimeline());
    const p = e.getState().project, now = main(p).placements[2];
    expect(now).toMatchObject({ id: ph.id, startTicks: ph.startTicks, durationTicks: s(3), clipType: "video", source: { versionId: "c1" }, storyShot: "s3" });
    expect(now.placeholder).toBeUndefined();
    expect(all(p).find((x) => x.text?.text === "THE LANTERN KEEPER")?.storyLink?.anchor).toBe(ph.id);
    expect(board.sendPlan(p)[2]).toEqual({ shotId: "s3", assetId: p.storyboard!.shots.s3.assetId, state: "placed" });
    e.undo();
    expect(main(e.getState().project).placements[2].placeholder).toBeDefined();
  });

  it("Replace asset fills a placeholder with any picture asset (one undo step)", () => {
    const e = sent();
    let p = e.getState().project;
    const ph = main(p).placements[1], img = Object.values(p.assets).find((a) => a.kind === "video")!;
    expect(slip.replaceError(p, ph.id, img.id)).toBeUndefined();
    e.dispatch(cmd.replaceClipAsset(ph.id, img.id, "hold"));
    p = e.getState().project;
    const now = main(p).placements[1];
    expect(now).toMatchObject({ id: ph.id, startTicks: ph.startTicks, durationTicks: ph.durationTicks, clipType: "video", source: { assetId: img.id } });
    expect(now.placeholder).toBeUndefined();
    e.undo();
    expect(main(e.getState().project).placements[1].placeholder).toBeDefined();
  });

  it("Replace timeline rebuilds placeholders; skipped shots get none", () => {
    const e = sent();
    e.dispatch(cmd.setStorySkipped({ shot: "s2" }, true));
    e.dispatch(cmd.replaceStoryTimeline());
    expect(main(e.getState().project).placements.map((x) => [x.storyShot, !!x.placeholder])).toEqual([["s1", false], ["s3", true]]);
  });

  it("Sync to Storyboard writes a placeholder's length to durationSec and never an asset", () => {
    const e = sent();
    const ph = main(e.getState().project).placements[1];
    e.dispatch(cmd.trimPlacement(ph.id, "right", ph.startTicks + s(2)));
    const p0 = e.getState().project;
    const len = main(p0).placements[1].durationTicks / s(1);
    expect(len).toBe(2);
    const plan = syncPlan(p0);
    expect(plan.project.storyboard!.shots.s2.durationSec).toBe(len);
    expect(plan.project.storyboard!.shots.s2.assetId).toBe(p0.storyboard!.shots.s2.assetId);
    expect(Object.keys(plan.project.storyboard!.shots)).toEqual(Object.keys(p0.storyboard!.shots));
  });

  it("get_timeline marks placeholders and review_lint warns about each", () => {
    const p = sent().getState().project, ph = main(p).placements[1];
    expect(timelineReview.clipJson(p, ph)).toMatchObject({ id: ph.id, placeholder: true, label: ph.placeholder!.label, storyShot: "s2" });
    const lint = timelineReview.reviewLint(p).filter((x) => x.kind === "placeholder");
    expect(lint.map((x) => [x.clip, x.shot, x.severity])).toEqual([[ph.id, "s2", "warning"], [main(p).placements[2].id, "s3", "warning"]]);
    expect(timelineReview.reviewLint(p).some((x) => x.kind === "missing-asset")).toBe(false);
  });
});
