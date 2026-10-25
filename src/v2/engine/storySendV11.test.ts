/** Storyboard v1.1 production and Send to timeline (V2-SB-113): html/still shots, layers, captions, effects, transitions, links. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import * as edit from "../domain/edit";
import { board } from "../domain";
import { createProject, type MediaRef, type Placement, type Project } from "../domain/model";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { boxTransform } from "../domain/storySend";
import { secondsToTicks as s } from "../domain/time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9", textStyles: { big: { font: "serif", size: 0.09, color: "#ffffff", bold: false } } },
  assets: [
    { id: "bg", name: "Background", type: "image", prompt: "plain blue", qa: [] },
    { id: "logo", name: "Logo", type: "html", prompt: "spinning 3D logo", qa: [] },
    { id: "hero", name: "Hero", type: "character", prompt: "hero sheet", qa: [] },
  ],
  shots: [
    { id: "s1", title: "One", durationSec: 5, prompt: "a walk", assets: ["hero"], qa: [], dialogue: "Hello there." },
    { id: "s2", title: "Two", durationSec: 4, render: "still", clip: "bg", assets: [], qa: [] },
    { id: "s3", title: "Three", durationSec: 3, render: "html", clip: "logo", assets: [], qa: [] },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut" }, { from: "s2", to: "s3", kind: "cut" }],
});
const doc = (mut: (d: J) => void = () => {}): StoryDoc => { const d = base(); mut(d); const r = validateStoryboard(d); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const video = (sec: number, key = `v${sec}`): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: s(sec), width: 1920, height: 1080 });
const image = (key = "img", w = 1920, h = 1080): MediaRef => ({ blobKey: key, mime: "image/png", width: w, height: h });
const html = (key = "page"): MediaRef => ({ blobKey: key, mime: "text/html", width: 1920, height: 1080 });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const main = (p: Project) => ops.mainTrack(root(p))!;
const all = (p: Project) => root(p).tracks.flatMap((t) => t.placements.map((pl) => ({ ...pl, track: t })));
const linkedTo = (p: Project, anchor: string) => all(p).filter((x) => x.storyLink?.anchor === anchor);

function setup(mut?: (d: J) => void) {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(doc(mut)));
  return e;
}
const ready = (e: Engine) => {
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(5), { versionId: "a1" }));
  e.dispatch(cmd.addStoryVersion({ slot: "bg" }, image(), { versionId: "bg1" }));
  e.dispatch(cmd.addStoryVersion({ shot: "s3" }, html(), { versionId: "lg1" }));
};

describe("html and still shots in production", () => {
  it("a still/html shot is its clip slot: blocked until the slot has a version, then uses the slot's selected version", () => {
    const e = setup();
    const step = (k: string) => board.productionSteps(e.getState().project).find((x) => x.key === k)!;
    expect(step("shot:s2")).toMatchObject({ state: "blocked", waitsFor: "bg" });
    const keys = board.productionSteps(e.getState().project).map((x) => x.key);
    expect(keys.indexOf("slot:bg")).toBeLessThan(keys.indexOf("shot:s2"));
    e.dispatch(cmd.addStoryVersion({ slot: "bg" }, image(), { versionId: "bg1" }));
    const p = e.getState().project, b = p.storyboard!;
    expect(b.shots.s2.assetId).toBe(b.slots.bg.assetId);
    expect(board.selectedOf(p, b.shots.s2)).toBe("bg1");
    expect(step("shot:s2").state).not.toBe("blocked");
  });

  it("uploading to an html shot stores the version on its html slot", () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ shot: "s3" }, html(), { versionId: "lg1" }));
    const p = e.getState().project, b = p.storyboard!;
    expect(b.slots.logo.assetId).toBeTruthy();
    expect(b.shots.s3.assetId).toBe(b.slots.logo.assetId);
    expect(p.assets[b.slots.logo.assetId!].kind).toBe("html");
    expect(board.kindForSlot("html")).toBe("html");
  });
});

describe("send to timeline (v1.1)", () => {
  it("still and html shots play for their planned length after the ai shot", () => {
    const e = setup();
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const pls = main(e.getState().project).placements;
    expect(pls.map((p) => [p.source.versionId, p.clipType, p.startTicks, p.durationTicks])).toEqual([
      ["a1", "video", 0, s(5)], ["bg1", "image", s(5), s(4)], ["lg1", "html", s(9), s(3)],
    ]);
  });

  it("text layers: box centre and fitted size, position and local text style, inline style over the preset, valid animations only", () => {
    const e = setup((d) => {
      d.shots[0].durationSec = 8; // planned 8 s, but the clip is 5 s
      d.shots[0].layers = [
        { id: "t1", type: "text", text: "Line one\nLine two", box: { x: 0.1, y: 0.7, width: 0.4, height: 0.12 }, textStyle: "plain", style: { color: "#ff0000" }, anim: { in: "fade", out: "nope", durationSec: 0.6 }, startSec: 1, endSec: 4 },
        { id: "t2", type: "text", text: "TITLE", position: { x: 0.5, y: 0.5 }, textStyle: "big", startSec: 0, endSec: 8 },
        { id: "t3", type: "text", text: "x", position: { x: 0.25, y: 0.25 }, textStyle: "made-up", startSec: 0, endSec: 2 },
      ];
    });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project;
    const clip = main(p).placements[0];
    const [t1, t2, t3] = ["Line one\nLine two", "TITLE", "x"].map((t) => linkedTo(p, clip.id).find((x) => x.text?.text === t)!);
    expect(t1.startTicks).toBe(s(1));
    expect(t1.durationTicks).toBe(s(3));
    expect(t1.transform!.x).toBeCloseTo(-0.2);
    expect(t1.transform!.y).toBeCloseTo(0.26);
    expect(t1.text!.size).toBeCloseTo(0.12 / (2 * 1.2));
    expect(t1.text).toMatchObject({ color: "#ff0000", bold: true, lineHeight: 1.2, animIn: "fade", animTicks: s(0.6) });
    expect(t1.text!.animOut).toBeUndefined();
    expect(t1.track.kind).toBe("text");
    expect(t1.track.layerStyle).toBeUndefined();
    // Clamped to the shot clip (5 s), never dropped.
    expect([t2.startTicks, t2.durationTicks]).toEqual([0, s(5)]);
    expect(t2.transform?.x ?? 0).toBe(0);
    expect(t2.text).toMatchObject({ size: 0.09, color: "#ffffff", bold: false });
    expect(t2.text!.font).toContain("serif");
    expect(t3.text).toMatchObject({ bold: true, color: "#ffffff" }); // unknown textStyle → plain
    expect(t3.transform).toMatchObject({ x: -0.25, y: -0.25 });
  });

  it("media layers fill their box with the slot's selected version; layers without an upload are skipped", () => {
    const e = setup((d) => {
      d.shots[0].layers = [
        { id: "m1", type: "html", asset: "logo", box: { x: 0.6, y: 0.1, width: 0.3, height: 0.3 }, startSec: 0, endSec: 2 },
        { id: "m2", type: "image", asset: "hero", box: { x: 0, y: 0, width: 0.5, height: 0.5 }, startSec: 0, endSec: 2 },
      ];
    });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project;
    const ls = linkedTo(p, main(p).placements[0].id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ clipType: "html", durationTicks: s(2) });
    expect(ls[0].source.versionId).toBe("lg1");
    expect(ops.groupOf(root(p), ls[0].track)).toBe("overlay");
    expect(ls[0].transform!.x).toBeCloseTo(0.25);
    expect(ls[0].transform!.y).toBeCloseTo(-0.25);
    expect(ls[0].transform!.scale).toBeCloseTo(0.3);
    // A square medium in a 16:9 frame, in a frame-shaped box: limited by the box height.
    expect(boxTransform({ x: 0, y: 0, width: 0.5, height: 0.5 }, 100, 100, 1920, 1080).scale).toBeCloseTo(0.5);
    expect(boxTransform({ x: 0, y: 0, width: 0.2, height: 1 }, 100, 100, 1920, 1080).scale).toBeCloseTo(0.2 / (1080 / 1920));
  });

  it("captions go into the shared subtitle layer; effects onto an effect layer; unknown effects are dropped", () => {
    const e = setup((d) => {
      d.shots[0].captions = true;
      d.shots[0].effects = [{ preset: "ken-burns", params: { zoom: 1.2 }, startSec: 1 }, { preset: "made-up" }];
      d.shots[1].captions = true; // no dialogue → no cue
    });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project;
    const id = main(p).placements[0].id;
    const cue = linkedTo(p, id).find((x) => x.clipType === "text")!;
    expect(cue.text!.text).toBe("Hello there.");
    expect(cue.track.layerStyle?.subtitle).toBe(true);
    expect(cue.track.name).toBe("Subtitles");
    expect([cue.startTicks, cue.durationTicks]).toEqual([0, s(5)]);
    const fx = linkedTo(p, id).filter((x) => x.clipType === "effect");
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ startTicks: s(1), durationTicks: s(4), effect: { preset: "ken-burns", params: { zoom: 1.2 } } });
    expect(fx[0].track.kind).toBe("effect");
    expect(root(p).tracks.filter((t) => t.layerStyle?.subtitle)).toHaveLength(1);
  });

  it("an existing subtitle layer is reused", () => {
    const e = setup((d) => { d.shots[0].captions = true; });
    e.dispatch(cmd.importSrtLayer([{ id: "c1", startTicks: s(60), durationTicks: s(2), text: "Later" }]));
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const subs = root(e.getState().project).tracks.filter((t) => t.layerStyle?.subtitle);
    expect(subs).toHaveLength(1);
    expect(subs[0].placements.map((x) => x.text?.text)).toContain("Hello there.");
  });

  it("transitions: only between adjacent clips, clamped to half the shorter clip; unknown presets are cuts", () => {
    const e = setup((d) => {
      d.connections[0].transition = { preset: "crossfade", params: { durationSec: 9 } };
      d.connections[1].transition = { preset: "dip" };
    });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const [, still, page] = main(e.getState().project).placements;
    expect(still.transitionIn).toEqual({ kind: "crossfade", durationTicks: s(2) });
    expect(page.transitionIn).toEqual({ kind: "dip", durationTicks: s(0.5) });

    const g = setup((d) => { d.connections[1].transition = { preset: "warp-9" }; d.connections[0].transition = { preset: "dip" }; });
    g.dispatch(cmd.addStoryVersion({ slot: "bg" }, image(), { versionId: "bg1" }));
    g.dispatch(cmd.addStoryVersion({ shot: "s3" }, html(), { versionId: "lg1" }));
    g.dispatch(cmd.sendStoryToTimeline()); // s1 has no clip: s2 has nothing before it
    expect(main(g.getState().project).placements.map((x) => x.transitionIn)).toEqual([undefined, undefined]);
  });

  it("transition params other than durationSec are kept on the clip (V2-SB-130)", () => {
    const e = setup((d) => { d.connections[0].transition = { preset: "light-leak", params: { durationSec: 1, color: "#ffcc00", strength: 0.5 } }; });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const [, still] = main(e.getState().project).placements;
    expect(still.transitionIn).toEqual({ kind: "light-leak", durationTicks: s(1), params: { color: "#ffcc00", strength: 0.5 } });
  });

  it("linked items follow version swaps: clamped to a shorter clip, restored on swap back, one undo each", () => {
    const e = setup((d) => {
      d.shots[0].layers = [{ id: "t1", type: "text", text: "Late", position: { x: 0.5, y: 0.8 }, startSec: 3, endSec: 5 }];
      d.shots[0].effects = [{ preset: "ken-burns" }];
    });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const id = main(e.getState().project).placements[0].id;
    const item = (pred: (x: Placement) => boolean) => linkedTo(e.getState().project, id).find(pred)!;
    const text = () => item((x) => x.clipType === "text"), fx = () => item((x) => x.clipType === "effect");
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, video(2, "short"), { versionId: "a2" }));
    expect(main(e.getState().project).placements[0].durationTicks).toBe(s(2));
    expect([text().startTicks, text().durationTicks]).toEqual([0, s(2)]); // past the new end: kept, ending with the clip
    expect([fx().startTicks, fx().durationTicks]).toEqual([0, s(2)]);
    const a = e.getState().project.storyboard!.shots.s1.assetId!;
    e.dispatch(cmd.selectStoryVersion(a, "a1"));
    expect([text().startTicks, text().durationTicks]).toEqual([s(3), s(2)]);
    expect([fx().startTicks, fx().durationTicks]).toEqual([0, s(5)]);
    e.undo();
    expect(text().startTicks).toBe(0);
  });

  it("copies of a linked item are ordinary clips", () => {
    const e = setup((d) => { d.shots[0].layers = [{ id: "t1", type: "text", text: "Hi", position: { x: 0.5, y: 0.5 }, startSec: 0, endSec: 1 }]; });
    ready(e);
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project;
    const t = linkedTo(p, main(p).placements[0].id)[0];
    const { comp, ids } = edit.pasteClips(root(p), edit.copyClips(root(p), [t.id]), s(20));
    expect(comp.tracks.flatMap((x) => x.placements).find((x) => x.id === ids[0])!.storyLink).toBeUndefined();
  });

  it("the ep01 fixture: title card and note card layers, the ken-burns effect, dip and crossfade", () => {
    const text = readFileSync(resolve(__dirname, "../domain/__fixtures__/ep01_opening.storyboard.json"), "utf8");
    const r = validateStoryboard(JSON.parse(text));
    if (!r.ok) throw new Error("fixture");
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(r.doc));
    const b0 = e.getState().project.storyboard!;
    for (const id of b0.order) if (!b0.shots[id].clipSlot) e.dispatch(cmd.addStoryVersion({ shot: id }, video(6, `c-${id}`)));
    for (const sl of ["title-bg", "card-still"]) e.dispatch(cmd.addStoryVersion({ slot: sl }, image(sl)));
    e.dispatch(cmd.sendStoryToTimeline());
    const p = e.getState().project, b = p.storyboard!;
    const pls = main(p).placements;
    expect(pls).toHaveLength(12);
    const clipOf = (shot: string) => pls.find((x) => x.source.assetId === b.shots[shot].assetId)!;
    const s03 = linkedTo(p, clipOf("s03").id), s07 = linkedTo(p, clipOf("s07").id);
    const card = s03.find((x) => x.clipType === "text")!;
    expect(card.transform!.x).toBeCloseTo(0.37 + 0.15 - 0.5);
    expect(card.transform!.y).toBeCloseTo(0.42 + 0.06 - 0.5);
    expect(card.text).toMatchObject({ size: 0.035, color: "#3a3a3a", animIn: "fade" });
    expect(s03.some((x) => x.effect?.preset === "ken-burns")).toBe(true);
    const title = s07.find((x) => x.clipType === "text")!;
    expect(title.text).toMatchObject({ text: "ALLOTMENT", size: 0.09, color: "#ffffff", bold: false, animIn: "fade", animOut: "fade" });
    expect(title.transform?.x ?? 0).toBe(0);
    expect(clipOf("s07").transitionIn).toEqual({ kind: "dip", durationTicks: s(0.5) });
    expect(clipOf("s08").transitionIn).toEqual({ kind: "crossfade", durationTicks: s(0.8) });
  });
});
