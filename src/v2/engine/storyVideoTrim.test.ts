/** V2-SB-133: video assets used as layers: asset genDurationSec, trim on upload, layer inSec, and the In point command. */
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { board } from "../domain";
import { createProject, sourceInMax, type MediaRef, type Placement, type Project } from "../domain/model";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const leak = (extra: J = {}): J => ({ id: "dust", type: "video", asset: "dust-leak", startSec: 0, endSec: 2, box: { x: 0, y: 0, width: 1, height: 1 }, blend: "screen", ...extra });
const base = (layers: J[] = [leak()], asset: J = {}): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "dust-leak", name: "Dust leak", type: "video", prompt: "Warm dust specks drifting on pure black", qa: [], genDurationSec: 6, ...asset }],
  shots: [{ id: "s1", title: "One", durationSec: 5, prompt: "a walk", assets: [], qa: [], layers }],
});
const parse = (raw: J) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return { doc: r.doc as StoryDoc, warnings: r.warnings.map((w) => `${w.path}: ${w.message}`) }; };
const video = (sec: number, key = `v${sec}`): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: s(sec), width: 1920, height: 1080 });
const P = (e: Engine) => e.getState().project;
function setup(layers?: J[], asset?: J) {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(parse(base(layers, asset)).doc));
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(5, "shot"), { versionId: "a1" }));
  return e;
}
const overlays = (p: Project): Placement[] => {
  const c = p.compositions[p.rootCompositionId], main = ops.mainTrack(c)!.id;
  return c.tracks.filter((t) => t.id !== main).flatMap((t) => t.placements).filter((x) => x.clipType === "video");
};
const span = (pl: Placement) => [pl.sourceInTicks, pl.durationTicks];

