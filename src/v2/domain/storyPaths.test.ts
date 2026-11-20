/** P89b: named storyboard paths — parse, guide steps, Send / Update / Re-lay resolution, Sync write-back, export. */
import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./index";
import { storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { storyboardToDoc } from "./storyRoundtrip";
import { productionSteps } from "./storyboard";
import { stepDeps } from "./storySteps";
import { updatePlan } from "./storySend";
import * as sp from "./storyPaths";
import { pathOfSource, resolveSource, sourceChoices } from "./codeInputs";
import { cmd, Engine } from "../engine";

const S = 120_000;
const PLAN = { nodes: [{ id: "a", x: 0.1, y: 0.5 }, { id: "b", x: 0.5, y: 0.2 }, { id: "c", x: 0.9, y: 0.5 }] };
function doc(over: { paths?: unknown[]; layers?: unknown[]; layers2?: unknown[] } = {}) {
  return {
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "bee", type: "video", name: "Bee reference", prompt: "a bee flying", source: "upload" }, { id: "logo", type: "image", name: "Logo", prompt: "logo" }],
    paths: over.paths ?? [{ id: "flight", name: "Bee flight", from: "bee", track: "the bee", motionPath: PLAN, durationSec: 2 }],
    shots: [
      { id: "s1", title: "One", durationSec: 4, prompt: "p", assets: [], qa: [], layers: over.layers ?? [
        { id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } },
        { id: "i1", type: "image", asset: "logo", startSec: 1, endSec: 3, box: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, motionPath: { ref: "flight", offset: { x: 0, y: 0.1 } } },
      ] },
      { id: "s2", title: "Two", durationSec: 2, prompt: "p", assets: [], qa: [], layers: over.layers2 ?? [] },
    ],
    connections: [],
  };
}
const all = (p: Project) => Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));
function boardEngine(d = doc()) {
  const r = validateStoryboard(d);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.doc as StoryDoc));
  return { e, r };
}
function sent(d = doc()) {
  const { e } = boardEngine(d);
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: 4 * S }, { versionId: "o1" }));
  e.dispatch(cmd.addStoryVersion({ shot: "s2" }, { blobKey: "k2", mime: "video/mp4", durationTicks: 2 * S }, { versionId: "o2" }));
  e.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "k3", mime: "image/png", width: 200, height: 200 }, { versionId: "g1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  return e;
}
const textClip = (e: Engine) => all(e.getState().project).find((x) => x.clipType === "text")!;
const imageClip = (e: Engine) => all(e.getState().project).find((x) => x.clipType === "image")!;

