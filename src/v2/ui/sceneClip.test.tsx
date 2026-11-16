// @vitest-environment jsdom
/**
 * P74 (Phase 2 step 2.1 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): the `scene` clip type. Its asset version holds a
 * `dionysus.scene/1` document; the renderer sends the pure `stateAt` result for the clip's time to the sandboxed scene
 * page, so preview and export draw the same frame. Older builds see it as an unknown type (P73).
 */
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createProject, SAMPLE_SCENE, stateAt, validateComposition, type Placement, type Project, type SceneDoc, type Track } from "../domain";
import { clipTypeOf, isKnownClipType, placeholderAccepts } from "../clipTypes";
import { clipRendererFor, type ClipFrameHost } from "../render/clipRenderers";
import { SCENE_RUNTIME_JS, scenePage } from "../render/scenePage";
import { selectedLibraries } from "../render/htmlLibs";
import { withRuntime } from "../render/htmlClip";
import { audioPlan } from "../render/export/plan";
import { createIndexedDbStorage } from "../persistence/indexeddb";
import { Engine, cmd } from "../engine";
import { clipUi } from "./clipTypeUi";
import { needsThumb } from "./TimelineClip";
import { ScenePanel } from "./ScenePanel";
import { sceneAsset } from "./sceneAsset";

const S = 120_000;
// jsdom's Blob has no text(): keep the text next to it.
const readText = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const memBlobs = () => {
  const m = new Map<string, Blob & { text(): Promise<string> }>();
  return { m, put: async (k: string, b: Blob) => { const t = await readText(b); m.set(k, Object.assign(b, { text: async () => t })); }, get: async (k: string) => m.get(k), delete: async () => undefined, keys: async () => [...m.keys()] };
};

async function sceneProject(doc: SceneDoc = SAMPLE_SCENE) {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, doc);
  const e = new Engine(createProject("scene"));
  expect(e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")])).toBe(true);
  const p = e.getState().project;
  const pl = p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === "sc")!;
  return { e, p, pl, asset, blobs };
}

/** Runs the scene renderer once with a fake media host; returns what it asked for and drew. */
function runFrame(pl: Placement, p: Project, doc: SceneDoc | null | undefined, offline = false, sourceSec = 1.5) {
  const log: string[] = [];
  const g = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, k) => (k === "measureText" ? (t: string) => ({ width: String(t).length * 6 }) : typeof k === "string" ? (...a: unknown[]) => { log.push(`${k}(${a.map((x) => JSON.stringify(x)).join(",")})`); } : undefined),
    set: (_t, k, v) => { log.push(`${String(k)}=${JSON.stringify(v)}`); return true; },
  });
  const requests: { t: number; dur?: number; extra?: () => Promise<{ data: Record<string, unknown> }> }[] = [];
  const host = { frame: undefined, issue: undefined, request: (t: number, dur?: number, extra?: () => Promise<{ data: Record<string, unknown> }>) => requests.push({ t, dur, extra }) };
  const sceneHost = vi.fn(() => host);
  const live = new Set<string>();
  const version = p.assets[pl.source.assetId].versions[0];
  const h = {
    g, canvas: { width: 640, height: 360 }, time: pl.startTicks + sourceSec * S, offline, track: { id: "t", kind: "video", name: "t", placements: [pl] } as Track,
    placement: pl, sourceTicks: sourceSec * S, mix: undefined, tfx: undefined, setBox: () => undefined, paint: () => undefined, blit: () => undefined,
    version, frame: { live, loads: new Map(), stalled: false, missing: false, holding: false, run: false },
    media: { sceneDoc: () => doc, sceneHost, keyOf: () => undefined },
  } as unknown as ClipFrameHost;
  clipRendererFor(pl)!.frame!(h);
  return { log, requests, sceneHost, live };
}

