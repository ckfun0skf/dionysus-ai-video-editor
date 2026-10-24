/** V2-SB-121: trim on upload, keep full length, adjust trim, and genDurationSec. */
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { board } from "../domain";
import { createProject, type MediaRef, type Project } from "../domain/model";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [],
  shots: [
    { id: "s1", title: "One", durationSec: 5, prompt: "a walk", assets: [], qa: [] },
    { id: "s2", title: "Two", durationSec: 3, prompt: "a run", assets: [], qa: [] },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut" }],
});
const doc = (mut: (d: J) => void = () => {}): StoryDoc => { const d = base(); mut(d); const r = validateStoryboard(d); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const video = (sec: number, key = `v${sec}`): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: s(sec), width: 1920, height: 1080 });
const main = (p: Project) => ops.mainTrack(p.compositions[p.rootCompositionId])!;
const clips = (p: Project) => main(p).placements.map((x) => [x.startTicks, x.sourceInTicks, x.durationTicks]);
function setup(mut?: (d: J) => void) {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(doc(mut)));
  return e;
}
const P = (e: Engine) => e.getState().project;
const asset = (e: Engine) => P(e).storyboard!.shots.s1.assetId!;

describe("trim on upload (V2-SB-121)", () => {
  it("stores the trim per version; Send to timeline uses it; one undo step", () => {
    const e = setup();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a1", trim: { inTicks: s(1.5), outTicks: s(6.5) } }));
    expect(P(e).storyboard!.versions.a1.trim).toEqual({ inTicks: s(1.5), outTicks: s(6.5) });
    expect(board.shotLengthMismatch(P(e), P(e).storyboard!.shots.s1)).toBeUndefined();
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, video(3), { versionId: "b1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(clips(P(e))).toEqual([[0, s(1.5), s(5)], [s(5), 0, s(3)]]);
    e.undo(); e.undo(); e.undo();
    expect(P(e).storyboard!.shots.s1.assetId).toBeUndefined();
  });

  it("a whole-clip trim is not stored; out-of-range trims are clamped", () => {
    const e = setup();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a1", trim: { inTicks: 0, outTicks: s(8) } }));
    expect(P(e).storyboard!.versions.a1.trim).toBeUndefined();
    e.dispatch(cmd.setVersionTrim(asset(e), "a1", { inTicks: s(6), outTicks: s(20) }));
    expect(P(e).storyboard!.versions.a1.trim).toEqual({ inTicks: s(6), outTicks: s(8) });
  });

  it("keep full extends the shot's planned length in the same undo step", () => {
    const e = setup();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a1", keepFullSec: 8 }));
    expect(P(e).storyboard!.shots.s1.durationSec).toBe(8);
    expect(board.shotLengthMismatch(P(e), P(e).storyboard!.shots.s1)).toBeUndefined();
    e.undo();
    expect(P(e).storyboard!.shots.s1.durationSec).toBe(5);
    expect(P(e).storyboard!.shots.s1.assetId).toBeUndefined();
  });

  it("a too-short clip still warns; a trim shorter than planned warns too", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(3), { versionId: "a1" }));
    expect(board.shotLengthMismatch(P(e), P(e).storyboard!.shots.s1)).toBeDefined();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a2", trim: { inTicks: 0, outTicks: s(3) } }));
    expect(board.shotLengthMismatch(P(e), P(e).storyboard!.shots.s1)).toBeDefined();
  });

  it("version swaps follow each version's trim and ripple (R01); clips trimmed by hand keep their trim", () => {
    const e = setup();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a1", trim: { inTicks: s(2), outTicks: s(7) } }));
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, video(3), { versionId: "b1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(4), { versionId: "a2" }));
    expect(clips(P(e))).toEqual([[0, 0, s(4)], [s(4), 0, s(3)]]);
    e.dispatch(cmd.selectStoryVersion(asset(e), "a1"));
    expect(clips(P(e))).toEqual([[0, s(2), s(5)], [s(5), 0, s(3)]]);
    e.undo();
    expect(clips(P(e))).toEqual([[0, 0, s(4)], [s(4), 0, s(3)]]);
  });

  it("adjust trim moves timeline clips that still show the old range; undo restores it", () => {
    const e = setup();
    e.dispatch(cmd.addTrimmedShotVersion("s1", video(8), { versionId: "a1", trim: { inTicks: s(1), outTicks: s(6) } }));
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, video(3), { versionId: "b1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    e.dispatch(cmd.setVersionTrim(asset(e), "a1", { inTicks: s(3), outTicks: s(8) }));
    expect(clips(P(e))).toEqual([[0, s(3), s(5)], [s(5), 0, s(3)]]);
    e.dispatch(cmd.setVersionTrim(asset(e), "a1", undefined));
    expect(clips(P(e))).toEqual([[0, 0, s(8)], [s(8), 0, s(3)]]);
    e.undo();
    expect(clips(P(e))).toEqual([[0, s(3), s(5)], [s(5), 0, s(3)]]);
    // A clip trimmed by hand on the timeline is left alone.
    const id = main(P(e)).placements[0].id;
    e.dispatch(cmd.trimPlacement(id, "right", s(4)));
    expect(main(P(e)).placements[0]).toMatchObject({ sourceInTicks: s(3), durationTicks: s(4) });
    e.dispatch(cmd.setVersionTrim(asset(e), "a1", { inTicks: 0, outTicks: s(5) }));
    expect(main(P(e)).placements[0]).toMatchObject({ sourceInTicks: s(3), durationTicks: s(4) });
  });
});

describe("genDurationSec (V2-SB-121)", () => {
  it("is kept when longer than durationSec and ignored with a warning otherwise", () => {
    const ok = validateStoryboard((() => { const d = base(); d.shots[0].genDurationSec = 8; return d; })());
    expect(ok.ok && ok.doc.shots[0].genDurationSec).toBe(8);
    for (const bad of [2, 0, "x", 500]) {
      const r = validateStoryboard((() => { const d = base(); d.shots[0].genDurationSec = bad; return d; })());
      expect(r.ok && r.doc.shots[0].genDurationSec).toBeUndefined();
      expect(r.warnings.some((w) => w.path.endsWith("genDurationSec"))).toBe(true);
    }
    const e = setup((d) => { d.shots[0].genDurationSec = 8; });
    expect(P(e).storyboard!.shots.s1.genDurationSec).toBe(8);
    e.dispatch(cmd.updateShot("s1", { durationSec: 9 }));
    expect(P(e).storyboard!.shots.s1.genDurationSec).toBeUndefined();
    e.dispatch(cmd.updateShot("s1", { genDurationSec: 12 }));
    expect(P(e).storyboard!.shots.s1.genDurationSec).toBe(12);
    e.dispatch(cmd.updateShot("s1", { genDurationSec: null }));
    expect(P(e).storyboard!.shots.s1.genDurationSec).toBeUndefined();
  });
});
