// @vitest-environment jsdom
/**
 * P79: no version sprawl from the agent (one session version in mode "new", apply_scene_edits as one step), GLB models
 * from a URL, and storyboard scene assets through attach_asset_version(s) and import_storyboard (inline scenes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, parseScene, SAMPLE_SCENE, secondsToTicks as s, story, type Asset, type Project, type SceneDoc } from "../../domain";
import { cmd, Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { makeAnimatedGlb } from "../cubeGlb";
import { agentStore, registerAgentTools, type ToolResponse } from "./webMcp";
import { runAttachTool, runImportStoryboard, type MediaIO } from "./mediaTools";
import { resetSceneAgentSession, SCENE_SESSION_MS } from "../../clipTypes/scene/agent";

const readBlob = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });
const memBlobs = (): BlobStore & { m: Map<string, Blob> } => {
  const m = new Map<string, Blob>();
  return { m, async put(k, b) { Object.defineProperty(b, "text", { value: () => readBlob(b), configurable: true }); m.set(k, b); }, async get(k) { return m.get(k); }, async delete(k) { m.delete(k); }, async keys() { return [...m.keys()]; } };
};
function setup() {
  const v: Asset = { id: "v", kind: "video", name: "v", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "", media: { blobKey: "v", mime: "video/mp4", durationTicks: s(4) }, provenance: { source: "import", inputs: [] } }] };
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(v)]);
  e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "c1"));
  return e;
}
function host(e: Engine, blobs: BlobStore) {
  const defs = new Map<string, { execute: (i: Record<string, unknown>) => Promise<ToolResponse> }>();
  registerAgentTools(e, { registerTool: (t) => { defs.set(t.name, t); return undefined; }, unregisterTool: (n) => defs.delete(n) }, { blobs });
  return async (name: string, input: Record<string, unknown>) => {
    const r = await defs.get(name)!.execute(input);
    const text = (r.content[0] as { text: string }).text;
    return { ok: !r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() };
  };
}
const assetOf = (p: Project, clipId: string) => {
  const pl = Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements)).find((x) => x.id === clipId)!;
  return p.assets[pl.source.assetId];
};
const sceneOfClip = async (p: Project, blobs: BlobStore, clipId: string): Promise<SceneDoc> => {
  const a = assetOf(p, clipId);
  const pl = Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements)).find((x) => x.id === clipId)!;
  const v = a.versions.find((x) => x.id === (pl.source as { versionId?: string }).versionId) ?? a.versions.find((x) => x.id === a.selectedVersionId)!;
  return parseScene(await readBlob((await blobs.get(v.media.blobKey))!)).doc!;
};

beforeEach(() => {
  if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return readBlob(this); };
  localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true); resetSceneAgentSession();
});
afterEach(() => { agentStore.reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("P79 agent scene edits: one session version, not one per call", () => {
  it("edits of one clip update one version; another clip, newVersion, the timeout or a picked version start a new one", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", { scene: SAMPLE_SCENE })).json.clip.id as string;
    const b = (await call("create_scene_clip", { scene: SAMPLE_SCENE })).json.clip.id as string;
    // b was created last, so a's session is over: a's first edit makes a new version, later ones update it.
    const v1 = await call("add_scene_object", { clipId: a, shape: "box", id: "x1" });
    expect(v1.json.version).toMatchObject({ number: 2, of: 2, saved: "new version" });
    for (const id of ["x2", "x3", "x4"]) {
      const r = await call("add_scene_object", { clipId: a, shape: "box", id });
      expect(r.json.version).toMatchObject({ number: 2, of: 2, saved: "updated this session's version" });
    }
    expect(assetOf(e.getState().project, a).versions).toHaveLength(2);
    // Each edit is still its own undo step.
    e.undo();
    expect((await sceneOfClip(e.getState().project, blobs, a)).objects.map((o) => o.id).slice(-1)).toEqual(["x3"]);
    e.redo();
    // Touching another clip ends a's session.
    expect((await call("add_scene_object", { clipId: b, shape: "box", id: "y" })).json.version).toMatchObject({ of: 2, saved: "new version" });
    expect((await call("add_scene_object", { clipId: a, shape: "box", id: "x5" })).json.version).toMatchObject({ number: 3, of: 3, saved: "new version" });
    // newVersion: true starts a new one on purpose.
    expect((await call("add_scene_object", { clipId: a, shape: "box", id: "x6", newVersion: true })).json.version).toMatchObject({ number: 4, of: 4 });
    expect((await call("add_scene_object", { clipId: a, shape: "box", id: "x7" })).json.version).toMatchObject({ number: 4, of: 4, saved: "updated this session's version" });
    // The timeout closes the session.
    const t0 = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(t0 + SCENE_SESSION_MS + 1);
    expect((await call("add_scene_object", { clipId: a, shape: "box", id: "x8" })).json.version).toMatchObject({ number: 5, of: 5, saved: "new version" });
    // The user shows another version of the clip: the next edit does not overwrite it.
    const first = assetOf(e.getState().project, a).versions[0].id;
    e.dispatch(cmd.setClipVersion(a, first));
    const r = await call("add_scene_object", { clipId: a, shape: "box", id: "x9" });
    expect(r.json.version).toMatchObject({ number: 6, of: 6, saved: "new version" });
    expect(assetOf(e.getState().project, a).versions[0].id).toBe(first);
    expect((await call("add_scene_object", { clipId: a, shape: "box", newVersion: "yes" })).text).toMatch(/"newVersion" must be true or false/);
  });

  it("mode replace never opens a session; a coalesced edit leaves earlier versions alone", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", { scene: SAMPLE_SCENE })).json.clip.id as string;
    const before = (await sceneOfClip(e.getState().project, blobs, a)).objects.length;
    await call("add_scene_object", { clipId: a, shape: "box", id: "n1", newVersion: true });
    await call("add_scene_object", { clipId: a, shape: "box", id: "n2" });
    const asset = assetOf(e.getState().project, a);
    expect(asset.versions).toHaveLength(2);
    const v1 = parseScene(await readBlob((await blobs.get(asset.versions[0].media.blobKey))!)).doc!;
    expect(v1.objects).toHaveLength(before);
    expect((await call("add_scene_object", { clipId: a, shape: "box", id: "r1", mode: "replace" })).json.version).toMatchObject({ of: 2, saved: "replaced the shown version" });
    expect(e.getState().project.settings.versionSaveMode).toBe("replace");
  });
});

describe("P79 apply_scene_edits", () => {
  it("runs a list of edits as one undo step and one version", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", { durationSec: 3 })).json.clip.id as string;
    resetSceneAgentSession();
    const p0 = e.getState().project;
    const r = await call("apply_scene_edits", { clipId: a, edits: [
      { tool: "set_scene_world", background: "#000000" },
      { tool: "add_scene_object", shape: "sphere", id: "ball" },
      { tool: "add_scene_event", event: { at: 0.5, obj: "ball", call: "moveTo", args: { position: [1, 0, 0] }, dur: 1 } },
      { tool: "set_scene_object", objectId: "ball", props: { color: "#ff0000" } },
    ] });
    expect(r.ok, r.text).toBe(true);
    expect(r.json).toMatchObject({ edits: 4, version: { number: 2, of: 2, saved: "new version" } });
    const doc = await sceneOfClip(e.getState().project, blobs, a);
    expect(doc.objects.find((o) => o.id === "ball")).toBeTruthy();
    expect(doc.events).toHaveLength(1);
    e.undo();
    expect(e.getState().project).toEqual(p0);
  });

  it("is all or nothing: one bad edit changes nothing and names it", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", {})).json.clip.id as string;
    const p0 = e.getState().project;
    const r = await call("apply_scene_edits", { clipId: a, edits: [{ tool: "add_scene_object", shape: "box", id: "ok" }, { tool: "add_scene_event", event: { at: 0, obj: "nobody", call: "moveTo" } }] });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/edits\[1\] \(add_scene_event\).*Nothing changed/s);
    expect(e.getState().project).toBe(p0);
    expect((await call("apply_scene_edits", { clipId: a, edits: [{ tool: "get_scene" }] })).ok).toBe(false);
    expect((await call("apply_scene_edits", { clipId: a, edits: "x" })).ok).toBe(false);
    expect(e.getState().project).toBe(p0);
  });
});

describe("P79 GLB models from a URL", () => {
  const glb = makeAnimatedGlb();
  const stub = (body: Uint8Array, status = 200) => {
    const f = vi.fn(async (_u: string, _o?: RequestInit) => ({ ok: status < 400, status, arrayBuffer: async () => body.slice().buffer }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    return f;
  };
  it("add_scene_object and set_scene_object fetch an https / localhost GLB without credentials", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", {})).json.clip.id as string;
    const f = stub(glb);
    const r = await call("add_scene_object", { clipId: a, id: "bot", file: { url: "https://cdn.example/models/bot.glb" } });
    expect(r.ok, r.text).toBe(true);
    expect(f).toHaveBeenCalledWith("https://cdn.example/models/bot.glb", { credentials: "omit" });
    let doc = await sceneOfClip(e.getState().project, blobs, a);
    expect(doc.files?.["bot.glb"]).toMatch(/^data:model\/gltf-binary;base64,Z2xURg/);
    expect(doc.objects.find((o) => o.id === "bot")).toMatchObject({ model: "bot.glb" });
    const r2 = await call("set_scene_object", { clipId: a, objectId: "bot", file: { url: "http://127.0.0.1:8000/robot.glb" } });
    expect(r2.ok, r2.text).toBe(true);
    doc = await sceneOfClip(e.getState().project, blobs, a);
    expect(doc.objects.find((o) => o.id === "bot")).toMatchObject({ model: "robot.glb" });
    // In a batch too.
    const r3 = await call("apply_scene_edits", { clipId: a, edits: [{ tool: "add_scene_object", id: "bot2", file: { url: "https://cdn.example/x?id=1", name: "two.glb" } }] });
    expect(r3.ok, r3.text).toBe(true);
  });

  it("refuses other URLs, non-GLB bytes, HTTP errors and url + dataUrl, changing nothing", async () => {
    const e = setup(), blobs = memBlobs(), call = host(e, blobs);
    const a = (await call("create_scene_clip", {})).json.clip.id as string;
    const p0 = e.getState().project;
    const f = stub(new TextEncoder().encode("not a model at all"));
    const err = async (file: Record<string, unknown>) => { const r = await call("add_scene_object", { clipId: a, file }); expect(r.ok).toBe(false); return r.text; };
    expect(await err({ url: "http://example.com/bot.glb" })).toMatch(/file\.url/);
    expect(await err({ url: "file:///tmp/bot.glb" })).toMatch(/file\.url/);
    expect(await err({ url: "https://cdn.example/bot.gltf" })).toMatch(/needs a \.glb name/);
    expect(await err({ url: "https://cdn.example/bot.glb" })).toMatch(/not a binary glTF/);
    expect(await err({ url: "https://cdn.example/bot.glb", dataUrl: "data:," })).toMatch(/not both/);
    stub(glb, 404);
    expect(await err({ url: "https://cdn.example/bot.glb" })).toMatch(/HTTP 404/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(e.getState().project).toBe(p0);
  });
});

describe("P79 storyboard scene assets: attach and import", () => {
  const DOC = {
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "spin", name: "Spin", type: "scene", prompt: "a turning bottle" }],
    shots: [{ id: "s1", title: "Spin", durationSec: 4, render: "scene", clip: "spin", assets: [], qa: [] }],
  };
  const make = () => { const e = new Engine(createProject("m")); const r = story.parseStoryboard(JSON.stringify(DOC)); if (!r.ok) throw new Error("doc"); e.dispatch(cmd.createStoryboard(r.doc)); return e; };
  const slotAsset = (p: Project) => p.assets[p.storyboard!.slots.spin.assetId!];
  const io = (files: Record<string, string>): MediaIO => ({ origin: "https://app.example", fetch: async (u: string) => { const f = files[new URL(u).pathname]; return { ok: !!f, status: f ? 200 : 404, blob: async () => new Blob([f ?? ""], { type: "application/json" }) } as unknown as Response; } });

  it("attach_asset_version takes a scene as text, an object or a URL, validated; attach_asset_versions too", async () => {
    const e = make(), blobs = memBlobs(), f = io({ "/s.json": JSON.stringify(SAMPLE_SCENE) });
    const t = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "spin", text: JSON.stringify(SAMPLE_SCENE) }, f);
    expect(t.ok, t.text).toBe(true);
    expect(slotAsset(e.getState().project)).toMatchObject({ kind: "scene" });
    const o = await runAttachTool(e, blobs, "attach_asset_version", { shotId: "s1", scene: SAMPLE_SCENE }, f);
    expect(o.ok, o.text).toBe(true);
    const u = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "spin", url: "https://cdn.example/s.json" }, f);
    expect(u.ok, u.text).toBe(true);
    expect(slotAsset(e.getState().project).versions).toHaveLength(3);
    const v = slotAsset(e.getState().project).versions[2];
    expect(v.media.mime).toBe("application/vnd.dionysus.scene+json");
    expect(parseScene(await readBlob((await blobs.get(v.media.blobKey))!)).doc).toBeTruthy();
    const bad = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "spin", scene: { objects: [{ id: "a", shape: "star" }] } }, f);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/Scene rejected/);
    const many = await runAttachTool(e, blobs, "attach_asset_versions", { items: [{ assetId: "spin", scene: SAMPLE_SCENE }, { assetId: "spin", text: "{" }] }, f);
    const m = JSON.parse(many.text);
    expect(m).toMatchObject({ added: 1, failed: 1 });
    expect(slotAsset(e.getState().project).versions).toHaveLength(4);
  });

  it("import_storyboard stores inline scenes as versions in the same undo step, and skips unchanged ones", async () => {
    const e = new Engine(createProject("m")), blobs = memBlobs();
    const withScene = { ...DOC, assets: [{ ...DOC.assets[0], scene: SAMPLE_SCENE }] };
    const r = await runImportStoryboard(e, { json: withScene }, {}, blobs);
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ mode: "created", scenesStored: ["spin"] });
    const a = slotAsset(e.getState().project);
    expect(a).toMatchObject({ kind: "scene" });
    expect(a.versions).toHaveLength(1);
    expect(parseScene(await readBlob((await blobs.get(a.versions[0].media.blobKey))!)).doc!.objects).toHaveLength(SAMPLE_SCENE.objects.length);
    // Re-importing the same board adds no version.
    const again = await runImportStoryboard(e, { json: withScene, replace: true }, {}, blobs);
    expect(JSON.parse(again.text)).toMatchObject({ mode: "replaced", scenesUnchanged: ["spin"] });
    expect(slotAsset(e.getState().project).versions).toHaveLength(1);
    // A changed scene becomes a second version; one undo removes the import and the version.
    const changed = { ...withScene, assets: [{ ...withScene.assets[0], scene: { ...SAMPLE_SCENE, durationSec: 9 } }] };
    const before = e.getState().project;
    const third = await runImportStoryboard(e, { json: changed, replace: true }, {}, blobs);
    expect(JSON.parse(third.text)).toMatchObject({ scenesStored: ["spin"] });
    expect(slotAsset(e.getState().project).versions).toHaveLength(2);
    e.undo();
    expect(e.getState().project).toEqual(before);
    // Without the media store an inline scene can't be stored, so nothing changes.
    const e2 = new Engine(createProject("m"));
    const no = await runImportStoryboard(e2, { json: withScene });
    expect(no.ok).toBe(false);
    expect(e2.getState().project.storyboard).toBeUndefined();
    // An invalid inline scene is a storyboard error.
    const badDoc = { ...DOC, assets: [{ ...DOC.assets[0], scene: { objects: [{ id: "a", shape: "star" }] } }] };
    const bad = await runImportStoryboard(e2, { json: badDoc }, {}, blobs);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/assets\[0\]\.scene\.objects\[0\]/);
  });
});
