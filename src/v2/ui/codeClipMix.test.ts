import { describe, expect, it } from "vitest";
import { createProject, EXAMPLE_STORYBOARD, secondsToTicks, story, type Placement } from "../domain";
import { cmd, Engine } from "../engine";
import { clipLocalToTicks, htmlPlacementOf, htmlPreviewParams } from "./codeClipMix";

const doc = (() => {
  const r = story.validateStoryboard(JSON.parse(JSON.stringify(EXAMPLE_STORYBOARD)));
  if (!r.ok) throw new Error("bad");
  return r.doc;
})();

const pl = (partial: Partial<Placement> & Pick<Placement, "startTicks" | "durationTicks" | "sourceInTicks">): Placement => ({
  id: "p", clipType: "html", source: { kind: "assetVersion", assetId: "a", versionId: "v" }, ...partial,
});

describe("P54 code clip mix helpers", () => {
  it("maps clip-local source seconds back to timeline ticks", () => {
    const p = pl({ startTicks: secondsToTicks(10), durationTicks: secondsToTicks(4), sourceInTicks: secondsToTicks(2) });
    expect(clipLocalToTicks(p, 2)).toBe(secondsToTicks(10));
    expect(clipLocalToTicks(p, 4)).toBe(secondsToTicks(12));
  });

  it("accounts for speed and reverse", () => {
    const fast = pl({ startTicks: 0, durationTicks: secondsToTicks(2), sourceInTicks: 0, speed: 2 });
    expect(clipLocalToTicks(fast, 2)).toBe(secondsToTicks(1));
    const rev = pl({ startTicks: 0, durationTicks: secondsToTicks(4), sourceInTicks: 0, reverse: true });
    expect(clipLocalToTicks(rev, 0)).toBe(secondsToTicks(4) - 1);
    expect(clipLocalToTicks(rev, 4)).toBe(0);
  });

  it("htmlPreviewParams prefers the shot's values, else the first layer that uses the slot", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(doc));
    const project = e.getState().project;
    const b = project.storyboard!;
    expect(htmlPreviewParams(project, { shot: b.shots.s4 })).toMatchObject({ text: "THE END" });
    expect(htmlPreviewParams(project, { slot: b.slots["text-card"] })).toMatchObject({ text: "5:58 AM" });
  });

  it("htmlPlacementOf finds a sent html clip by storyShot or assetId", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(doc));
    const project = e.getState().project;
    expect(htmlPlacementOf(project, { shotId: "s4" })).toBeUndefined();
    const html: Placement = {
      id: "hx", startTicks: 0, durationTicks: secondsToTicks(2), sourceInTicks: 0, clipType: "html",
      source: { kind: "assetVersion", assetId: "card", versionId: "v1" }, storyShot: "s4", htmlParams: { text: "THE END" },
    };
    const next = structuredClone(project);
    next.compositions[next.rootCompositionId].tracks[0].placements.push(html);
    expect(htmlPlacementOf(next, { shotId: "s4" })?.id).toBe("hx");
    expect(htmlPlacementOf(next, { assetId: "card" })?.id).toBe("hx");
  });
});