describe("P74 scene clip type", () => {
  it("is a registered video-track type that reads an asset version, has no sound, source time or thumbnail", async () => {
    const { p, pl } = await sceneProject();
    expect(isKnownClipType("scene")).toBe(true);
    expect(clipTypeOf(pl)).toMatchObject({ id: "scene", trackKind: "video", caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: true, thumb: false, asset: "media" } });
    expect(pl).toMatchObject({ clipType: "scene", startTicks: 0, durationTicks: 5 * S, sourceInTicks: 0 });
    expect(pl.volume).toBeUndefined();
    expect(needsThumb(pl)).toBe(false);
    expect(Object.values(p.compositions).flatMap(validateComposition)).toEqual([]);
    expect(audioPlan(p)).toEqual([]);
    // On an audio track it is a validation error like any video-track type.
    const bad: Project = JSON.parse(JSON.stringify(p));
    bad.compositions[bad.rootCompositionId].tracks.find((t) => t.kind === "audio")!.placements.push({ ...pl, id: "sc2" });
    expect(Object.values(bad.compositions).flatMap(validateComposition).join()).toMatch(/sc2/);
  });

  it("stores the document as a JSON blob and keeps it through save and load", async () => {
    const { p, asset, blobs } = await sceneProject();
    const v = asset.versions[0];
    expect(v.media.mime).toBe("application/vnd.dionysus.scene+json");
    expect(JSON.parse(await blobs.m.get(v.media.blobKey)!.text())).toEqual(SAMPLE_SCENE);
    const store = createIndexedDbStorage(`p74-${Math.random()}`);
    await store.projects.save(p);
    const loaded = (await store.projects.load(p.id))!;
    expect(loaded.assets[asset.id]).toEqual(p.assets[asset.id]);
    expect(loaded.compositions).toEqual(p.compositions);
  });

  it("renders through the sandboxed scene page with the state at the clip's time", async () => {
    const { p, pl } = await sceneProject();
    const { requests, sceneHost, live } = runFrame(pl, p, SAMPLE_SCENE, false, 1.5);
    expect(sceneHost).toHaveBeenCalledWith("sc", p.assets[pl.source.assetId].versions[0].media.blobKey, 640, 360);
    expect(live.has("sc")).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].t).toBe(1.5);
    expect(requests[0].dur).toBe(5);
    expect((await requests[0].extra!()).data).toEqual({ inputs: { scene: stateAt(SAMPLE_SCENE, 1.5) } });
    // Preview and export ask for the same thing.
    const exp = runFrame(pl, p, SAMPLE_SCENE, true, 1.5);
    expect((await exp.requests[0].extra!()).data).toEqual((await requests[0].extra!()).data);
  });

  it("waits while the document loads; an unreadable one shows a slate in preview and black in export", async () => {
    const { p, pl } = await sceneProject();
    const loading = runFrame(pl, p, undefined);
    expect([loading.sceneHost.mock.calls.length, loading.requests.length]).toEqual([1, 0]);
    const broken = runFrame(pl, p, null);
    expect(broken.sceneHost).not.toHaveBeenCalled();
    expect(broken.log.filter((l) => l.startsWith("fillText(")).map((l) => l.split(",")[0])).toEqual(['fillText("This 3D scene can\'t be read"', 'fillText("CHECK THE SCENE JSON"']);
    expect(runFrame(pl, p, null, true).log).toEqual(["save()", "setTransform(1,0,0,1,0,0)", 'fillStyle="#000"', "fillRect(0,0,640,360)", "restore()"]);
  });

  it("the scene page embeds the document safely and uses only the pinned three.js under the clip CSP", () => {
    const page = scenePage({ ...SAMPLE_SCENE, name: "</script><script>alert(1)</script>" });
    expect(page).not.toContain("</script><script>alert(1)");
    expect(page).toContain("\\u003c/script>");
    expect(selectedLibraries(page).map((l) => l.id)).toEqual(["three"]);
    const doc = withRuntime(page, () => "https://example.test/three.js");
    expect(doc).toMatch(/Content-Security-Policy[^>]*default-src 'none'/);
    expect(doc).toContain('"three":"https://example.test/three.js"');
    expect(doc).toContain("ctx.inputs && ctx.inputs.scene");
    // The page never keeps its own clock: no timers, random numbers or animation loops (the frame is a function of the sent state).
    expect(SCENE_RUNTIME_JS).not.toMatch(/Math\.random|performance\.now|Date\.now|requestAnimationFrame|setTimeout|setInterval/);
  });

  it("the timeline and inspector entry: cube icon, Scene tab first, no speed or volume", async () => {
    const { pl } = await sceneProject();
    const u = clipUi(pl);
    expect(u).toMatchObject({ id: "scene", icon: "scene", kindClass: "is-scene", inspectorIcon: "scene", speed: false, volume: false, assetThumb: "none" });
    expect(u.inspectorTabs).toEqual(["scene", "basic", "chroma", "transition"]);
    // P75: Scene first on the phone toolbar, so the panel is reachable at 390 px.
    expect(u.toolbarMain).toEqual(["scene", "adjust"]);
    expect(u.toolbar).toEqual(["scene", "adjust", "link", "to-main"]);
  });

  it("a scene placeholder draws the host slate and Fill offers only scenes", () => {
    const ph: Placement = { id: "ph", startTicks: 0, durationTicks: S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "", versionId: "" }, clipType: "scene", placeholder: { label: "Shot 3" } };
    expect(clipTypeOf(ph).id).toBe("placeholder");
    expect(clipRendererFor(ph)?.id).toBe("placeholder");
    const ok = placeholderAccepts("scene");
    expect((["video", "image", "audio", "html", "scene"] as const).filter(ok)).toEqual(["scene"]);
  });

  it("the Scene tab lists objects, events and problems (read-only)", async () => {
    const broken: SceneDoc = { ...SAMPLE_SCENE, events: [...SAMPLE_SCENE.events!, { at: 1, obj: "ghost", call: "opacity", args: { value: 0 } }] };
    const { p, pl, blobs } = await sceneProject(broken);
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<ScenePanel project={p} placement={pl} blobs={blobs as never} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const panel = el.querySelector('[data-testid="scene-panel"]')!;
    expect(panel).toBeTruthy();
    expect([...panel.querySelectorAll('[aria-label="Scene objects"] code')].map((c) => c.textContent)).toEqual(["floor", "ball", "cube", "sign"]);
    expect([...panel.querySelectorAll('[aria-label="Scene events"] li')].map((li) => li.textContent)).toContain("1.00s ghost.opacity");
    expect(panel.querySelector('[aria-label="Scene problems"]')!.textContent).toMatch(/events\[6\]\.obj.*no object "ghost"/);
    expect(panel.querySelector("input, textarea, select")).toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it("Add 3D scene is one undo step", async () => {
    const { e } = await sceneProject();
    expect(e.getState().project.compositions[e.getState().project.rootCompositionId].tracks.flatMap((t) => t.placements)).toHaveLength(1);
    e.undo();
    const p = e.getState().project;
    expect(p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements)).toHaveLength(0);
    expect(Object.keys(p.assets)).toHaveLength(0);
  });
});
