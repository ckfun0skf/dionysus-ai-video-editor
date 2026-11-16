// @vitest-environment jsdom
/**
 * P78 (Phase 2 step 2.5): the scene clip type's contributed agent tools, end to end: registered on WebMCP next to the
 * built-in tools, run through the timeline tool runner, one undo step per edit, saved through the version rules
 * (mode new / replace), and clear errors.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, ops, parseScene, SAMPLE_SCENE, secondsToTicks as s, type Asset, type Project, type SceneDoc } from "../../domain";
import { cmd, Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { bytesToDataUrl, makeAnimatedGlb } from "../cubeGlb";
import { agentStore, ALL_AGENT_TOOLS, registerAgentTools, type ToolResponse } from "./webMcp";
import { runTimelineTool } from "./timelineTools";
import { resetSceneAgentSession } from "../../clipTypes/scene/agent";

const SCENE_TOOLS = ["create_scene_clip", "get_scene", "list_scene_objects", "add_scene_object", "set_scene_object", "remove_scene_object", "add_scene_event", "update_scene_event", "retime_scene_event", "remove_scene_event", "set_scene_world", "apply_scene_edits"];
const READ_ONLY = new Set(["get_scene", "list_scene_objects"]);

const readBlob = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });
const memBlobs = (): BlobStore & { m: Map<string, Blob> } => {
  const m = new Map<string, Blob>();
  // jsdom's Blob has no text(); give the stored blobs one, like the browser's.
  return { m, async put(k, b) { Object.defineProperty(b, "text", { value: () => readBlob(b), configurable: true }); m.set(k, b); }, async get(k) { return m.get(k); }, async delete(k) { m.delete(k); }, async keys() { return [...m.keys()]; } };
};
function setup() {
  const v: Asset = { id: "v", kind: "video", name: "v", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "", media: { blobKey: "v", mime: "video/mp4", durationTicks: s(4) }, provenance: { source: "import", inputs: [] } }] };
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(v)]);
  e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "c1"));
  return e;
}
/** Register every tool on a fake WebMCP host and return a caller by name (the page's real registration path). */
function host(e: Engine, blobs: BlobStore) {
  const defs = new Map<string, { execute: (i: Record<string, unknown>) => Promise<ToolResponse>; inputSchema: object; annotations?: { readOnlyHint?: boolean } }>();
  const off = registerAgentTools(e, { registerTool: (t) => { defs.set(t.name, t); return undefined; }, unregisterTool: (n) => defs.delete(n) }, { blobs });
  const call = async (name: string, input: Record<string, unknown>) => {
    const r = await defs.get(name)!.execute(input);
    const text = (r.content[0] as { text: string }).text;
    return { ok: !r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  };
  return { defs, off, call };
}
const sceneOf = async (p: Project, blobs: BlobStore, clipId: string): Promise<SceneDoc> => {
  for (const c of Object.values(p.compositions)) {
    const pl = c.tracks.flatMap((t) => t.placements).find((x) => x.id === clipId);
    if (pl) { const a = p.assets[pl.source.assetId]; const v = a.versions.find((x) => x.id === (pl.source as { versionId?: string }).versionId) ?? a.versions.find((x) => x.id === a.selectedVersionId)!; return parseScene(await readBlob((await blobs.get(v.media.blobKey))!)).doc!; }
  }
  throw new Error("no clip");
};
const sceneAsset = (p: Project) => Object.values(p.assets).find((a) => a.kind === "scene")!;

beforeEach(() => { localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true); resetSceneAgentSession(); });
afterEach(() => agentStore.reset());

