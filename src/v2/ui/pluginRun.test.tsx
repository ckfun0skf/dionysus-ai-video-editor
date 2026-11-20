// @vitest-environment jsdom
/**
 * P85 (Phase 3 step 3.3): enabled plugins. Trust per project, per package hash, per device enables a registered
 * plugin; enabled clips use the sandboxed renderer (frames, "Plugin stopped" slate, black in export), get a Player
 * worker that is cleaned up, drop out of the export warning, report stopped frames in the export dialog, and show
 * "Enabled" in the card and Plugin tab. The development hook (`__dionysusDev`) is the only way to enable one before
 * the trust screens (P86).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, TEXT_SOURCE, type Placement, type Project, type Track } from "../domain";
import { CLIP_TYPES, isPluginEnabled, setPluginIssues, setPluginsEnabled } from "../clipTypes";
import { clipRendererFor, type ClipDrawHost, type PluginFrames } from "../render/clipRenderers";
import { PLUGIN_RENDERER } from "../render/pluginClip";
import { PLUGIN_SLATE_RENDERER } from "../render/pluginSlate";
import { unknownTypeClips } from "../render/export/plan";
import { frameWarnings } from "../render/export/encode";
import { Player } from "../render/player";
import type { PluginClipHost } from "../render/pluginHost";
import { mockCtx } from "../presets/__testutils__/mockCanvas";
import { BlobSink, ZipWriter, addPluginToProject, createMemoryPluginLibrary, createMemoryStorage, readPluginZip, syncProjectPlugins } from "../persistence";
import { clipUi } from "./clipTypeUi";
import { PluginClipPanel } from "./PluginClipPanel";
import { setDevPluginTrust, syncPlugins, devicePluginLibrary } from "./pluginRuntime";

const S = 120_000;
const DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
async function zip(manifest: string | Buffer = readFileSync(resolve(DIR, "manifest.json"))): Promise<Blob> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  await z.addBytes("manifest.json", typeof manifest === "string" ? new TextEncoder().encode(manifest) : manifest);
  await z.addBytes("render.js", readFileSync(resolve(DIR, "render.js")));
  await z.finish();
  return sink.blob();
}
const clip = (id = "pc"): Placement => ({ id, startTicks: 0, durationTicks: 4 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "x-dionysus-stripes" as Placement["clipType"], plugin: { data: { params: { title: "Hi" } }, v: "1.0.0" } });
async function setup() {
  const storage = createMemoryStorage();
  const pkg = await readPluginZip(await zip());
  const project = await addPluginToProject(createProject("Run"), pkg, storage.blobs);
  project.compositions[project.rootCompositionId].tracks.find((t) => t.kind === "video")!.placements.push(clip());
  return { storage, project, hash: pkg.hash };
}

class FakeBitmap { constructor(public width: number, public height: number) {} close() {} }
function drawHost(pl: Placement, offline: boolean, plugins?: PluginFrames) {
  const { ctx, calls } = mockCtx(640, 360);
  const texts: string[] = [];
  const g = new Proxy(ctx, { get: (o, k) => (k === "fillText" ? (t: string) => { texts.push(t); } : (o as never)[k]) });
  const blits: number[][] = [];
  const host = {
    g, width: 640, height: 360, time: 0, offline, track: { id: "t", kind: "video", name: "t", placements: [pl] } as Track, placement: pl, sourceTicks: 1.5 * S, mix: undefined, tfx: undefined,
    setBox: () => undefined, paint: (_b: unknown, fn: (x: CanvasRenderingContext2D) => void) => fn(g), blit: (_g: unknown, w: number, h: number) => { blits.push([w, h]); }, plugins,
  } as unknown as ClipDrawHost;
  return { host, calls, texts, blits };
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ImageBitmap?: unknown }).ImageBitmap = FakeBitmap;
});
afterEach(() => { CLIP_TYPES.setRuntime([]); setPluginIssues([]); setPluginsEnabled([]); document.body.innerHTML = ""; });

describe("enabled plugins (P85)", () => {
  it("enables a plugin only with trust for this project and this package hash", async () => {
    const { storage, project, hash } = await setup();
    const lib = createMemoryPluginLibrary();
    await syncProjectPlugins(project, storage.blobs, {});
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
    await syncProjectPlugins(project, storage.blobs, { trusted: (h) => lib.isTrusted(project.id, h) });
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
    await lib.setTrusted("another-project", hash, true);
    await syncProjectPlugins(project, storage.blobs, { trusted: (h) => lib.isTrusted(project.id, h) });
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
    await lib.setTrusted(project.id, hash, true);
    const seen = vi.fn();
    const off = CLIP_TYPES.subscribe(seen);
    await syncProjectPlugins(project, storage.blobs, { trusted: (h) => lib.isTrusted(project.id, h) });
    off();
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(true);
    expect(seen).toHaveBeenCalled(); // the change signal redraws the editor
    expect(clipRendererFor(clip())).toBe(PLUGIN_RENDERER);
    expect(unknownTypeClips(project)).toEqual([]); // no export warning for an enabled plugin
    // a changed package (new hash, same id) is not covered by the old trust
    setPluginsEnabled([["x-dionysus-stripes", "sha256-other"]]);
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
    expect(clipRendererFor(clip())).toBe(PLUGIN_SLATE_RENDERER);
    expect(unknownTypeClips(project).map((p) => p.id)).toEqual(["pc"]);
  });

  it("draws the worker's frame, the stopped slate in preview and black in export", async () => {
    const { storage, project, hash } = await setup();
    await syncProjectPlugins(project, storage.blobs, { trusted: async (h) => h === hash });
    const fake = { frame: new FakeBitmap(640, 360), stopped: false, issue: undefined, request: vi.fn() } as unknown as PluginClipHost;
    const plugins: PluginFrames = { host: vi.fn(() => fake), keyOf: () => undefined };
    const a = drawHost(clip(), false, plugins);
    PLUGIN_RENDERER.draw!(a.host);
    expect(plugins.host).toHaveBeenCalledWith("pc", "x-dionysus-stripes", 640, 360);
    expect(fake.request).toHaveBeenCalledWith(1.5, 4, expect.objectContaining({ title: "Hi", count: 8 }));
    expect(a.blits).toEqual([[640, 360]]);
    (fake as { stopped: boolean }).stopped = true;
    const b = drawHost(clip(), false, plugins);
    PLUGIN_RENDERER.draw!(b.host);
    expect(b.texts).toEqual(["Plugin “Moving stripes” stopped", "IT HUNG OR FAILED"]);
    expect(b.blits).toEqual([]);
    const c = drawHost(clip(), true, plugins);
    PLUGIN_RENDERER.draw!(c.host);
    expect(c.texts).toEqual([]);
    expect(c.calls).toContain("fillRect");
    // no Player service (e.g. a thumbnail): nothing drawn, nothing thrown
    const d = drawHost(clip(), false, undefined);
    PLUGIN_RENDERER.draw!(d.host);
    expect(d.calls).toEqual([]);
  });

  it("the Player starts one sandboxed worker per plugin clip and removes it with the clip or the trust", async () => {
    const { storage, project, hash } = await setup();
    await syncProjectPlugins(project, storage.blobs, { trusted: async (h) => h === hash });
    const { ctx } = mockCtx(320, 180);
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    vi.spyOn(canvas, "getContext").mockReturnValue(ctx as never);
    const player = new Player(project, storage.blobs, { kind: "wall", now: () => 0 } as never);
    player.canvas = canvas;
    player.offline = true; // export mode: no last-good-frame copy (jsdom has no real canvas)
    player.draw();
    const frames = () => document.querySelectorAll("iframe[sandbox='allow-scripts']");
    expect(frames()).toHaveLength(1);
    expect((frames()[0] as HTMLIFrameElement).srcdoc).toContain("dionysus-plugin");
    player.draw();
    expect(frames()).toHaveLength(1); // reused
    setPluginsEnabled([]);
    player.draw();
    expect(frames()).toHaveLength(0);
    setPluginsEnabled([["x-dionysus-stripes", hash]]);
    player.draw();
    expect(frames()).toHaveLength(1);
    const without: Project = structuredClone(project);
    without.compositions[without.rootCompositionId].tracks.forEach((t) => { t.placements = []; });
    player.project = without;
    player.draw();
    expect(frames()).toHaveLength(0);
    player.project = project;
    player.draw();
    player.dispose();
    expect(frames()).toHaveLength(0);
  });

  it("names a stopped plugin in the export warnings", async () => {
    const { storage, project } = await setup();
    await syncProjectPlugins(project, storage.blobs, {});
    const w = frameWarnings(project, [
      { placementId: "pc", t: S, issue: "stopped", detail: "A frame took longer than 4 s twice in a row." },
      { placementId: "pc", t: 2 * S, issue: "stopped" },
    ]);
    expect(w).toEqual(["Plugin “Moving stripes”: the plugin stopped (a frame took longer than 4 s twice in a row), so 2 frames are black, first at 1.00 s."]);
    expect(frameWarnings(project, [{ placementId: "pc", t: S, issue: "timeout" }])).toEqual(["Plugin “Moving stripes”: 1 frame timed out (4 s), first at 1.00 s. Those frames reuse the last good image (or are blank)."]);
  });

  it("shows Enabled on the card and in the Plugin tab", async () => {
    const { storage, project, hash } = await setup();
    await syncProjectPlugins(project, storage.blobs, { trusted: async (h) => h === hash });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<>{clipUi(clip()).body!(clip())}<PluginClipPanel project={project} placement={clip()} /></>); });
    expect(el.querySelector(".v2-clip-name")!.textContent).toContain("Moving stripes");
    expect(el.querySelector(".v2-clip-name")!.textContent).not.toContain("Not enabled");
    expect(el.querySelector('[role="status"]')!.textContent).toMatch(/^Enabled Allowed in this project on this device/);
    expect(el.querySelector(".v2-ph-state.is-on")).toBeTruthy();
    expect(clipUi(clip()).kindClass).toBe("is-plugin is-on");
    setPluginsEnabled([]);
    expect(clipUi(clip()).kindClass).toBe("is-plugin");
    await act(async () => { root.unmount(); });
  });

  it("enables a plugin through the development hook only (records trust for the open project and hash)", async () => {
    const { storage, project, hash } = await setup();
    expect(import.meta.env.DEV).toBe(true);
    const dev = (window as unknown as { __dionysusDev?: { trustPlugin(id: string): Promise<boolean>; untrustPlugin(id: string): Promise<boolean> } }).__dionysusDev;
    expect(Object.keys(dev ?? {}).sort()).toEqual(["trustPlugin", "untrustPlugin"]);
    expect(await setDevPluginTrust("x-dionysus-stripes", true)).toBe(false); // nothing synced yet
    await syncPlugins(project, storage.blobs);
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
    expect(await dev!.trustPlugin("x-dionysus-stripes")).toBe(true);
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(true);
    expect(await devicePluginLibrary().isTrusted(project.id, hash)).toBe(true);
    expect(await dev!.trustPlugin("x-not-locked")).toBe(false);
    expect(await dev!.untrustPlugin("x-dionysus-stripes")).toBe(true);
    expect(isPluginEnabled("x-dionysus-stripes")).toBe(false);
  });
});