describe("video asset genDurationSec and layer inSec (V2-SB-133)", () => {
  it("parses genDurationSec on video assets only and inSec on video layers only", () => {
    const ok = parse(base([leak({ inSec: 3 })]));
    expect(ok.warnings).toEqual([]);
    expect(ok.doc.assets[0].genDurationSec).toBe(6);
    expect(ok.doc.shots[0].layers![0]).toMatchObject({ inSec: 3 });
    // inSec 0 is the default and is not stored.
    expect(parse(base([leak({ inSec: 0 })])).doc.shots[0].layers![0]).not.toHaveProperty("inSec");
    const img = parse({ ...base([]), assets: [{ id: "dust-leak", name: "D", type: "image", prompt: "P", qa: [], genDurationSec: 6 }] });
    expect(img.warnings).toContain('assets[0].genDurationSec: Only "video" assets have a generate length; genDurationSec on a image asset is ignored.');
    expect(img.doc.assets[0]).not.toHaveProperty("genDurationSec");
    for (const bad of [0.2, 500, "x"]) {
      const r = parse(base([], { genDurationSec: bad }));
      expect(r.warnings[0]).toMatch(/^assets\[0\]\.genDurationSec: genDurationSec .* is ignored: use seconds between 0\.5 and 120\.$/);
      expect(r.doc.assets[0]).not.toHaveProperty("genDurationSec");
    }
    const neg = parse(base([leak({ inSec: -1 })]));
    expect(neg.warnings).toEqual(["shots[0].layers[0].inSec: inSec -1 is ignored: use seconds into the clip, 0 or more."]);
    expect(neg.doc.shots[0].layers![0]).not.toHaveProperty("inSec");
    const text = parse(base([{ id: "t", type: "text", text: "Hi", startSec: 0, endSec: 2, position: { x: 0.5, y: 0.5 }, inSec: 1 }]));
    expect(text.warnings).toContain("shots[0].layers[0].inSec: Only video layers have an in point; inSec on a text layer is ignored.");
    const past = parse(base([leak({ inSec: 5 })]));
    expect(past.warnings[0]).toMatch(/^shots\[0\]\.layers\[0\]\.inSec: inSec 5 \+ the layer's 2 s runs past the 6 s that asset "dust-leak" is generated at/);
    expect(past.doc.shots[0].layers![0]).toMatchObject({ inSec: 5 });
  });

  it("the slot keeps genDurationSec; the asset editor patch clamps and clears it", () => {
    const e = setup();
    const b = () => P(e).storyboard!;
    expect(b().slots["dust-leak"].genDurationSec).toBe(6);
    expect(board.slotLayerSec(b(), "dust-leak")).toBe(2);
    expect(board.slotLayerSec(b(), "nope")).toBeUndefined();
    e.dispatch(cmd.updateSlot("dust-leak", { genDurationSec: 7.04 }));
    expect(b().slots["dust-leak"].genDurationSec).toBe(7);
    e.dispatch(cmd.updateSlot("dust-leak", { genDurationSec: 900 }));
    expect(b().slots["dust-leak"].genDurationSec).toBe(120);
    e.dispatch(cmd.updateSlot("dust-leak", { genDurationSec: null }));
    expect(b().slots["dust-leak"]).not.toHaveProperty("genDurationSec");
  });

  it("a 2 s screen overlay cut from a 6 s clip: inSec wins, then the upload trim, then 0; it is clamped to fit", () => {
    let e = setup([leak({ inSec: 3 })]);
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1", trim: { inTicks: s(1), outTicks: s(3) } }));
    expect(P(e).storyboard!.versions.d1.trim).toEqual({ inTicks: s(1), outTicks: s(3) });
    e.dispatch(cmd.sendStoryToTimeline());
    expect(overlays(P(e)).map(span)).toEqual([[s(3), s(2)]]);
    expect(overlays(P(e))[0].blend).toBe("screen");

    e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1", trim: { inTicks: s(1), outTicks: s(3) } }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(overlays(P(e)).map(span)).toEqual([[s(1), s(2)]]);

    e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(overlays(P(e)).map(span)).toEqual([[0, s(2)]]);

    // inSec 5 + 2 s past a 6 s upload: starts at 4 s so it keeps its 2 s.
    e = setup([leak({ inSec: 5 })]);
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(overlays(P(e)).map(span)).toEqual([[s(4), s(2)]]);
  });

  it("changing the version trim moves layers that start at the old in point; hand-set in points stay", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1", trim: { inTicks: s(1), outTicks: s(3) } }));
    e.dispatch(cmd.sendStoryToTimeline());
    const id = P(e).storyboard!.slots["dust-leak"].assetId!;
    e.dispatch(cmd.setVersionTrim(id, "d1", { inTicks: s(2.5), outTicks: s(4.5) }));
    expect(overlays(P(e)).map(span)).toEqual([[s(2.5), s(2)]]);
    e.undo();
    expect(overlays(P(e)).map(span)).toEqual([[s(1), s(2)]]);
    e.dispatch(cmd.setSourceIn(overlays(P(e))[0].id, s(0.5)));
    e.dispatch(cmd.setVersionTrim(id, "d1", { inTicks: s(3), outTicks: s(5) }));
    expect(overlays(P(e)).map(span)).toEqual([[s(0.5), s(2)]]);
  });

  it("setSourceIn clamps to the media, keeps length and position, coalesces, and skips freeze or image clips", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ slot: "dust-leak" }, video(6), { versionId: "d1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    const pl = overlays(P(e))[0];
    expect(sourceInMax(P(e), pl)).toBe(s(4));
    const before = P(e);
    // A slider drag is one gesture and one undo step.
    e.beginGesture();
    e.dispatch(cmd.setSourceIn(pl.id, s(1)));
    e.dispatch(cmd.setSourceIn(pl.id, s(9)));
    e.endGesture();
    const after = overlays(P(e))[0];
    expect(after).toMatchObject({ sourceInTicks: s(4), durationTicks: pl.durationTicks, startTicks: pl.startTicks });
    e.dispatch(cmd.setSourceIn(pl.id, -5));
    expect(overlays(P(e))[0].sourceInTicks).toBe(0);
    e.undo();
    expect(overlays(P(e))[0].sourceInTicks).toBe(s(4));
    e.undo();
    expect(P(e)).toBe(before);
    // Freeze clips are left alone by the op.
    const comp = { id: "c", tracks: [{ id: "t", kind: "video", name: "V", placements: [{ ...pl, freeze: true }] }] } as never;
    expect((ops.setSourceIn(comp, pl.id, s(2), s(4)) as never as { tracks: { placements: Placement[] }[] }).tracks[0].placements[0].sourceInTicks).toBe(pl.sourceInTicks);
  });
});