describe("storyboard paths: JSON (P89b)", () => {
  it("parses planned points, a reference to make one from, and layer refs; bad parts warn and are dropped", () => {
    const { r } = boardEngine();
    const p = r.doc.paths![0];
    expect(p).toMatchObject({ id: "flight", name: "Bee flight", from: "bee", track: "the bee", durationSec: 2 });
    // Frame points → centre offsets; no times = spread by distance over durationSec, even speed.
    expect(p.motionPath!.nodes.map((n) => [n.x, n.y])).toEqual([[-0.4, 0], [0, -0.3], [0.4, 0]]);
    expect([p.motionPath!.nodes[0].t, p.motionPath!.nodes[2].t, p.motionPath!.constantSpeed]).toEqual([0, 2 * S, true]);
    expect(r.doc.shots[0].layers![0].pathRef).toEqual({ ref: "flight", stretch: true });
    expect(r.doc.shots[0].layers![1].pathRef).toEqual({ ref: "flight", offset: { x: 0, y: 0.1 } });
    // The reference asset counts as used.
    expect(r.warnings.some((w) => /"bee" isn't used/.test(w.message))).toBe(false);

    const bad = validateStoryboard(doc({
      paths: [{ id: "p1", from: "nope", motionPath: { nodes: [{ x: "?", y: 0 }] }, extra: 1 }, { id: "p2" }, { id: "p3", from: "logo", createdBy: "draw" }],
      layers: [{ id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "missing" }, follow: "shot" }],
    }));
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    const w = (path: string) => bad.warnings.filter((x) => x.path === path).map((x) => x.message).join(" ");
    expect(w("paths[0].from")).toMatch(/not an asset id/);
    expect(w("paths[0].extra")).toMatch(/Unknown field/);
    expect(w("paths[0].motionPath.nodes[0]")).toMatch(/ignored/);
    expect(w("paths[1]")).toMatch(/guide asks to draw it/);
    expect(w("paths[2].createdBy")).toMatch(/without points/);
    expect(w("shots[0].layers[0].motionPath.ref")).toMatch(/No path "missing".*p1, p2, p3/);
    expect(bad.doc.paths!.map((x) => [x.id, !!x.from, !!x.motionPath, x.createdBy])).toEqual([["p1", false, false, undefined], ["p2", false, false, undefined], ["p3", true, false, undefined]]);
    expect(bad.doc.shots[0].layers![0].pathRef).toBeUndefined();
    // A duplicate id is an error.
    expect(validateStoryboard(doc({ paths: [{ id: "x", motionPath: PLAN }, { id: "x", motionPath: PLAN }] })).ok).toBe(false);
  });

  it("exports frame points, refs and createdBy, and the export imports again to the same board", () => {
    const { e } = boardEngine();
    const made = { ...e.getState().project.storyboard!.paths![0], createdBy: "draw" as const };
    e.dispatch(cmd.setStoryPath("flight", made));
    const b = e.getState().project.storyboard!;
    const out = storyboardToDoc(b);
    expect(out.paths![0]).toMatchObject({ id: "flight", from: "bee", track: "the bee", createdBy: "draw", motionPath: { nodes: [{ id: "a", t: 0, x: 0.1, y: 0.5 }, { id: "b" }, { id: "c", t: 2, x: 0.9, y: 0.5 }], constantSpeed: true } });
    expect(out.shots[0].layers![0].motionPath).toEqual({ ref: "flight", stretch: true });
    const again = validateStoryboard(JSON.parse(storyDocJson(out)));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.doc.paths).toEqual(b.paths);
    expect(again.doc.shots[0].layers![0].pathRef).toEqual({ ref: "flight", stretch: true });
  });
});

