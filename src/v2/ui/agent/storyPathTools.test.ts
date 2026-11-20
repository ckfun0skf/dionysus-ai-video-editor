// @vitest-environment jsdom
/** P89b: storyboard path tools (set_story_path / remove_story_path) and the timeline's named-path tools. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, type Project } from "../../domain";
import { runStoryTool } from "../../domain/storyAgent";
import { validateStoryboard, type StoryDoc } from "../../domain/storyJson";
import { storyboardFromDoc } from "../../domain/storyboard";
import { storyboardToDoc } from "../../domain/storyRoundtrip";
import { cmd, Engine } from "../../engine";
import { agentStore } from "./webMcp";
import { runTimelineTool } from "./timelineTools";

const S = 120_000;
const PLAN = { nodes: [{ id: "a", x: 0.1, y: 0.5 }, { id: "b", x: 0.5, y: 0.2 }, { id: "c", x: 0.9, y: 0.5 }] };
const DOC = {
  format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "bee", type: "video", name: "Bee reference", prompt: "a bee", source: "upload" }, { id: "logo", type: "image", name: "Logo", prompt: "logo" }],
  paths: [{ id: "flight", name: "Bee flight", from: "bee", motionPath: PLAN, durationSec: 2 }],
  shots: [{ id: "s1", title: "One", durationSec: 4, prompt: "p", assets: [], qa: [], layers: [
    { id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } },
    { id: "i1", type: "image", asset: "logo", startSec: 1, endSec: 3, box: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } },
  ] }],
  connections: [],
};
const ctx = { guide: () => "" };
const parse = () => { const r = validateStoryboard(structuredClone(DOC)); if (!r.ok) throw new Error("bad"); return r.doc as StoryDoc; };
/** What the tools get in the app: the board written back as JSON (webMcp currentDoc). */
const cur = (d: StoryDoc) => storyboardToDoc(storyboardFromDoc(d));
const clips = (p: Project) => Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));
beforeEach(() => { localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true); });
afterEach(() => agentStore.reset());

describe("P89b story path tools", () => {
  it("set_story_path adds / replaces a path and keeps points made in the app; remove_story_path unlinks layers", () => {
    let doc = cur(parse());
    const add = runStoryTool("set_story_path", { path: { id: "swoop", name: "Swoop", motionPath: { nodes: [{ x: 0.2, y: 0.8 }, { x: 0.8, y: 0.2 }] } } }, doc, ctx);
    expect(add.ok).toBe(true);
    expect(add.text).toContain('Path "swoop" added');
    doc = cur(add.doc!);
    expect(doc.paths!.map((x) => x.id)).toEqual(["flight", "swoop"]);
    // A path tracked in the app keeps its points when the AI only renames it.
    const made = { ...doc, paths: doc.paths!.map((x) => (x.id === "flight" ? { ...x, createdBy: "track" as const } : x)) } as StoryDoc;
    const ren = runStoryTool("set_story_path", { path: { id: "flight", name: "Bee route", from: "bee" } }, made, ctx);
    expect(ren.ok).toBe(true);
    const f = ren.doc!.paths!.find((x) => x.id === "flight")!;
    expect([f.name, f.createdBy, f.motionPath?.nodes.length]).toEqual(["Bee route", "track", 3]);
    expect(runStoryTool("set_story_path", { path: { id: "x", motionPath: { ref: "flight" } } }, doc, ctx).ok).toBe(false);
    const rm = runStoryTool("remove_story_path", { id: "flight" }, doc, ctx);
    expect(rm.text).toContain("1 layer no longer move");
    expect(rm.doc!.shots[0].layers![0].pathRef).toBeUndefined();
    expect(runStoryTool("remove_story_path", { id: "nope" }, doc, ctx).ok).toBe(false);
  });

  it("set_clip_motion_path ref / saved, list_motion_paths and save_motion_path", async () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(parse()));
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: 4 * S }, { versionId: "o1" }));
    e.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "k3", mime: "image/png", width: 200, height: 200 }, { versionId: "g1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    const run = (name: string, args: object) => runTimelineTool(e, undefined, name, args);
    const text = clips(e.getState().project).find((x) => x.clipType === "text")!;
    const image = () => clips(e.getState().project).find((x) => x.clipType === "image")!;
    expect(text.pathRef).toEqual({ ref: "flight", stretch: true });
    const list = JSON.parse((await run("list_motion_paths", {})).text);
    expect(list.storyboard[0]).toMatchObject({ id: "flight", name: "Bee flight", points: 3, seconds: 2, from: "bee", made: false, usedBy: ["s1/t1"], clips: [text.id] });
    expect(list.saved).toEqual([]);
    expect((await run("set_clip_motion_path", { clipId: image().id, ref: "flight", path: PLAN })).text).toMatch(/exactly one/);
    expect((await run("set_clip_motion_path", { clipId: image().id, ref: "nope" })).text).toMatch(/No storyboard path "nope"\. Paths: flight/);
    const r = await run("set_clip_motion_path", { clipId: image().id, ref: "flight", offset: { x: 0, y: 0.1 } });
    expect(r.ok).toBe(true);
    expect(image().pathRef).toEqual({ ref: "flight", stretch: true, offset: { x: 0, y: 0.1 } });
    expect(image().motionPath!.nodes.at(-1)!.t).toBe(image().durationTicks);
    expect(image().motionPath!.nodes[0].y).toBeCloseTo(0.1, 4);
    expect(e.undo()).toBe(true); // one step
    expect(image().pathRef).toBeUndefined();
    const sv = await run("save_motion_path", { clipId: text.id, name: "Swoop" });
    expect(sv.text).toMatch(/^Saved path path1 "Swoop" \(3 points\)\./);
    expect((await run("save_motion_path", { clipId: image().id, name: "X" })).text).toMatch(/no motion path to save/);
    const u = await run("set_clip_motion_path", { clipId: image().id, saved: "swoop" });
    expect(u.ok).toBe(true);
    expect(image().pathRef).toBeUndefined(); // a copy
    expect(image().motionPath!.nodes).toHaveLength(3);
    expect(JSON.parse((await run("list_motion_paths", {})).text).saved).toEqual([{ id: "path1", name: "Swoop", points: 3, seconds: 4 }]);
  });
});