describe("P78 scene agent tools through WebMCP", () => {
  it("registers the contributed scene tools after the built-ins, with schemas and read-only hints; unregisters them", () => {
    const e = setup(), { defs, off } = host(e, memBlobs());
    const names = ALL_AGENT_TOOLS.map((t) => t.name);
    expect(names.slice(-SCENE_TOOLS.length)).toEqual(SCENE_TOOLS);
    for (const n of SCENE_TOOLS) {
      expect(defs.has(n), n).toBe(true);
      expect(defs.get(n)!.annotations?.readOnlyHint, n).toBe(READ_ONLY.has(n));
      expect(JSON.stringify(defs.get(n)!.inputSchema)).toContain('"type":"object"');
    }
    for (const n of SCENE_TOOLS.filter((x) => !READ_ONLY.has(x) && x !== "create_scene_clip")) expect(JSON.stringify(defs.get(n)!.inputSchema), n).toContain('"mode"');
    off();
    expect(SCENE_TOOLS.some((n) => defs.has(n))).toBe(false);
  });

  it("an agent session builds a small scene: every tool, one undo step each, the scene stays valid", async () => {
    const e = setup(), blobs = memBlobs(), { call } = host(e, blobs);
    const made = await call("create_scene_clip", { name: "Bounce", durationSec: 3 });
    expect(made.ok).toBe(true);
    const clipId = made.json.clip.id as string;
    expect(made.json.clip).toMatchObject({ type: "scene", start: 4, duration: 3 });
    const steps: [string, Record<string, unknown>][] = [
      ["set_scene_world", { background: "#101820", camera: { position: [0, 2, 6], lookAt: [0, 0.5, 0] }, lights: [{ type: "ambient", intensity: 0.5 }, { type: "directional", position: [3, 5, 2] }] }],
      ["add_scene_object", { shape: "plane", id: "floor", size: [8, 8], props: { rotation: [-90, 0, 0], color: "#334455" } }],
      ["add_scene_object", { shape: "sphere", id: "ball", size: [0.6, 0.6, 0.6], props: { position: [-2, 0.3, 0], color: "#ff8800" } }],
      ["add_scene_object", { file: { name: "bot.glb", dataUrl: bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary") }, id: "bot", props: { position: [2, 0, 0] } }],
      ["set_scene_object", { objectId: "ball", props: { functions: { pop: { params: { k: { type: "number", default: 1.3 } }, set: { scale: "$k" } } } } }],
      ["add_scene_event", { event: { at: 0.5, obj: "ball", call: "moveTo", args: { position: [2, 0.3, 0] }, dur: 1.5, ease: "inOut" } }],
      ["add_scene_event", { event: { at: 2, obj: "ball", call: "pop", dur: 0.3 } }],
      ["add_scene_event", { event: { at: 0, obj: "bot", call: "play", args: { clip: "Spin" } } }],
      ["add_scene_event", { event: { at: 2.5, obj: "bot", call: "stop" } }],
      ["update_scene_event", { index: 0, ease: "outBack" }],
      ["retime_scene_event", { index: 1, shiftSec: 0.2 }],
      ["add_scene_event", { event: { at: 1, obj: "camera", call: "fov", args: { value: 40 }, dur: 1 } }],
      ["remove_scene_event", { index: 3 }],
      ["add_scene_object", { shape: "box", id: "junk" }],
      ["remove_scene_object", { objectId: "junk" }],
    ];
    for (const [tool, input] of steps) {
      const before = e.getState().project;
      const r = await call(tool, { clipId, ...input });
      expect(r.ok, `${tool}: ${r.text}`).toBe(true);
      expect(e.getState().project, tool).not.toBe(before);
      e.undo();
      expect(e.getState().project, `${tool} is one undo step`).toEqual(before);
      e.redo();
    }
    const doc = await sceneOf(e.getState().project, blobs, clipId);
    expect(doc.objects.map((o) => o.id)).toEqual(["floor", "ball", "bot"]);
    // Events keep their list order (indexes are positions in "events"); the player sorts by time.
    expect(doc.events).toEqual([
      { at: 0.5, obj: "ball", call: "moveTo", args: { position: [2, 0.3, 0] }, dur: 1.5, ease: "outBack" },
      { at: 2.2, obj: "ball", call: "pop", args: { k: 1.3 }, dur: 0.3 },
      { at: 0, obj: "bot", call: "play", args: { clip: "Spin" } },
      { at: 1, obj: "camera", call: "fov", args: { value: 40 }, dur: 1 },
    ]);
    const listed = await call("list_scene_objects", { clipId });
    expect(listed.json.objects.map((o: { id: string }) => o.id)).toEqual(["floor", "ball", "bot"]);
    expect(listed.json.objects[2].calls.map((c: { call: string }) => c.call)).toEqual(expect.arrayContaining(["play", "stop"]));
    const got = await call("get_scene", { clipId });
    // P79: one agent session, so all the edits updated the clip's first version (no version per call).
    expect(got.json).toMatchObject({ clipId, version: { number: 1, of: 1 }, clipSec: { start: 4, length: 3 }, problems: [] });
    expect(got.json.scene.files["bot.glb"]).toMatch(/^<data:model\/gltf-binary/);
    expect(agentStore.get().log[0]).toMatchObject({ tool: "get_scene", ok: true, changed: false });
  });

  it("saves through the version rules: one session version in mode new, newVersion starts another, replace in place with mode replace (remembered)", async () => {
    const e = setup(), blobs = memBlobs(), { call } = host(e, blobs);
    const clipId = (await call("create_scene_clip", { scene: SAMPLE_SCENE })).json.clip.id;
    expect(sceneAsset(e.getState().project).versions).toHaveLength(1);
    const n = await call("add_scene_object", { clipId, shape: "box", id: "a" });
    expect(n.json.version).toMatchObject({ number: 1, of: 1, mode: "new", saved: "updated this session's version" });
    const n2 = await call("add_scene_object", { clipId, shape: "box", id: "a2", newVersion: true });
    expect(n2.json.version).toMatchObject({ number: 2, of: 2, mode: "new", saved: "new version" });
    expect(e.getState().project.settings.versionSaveMode).toBeUndefined();
    const r = await call("add_scene_object", { clipId, shape: "box", id: "b", mode: "replace" });
    expect(r.json.version).toMatchObject({ number: 2, of: 2, mode: "replace", saved: "replaced the shown version" });
    expect(e.getState().project.settings.versionSaveMode).toBe("replace");
    const r2 = await call("add_scene_object", { clipId, shape: "box", id: "c" });
    expect(r2.json.version).toMatchObject({ of: 2, mode: "replace" });
    expect((await sceneOf(e.getState().project, blobs, clipId)).objects.map((o) => o.id).slice(-4)).toEqual(["a", "a2", "b", "c"]);
    e.undo(); e.undo(); e.undo(); e.undo();
    expect(sceneAsset(e.getState().project).versions).toHaveLength(1);
    expect((await sceneOf(e.getState().project, blobs, clipId)).objects).toHaveLength(SAMPLE_SCENE.objects.length);
  });

  it("errors are clear and change nothing", async () => {
    const e = setup(), blobs = memBlobs(), { call } = host(e, blobs);
    const clipId = (await call("create_scene_clip", { scene: SAMPLE_SCENE, atSec: 0 })).json.clip.id;
    const before = e.getState().project;
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["get_scene", { clipId: "nope" }, /No clip "nope"\. Call get_timeline/],
      ["add_scene_object", { clipId: "c1", shape: "box" }, /c1 is a video clip; scene tools work on 3D scene clips/],
      ["add_scene_event", { clipId, event: { at: 0, obj: "dog", call: "moveTo" } }, /Objects: camera, floor, ball, cube, sign/],
      ["add_scene_event", { clipId, event: { at: 0, obj: "ball", call: "jump" } }, /Its calls: position, moveTo.*its own functions: setMood/],
      ["add_scene_event", { clipId, event: { at: 0, obj: "ball", call: "moveTo", args: { to: 1 } } }, /It takes position: \[x, y, z\]/],
      ["update_scene_event", { clipId, index: 99 }, /event index 0\.\.5/],
      ["set_scene_object", { clipId, objectId: "ball", props: { color: "red" } }, /would not be valid, nothing changed/],
      ["add_scene_object", { clipId, shape: "box", mode: "keep" }, /"mode" must be "new" or "replace"/],
      ["create_scene_clip", { scene: { objects: [{ id: "x", shape: "star" }] } }, /not valid: objects\[0\]/],
      ["create_scene_clip", { durationSec: 0 }, /"durationSec" must be seconds > 0/],
    ];
    for (const [tool, input, re] of cases) {
      const r = await call(tool, input);
      expect(r.ok, tool).toBe(false);
      expect(r.text, tool).toMatch(re);
    }
    expect(e.getState().project).toBe(before);
    expect(agentStore.get().log.filter((l) => !l.ok)).toHaveLength(cases.length);
  });

  it("needs the media store, and a missing scene file is reported", async () => {
    const e = setup(), blobs = memBlobs();
    expect((await runTimelineTool(e, undefined, "create_scene_clip", {})).text).toMatch(/need the project's media store/);
    const { call } = host(e, blobs);
    const clipId = (await call("create_scene_clip", {})).json.clip.id;
    blobs.m.clear();
    expect((await call("get_scene", { clipId })).text).toMatch(/scene file of clip .* is missing/);
    const p = e.getState().project, root = p.compositions[p.rootCompositionId];
    expect(ops.mainTrack(root)!.placements.map((x) => x.clipType ?? "video")).toEqual(["video", "scene"]);
  });
});
