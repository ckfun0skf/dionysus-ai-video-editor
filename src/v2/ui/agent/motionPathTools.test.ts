// @vitest-environment jsdom
/** P89: set_clip_motion_path / clear_clip_motion_path, get_timeline, and tracking Follow replacing a path. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, findPlacement, secondsToTicks as s, type Asset, type Project } from "../../domain";
import { cmd, Engine } from "../../engine";
import { agentStore } from "./webMcp";
import { runTimelineTool, trackAnalyser } from "./timelineTools";

function asset(id: string, kind: Asset["kind"], seconds?: number): Asset {
  return { id, kind, name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "x", durationTicks: seconds ? s(seconds) : undefined }, provenance: { source: "import" } }] } as Asset;
}
const root = (p: Project) => p.compositions[p.rootCompositionId];
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", "video", 10))]);
  e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "c1"));
  e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "t1"));
  e.dispatch(cmd.setKeyframe("t1", "x", 0, 0.1));
  e.dispatch(cmd.setKeyframe("t1", "x", s(1), 0.2));
  e.dispatch(cmd.setKeyframe("t1", "scale", 0, 1.5));
  return e;
}
const json = (t: string) => JSON.parse(t);
beforeEach(() => { localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true); });
afterEach(() => agentStore.reset());

describe("P89 motion path tools", () => {
  it("sets a path (one undo step, x / y keys replaced), lists it in get_timeline, warns, rejects bad input and clears it", async () => {
    const e = setup();
    const run = (name: string, args: object) => runTimelineTool(e, undefined, name, args);
    const pl = (id: string) => findPlacement(root(e.getState().project), id)!.placement;
    expect((await run("set_clip_motion_path", { clipId: "c1", path: { nodes: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }] } })).text).toMatch(/cannot have a motion path.*main track/);
    const bad = await run("set_clip_motion_path", { clipId: "t1", path: { nodes: [{ t: 2, x: 0, y: 0 }, { t: 1, x: 0.1, y: 0 }] } });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/path\.nodes\[1\]\.t: Times must increase/);
    expect(pl("t1").motionPath).toBeUndefined();
    const r = await run("set_clip_motion_path", { clipId: "t1", path: { nodes: [{ id: "a", x: -0.3, y: 0.2 }, { id: "b", x: 0.3, y: 0.2, in: { x: -0.1, y: -0.2 } }], orient: { offset: 90 }, color: "red" } });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/path\.color: Unknown field "color" is ignored/);
    expect(pl("t1").keyframes).toEqual({ scale: [{ t: 0, v: 1.5 }] });
    const dur = pl("t1").durationTicks / 120_000;
    const tl = json((await run("get_timeline", {})).text).tracks.flatMap((t: { clips: { id: string }[] }) => t.clips).find((c: { id: string }) => c.id === "t1");
    expect(tl.motionPath).toEqual({ nodes: [{ id: "a", t: 0, x: -0.3, y: 0.2 }, { id: "b", t: dur, x: 0.3, y: 0.2, in: { x: -0.1, y: -0.2 } }], constantSpeed: true, orient: { offset: 90 } });
    expect(e.undo()).toBe(true);
    expect(pl("t1").motionPath).toBeUndefined();
    expect(pl("t1").keyframes?.x).toHaveLength(2);
    expect(e.redo()).toBe(true);
    expect((await run("clear_clip_motion_path", { clipId: "t1" })).ok).toBe(true);
    expect(pl("t1").motionPath).toBeUndefined();
    expect((await run("clear_clip_motion_path", { clipId: "t1" })).text).toMatch(/has no motion path/);
  });

  it("following a tracker replaces the path with keyframes", async () => {
    const e = setup();
    const store = new Map<string, Blob>([["v", new Blob(["x"])]]);
    const blobs = { get: async (k: string) => store.get(k), put: async () => undefined, delete: async () => undefined, has: async (k: string) => store.has(k), keys: async () => [...store.keys()] } as unknown as Parameters<typeof runTimelineTool>[5];
    const orig = trackAnalyser.make;
    trackAnalyser.make = () => async (ticks, _start, box) => ({ srcW: 1920, srcH: 1080, samples: ticks.map((t, i) => ({ s: t, x: box.x + box.w / 2 + i * 0.001, y: 0.5, w: box.w, h: box.h, score: 0.9 })) }) as never;
    try {
      const run = (name: string, args: object) => runTimelineTool(e, undefined, name, args, undefined, blobs);
      const pl = (id: string) => findPlacement(root(e.getState().project), id)!.placement;
      expect((await run("set_clip_motion_path", { clipId: "t1", path: { nodes: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }] } })).ok).toBe(true);
      expect((await run("track_clip", { clipId: "c1", region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, fromSec: 0, toSec: 1, followers: ["t1"] })).ok).toBe(true);
      expect(pl("t1").motionPath).toBeUndefined();
      expect(pl("t1").keyframes!.x!.length).toBeGreaterThan(1);
    } finally { trackAnalyser.make = orig; }
  });
});