describe("storyboard paths: guide steps (P89b)", () => {
  it("adds 'Create path <name> from <reference>' after its reference and before the shots that use it", () => {
    const { e } = boardEngine();
    const keys = () => productionSteps(e.getState().project).map((s) => `${s.key}=${s.state}`);
    expect(keys()).toEqual(["slot:logo=todo", "slot:bee=todo", "path:flight=blocked", "shot:s1=todo", "shot:s2=todo"]);
    expect(productionSteps(e.getState().project)[2].waitsFor).toBe("bee");
    expect(stepDeps(e.getState().project.storyboard!).get("shot:s1")).toContain("path:flight");
    expect(sp.pathStepTitle(e.getState().project.storyboard!.paths![0], "Bee reference")).toBe("Create path Bee flight from Bee reference");
    e.dispatch(cmd.addStoryVersion({ slot: "bee" }, { blobKey: "kb", mime: "video/mp4", durationTicks: 3 * S, width: 640, height: 360 }, { versionId: "b1" }));
    expect(keys()[2]).toBe("path:flight=todo");
    e.dispatch(cmd.setStoryPath("flight", { ...e.getState().project.storyboard!.paths![0], createdBy: "track" }));
    expect(keys()[2]).toBe("path:flight=done");
    // A planned path with nothing to make it from is done; one with no points asks to be drawn.
    const { e: e2 } = boardEngine(doc({ paths: [{ id: "plan", motionPath: PLAN }, { id: "todo" }] }));
    expect(productionSteps(e2.getState().project).filter((s) => s.key.startsWith("path:")).map((s) => `${s.key}=${s.state}`)).toEqual(["path:plan=done", "path:todo=todo"]);
  });

  it("turns a tracker on the reference into a path on the frame (contain-fit, times from the in point, weak frames left out)", () => {
    const samples = [0, 1, 2, 3, 4].map((i) => ({ s: 1000 + i * S / 2, x: 0.1 + i * 0.2, y: 0.5, w: 0.1, h: 0.1, scale: 1, conf: i === 2 ? 0.2 : 0.9 }));
    // A 4:3 reference in a 16:9 frame: 0.75 of the frame width.
    const mp = sp.pathFromTrack({ samples, inS: 1000, srcW: 640, srcH: 480 }, 16 / 9);
    expect(mp.nodes.map((n) => [n.t, n.x, n.y])).toEqual([[0, -0.3, 0], [2 * S, 0.3, 0]]);
    // A curved 3 s track at 30 fps becomes a few smooth points, not one per frame.
    const arc = Array.from({ length: 90 }, (_, i) => ({ s: i * 4000, x: 0.1 + (0.8 * i) / 89, y: 0.7 - 0.5 * Math.sin((Math.PI * i) / 89), w: 0.1, h: 0.1, scale: 1, conf: 0.95 }));
    const c = sp.pathFromTrack({ samples: arc, inS: 0, srcW: 1920, srcH: 1080 }, 16 / 9);
    expect(c.nodes.length).toBeGreaterThan(2);
    expect(c.nodes.length).toBeLessThanOrEqual(sp.MAX_TRACK_POINTS);
    expect(c.nodes.slice(1, -1).every((n) => n.in && n.out)).toBe(true);
    expect([c.nodes[0].x, c.nodes.at(-1)!.x, c.nodes.at(-1)!.t]).toEqual([-0.4, 0.4, 89 * 4000]);
  });
});

describe("storyboard paths: timeline (P89b)", () => {
  it("Send resolves each ref for its layer clip (stretch, offset) and keeps the link", () => {
    const e = sent();
    const t = textClip(e), im = imageClip(e);
    expect(t.pathRef).toEqual({ ref: "flight", stretch: true });
    expect(t.motionPath!.nodes.map((n) => [n.t, n.x, n.y])).toEqual([[0, -0.4, 0], [2 * S, 0, -0.3], [4 * S, 0.4, 0]]);
    expect(im.motionPath!.nodes.map((n) => [n.t, n.x, n.y])).toEqual([[0, -0.4, 0.1], [S, 0, -0.2], [2 * S, 0.4, 0.1]]);
    expect(t.link).toBeTruthy();
  });

  it("an edited named path refreshes its layers on Update; Re-lay refits a stretched path to the new length", () => {
    const e = sent();
    const b = e.getState().project.storyboard!;
    const moved = { ...b.paths![0], motionPath: { ...b.paths![0].motionPath!, nodes: b.paths![0].motionPath!.nodes.map((n) => (n.id === "b" ? { ...n, y: 0.2 } : n)) } };
    e.dispatch(cmd.setStoryPath("flight", moved));
    expect(updatePlan(e.getState().project).refreshed).toEqual(["s1"]);
    e.dispatch(cmd.updateStoryTimeline());
    expect(textClip(e).motionPath!.nodes[1].y).toBe(0.2);
    expect(imageClip(e).motionPath!.nodes[1].y).toBe(0.3);
    expect(updatePlan(e.getState().project).refreshed).toEqual([]);
  });

  it("Re-lay places a stretched path again when its layer gets another length", () => {
    // A still shot plays its picture for the planned length; shortening the shot clamps the layer, and Re-lay refits.
    const d = doc({ layers: [{ id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } }] });
    (d.shots[0] as Record<string, unknown>).render = "still";
    (d.shots[0] as Record<string, unknown>).clip = "logo";
    delete (d.shots[0] as Record<string, unknown>).prompt;
    const { e } = boardEngine(d);
    e.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "k3", mime: "image/png", width: 200, height: 200 }, { versionId: "g1" }));
    e.dispatch(cmd.addStoryVersion({ shot: "s2" }, { blobKey: "k2", mime: "video/mp4", durationTicks: 2 * S }, { versionId: "o2" }));
    e.dispatch(cmd.sendStoryToTimeline());
    expect(textClip(e).motionPath!.nodes.at(-1)!.t).toBe(4 * S);
    e.dispatch(cmd.updateShot("s1", { durationSec: 2 }));
    e.dispatch(cmd.relayoutStoryTimeline());
    expect(textClip(e).durationTicks).toBe(2 * S);
    expect(textClip(e).motionPath!.nodes.map((n) => n.t)).toEqual([0, S, 2 * S]);
    expect(textClip(e).pathRef).toEqual({ ref: "flight", stretch: true });
  });

  it("Sync writes an edit back into the named path when one layer uses it, else gives the layer its own copy", () => {
    // One user: the text layer only.
    const one = sent(doc({ layers: [{ id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } }] }));
    const t = textClip(one);
    one.dispatch(cmd.syncToStoryboard());
    expect(one.getState().project.storyboard!.shots.s1.layers![0].pathRef).toEqual({ ref: "flight", stretch: true });
    const edited = { ...t.motionPath!, nodes: t.motionPath!.nodes.map((n) => (n.id === "c" ? { ...n, x: 0.45 } : n)) };
    one.dispatch(cmd.setMotionPath(t.id, edited));
    one.dispatch(cmd.syncToStoryboard());
    const b = one.getState().project.storyboard!;
    expect(b.shots.s1.layers![0].pathRef).toEqual({ ref: "flight", stretch: true });
    expect(b.shots.s1.layers![0].motionPath).toBeUndefined();
    expect(b.paths![0].motionPath!.nodes.map((n) => [n.t, n.x])).toEqual([[0, -0.4], [S, 0], [2 * S, 0.45]]);
    // Two users: the edited layer gets its own path, the named path stays.
    const two = sent();
    const t2 = textClip(two);
    two.dispatch(cmd.setMotionPath(t2.id, { ...t2.motionPath!, nodes: t2.motionPath!.nodes.map((n) => (n.id === "c" ? { ...n, x: 0.45 } : n)) }));
    two.dispatch(cmd.syncToStoryboard());
    const b2 = two.getState().project.storyboard!;
    expect(b2.shots.s1.layers![0].pathRef).toBeUndefined();
    expect(b2.shots.s1.layers![0].motionPath!.nodes[2].x).toBe(0.45);
    expect(b2.shots.s1.layers![1].pathRef).toEqual({ ref: "flight", offset: { x: 0, y: 0.1 } });
    expect(b2.paths![0].motionPath!.nodes[2].x).toBe(0.4);
  });

  it("a code clip reads a named path as an input (storyboard or saved), at its own time", () => {
    const e = sent();
    e.dispatch(cmd.saveMotionPath("Swoop", textClip(e).motionPath!));
    const p = e.getState().project;
    expect(sourceChoices(p, "path").map((c) => c.label)).toEqual(["None", "Storyboard · Bee flight", "Saved · Swoop"]);
    expect(resolveSource(p, "Bee flight", "path")).toEqual({ source: "path:flight" });
    expect(resolveSource(p, "swoop", "path")).toEqual({ source: "path:saved/path1" });
    expect(resolveSource(p, "nope", "path")).toHaveProperty("error");
    const mp = pathOfSource(p, "path:flight")!;
    expect(sp.pathSignal(mp, S, 16 / 9)).toEqual({ x: 0.5, y: 0.2, angle: 22.8737, progress: 0.5, found: true }); // at the corner: the next segment's direction
    expect(sp.pathSignal(undefined, 0, 1)).toEqual(sp.NO_PATH);
  });
});
