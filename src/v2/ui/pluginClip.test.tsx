// @vitest-environment jsdom
/**
 * P84 (Phase 3 step 3.2): a project's plugin clips in the editor before plugins can run: registered plugin types show
 * by name with "Not enabled" (card, slate, inspector Plugin tab, export warning); locked plugins that can't load and
 * plugin ids the project doesn't lock keep the unknown-type path with a plugin-specific message.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, TEXT_SOURCE, type Placement, type Project, type Track } from "../domain";
import { CLIP_TYPES, setPluginIssues } from "../clipTypes";
import { clipRendererFor, type ClipDrawHost } from "../render/clipRenderers";
import { exportUnknownTypeWarning, unknownTypeClips } from "../render/export/plan";
import { BlobSink, ZipWriter, addPluginToProject, createMemoryStorage, pluginBlobKey, readPluginZip, syncProjectPlugins } from "../persistence";
import { clipUi, PLUGIN_CLIP_UI, UNKNOWN_CLIP_UI } from "./clipTypeUi";
import { V2App } from "./V2App";

const S = 120_000;
const DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
async function sampleZip(): Promise<Blob> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  await z.addBytes("manifest.json", readFileSync(resolve(DIR, "manifest.json")));
  await z.addBytes("render.js", readFileSync(resolve(DIR, "render.js")));
  await z.finish();
  return sink.blob();
}
const clip = (id: string, clipType: string): Placement => ({ id, startTicks: 0, durationTicks: 4 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: clipType as Placement["clipType"], plugin: { data: { params: { title: "Hello", count: 12 } }, v: "1.0.0" } });

async function pluginProject(storage = createMemoryStorage()): Promise<{ storage: ReturnType<typeof createMemoryStorage>; project: Project; hash: string }> {
  const pkg = await readPluginZip(await sampleZip());
  const project = await addPluginToProject(createProject("Plugins"), pkg, storage.blobs);
  project.compositions[project.rootCompositionId].tracks.find((t) => t.kind === "video")!.placements.push(clip("pc", "x-dionysus-stripes"), { ...clip("lost", "x-acme-lost"), startTicks: 5 * S });
  return { storage, project, hash: pkg.hash };
}

function draw(pl: Placement, offline: boolean): string[] {
  const log: string[] = [];
  const g = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, k) => (k === "measureText" ? (t: string) => ({ width: String(t).length * 6 }) : typeof k === "string" ? (...a: unknown[]) => { log.push(`${k}(${a.map((x) => JSON.stringify(x)).join(",")})`); } : undefined),
    set: (_t, k, v) => { log.push(`${String(k)}=${JSON.stringify(v)}`); return true; },
  });
  const host = { g, width: 640, height: 360, time: 0, offline, track: { id: "t", kind: "video", name: "t", placements: [pl] } as Track, placement: pl, sourceTicks: 0, mix: undefined, tfx: undefined, setBox: () => undefined, paint: (_b: unknown, fn: (x: CanvasRenderingContext2D) => void) => fn(g), blit: () => undefined } as unknown as ClipDrawHost;
  clipRendererFor(pl)!.draw!(host);
  return log;
}
const texts = (log: string[]) => log.filter((l) => l.startsWith("fillText(")).map((l) => JSON.parse(l.slice(9).split(",")[0]));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  document.body.innerHTML = "";
  CLIP_TYPES.setRuntime([]); setPluginIssues([]);
});

describe("plugin clips before plugins run (P84)", () => {
  it("draws the not-enabled slate (black in export); a missing or unlocked plugin gets a plugin-specific unknown slate", async () => {
    const { storage, project, hash } = await pluginProject();
    await syncProjectPlugins(project, storage.blobs);
    expect(clipRendererFor(clip("pc", "x-dionysus-stripes"))?.id).toBe("plugin");
    expect(texts(draw(clip("pc", "x-dionysus-stripes"), false))).toEqual(["Plugin “Moving stripes”", "NOT ENABLED"]);
    expect(texts(draw(clip("pc", "x-dionysus-stripes"), true))).toEqual([]);
    expect(texts(draw(clip("lost", "x-acme-lost"), false))).toEqual(["Plugin “x-acme-lost” is not installed", "NOT IN THIS PROJECT"]);
    await storage.blobs.delete(pluginBlobKey(hash));
    await syncProjectPlugins(project, storage.blobs);
    expect(clipRendererFor(clip("pc", "x-dionysus-stripes"))?.id).toBe("unknown");
    expect(texts(draw(clip("pc", "x-dionysus-stripes"), false))).toEqual(["Plugin “Moving stripes” is missing", "PACKAGE NOT FOUND"]);
    expect(texts(draw(clip("u", "scene3d"), false))).toEqual(["Unknown clip type “scene3d”", "NEEDS A NEWER VERSION"]);
  });

  it("uses the plugin card UI and names plugins in the export warning", async () => {
    const { storage, project } = await pluginProject();
    await syncProjectPlugins(project, storage.blobs);
    const u = clipUi(clip("pc", "x-dionysus-stripes"));
    expect(u).toBe(PLUGIN_CLIP_UI);
    expect(u.name(clip("pc", "x-dionysus-stripes"), project)).toBe("Moving stripes");
    expect(u.inspectorTabs).toEqual(["plugin", "transition"]);
    expect([u.speed, u.volume, u.toolbar, u.toolbarMain]).toEqual([false, false, ["plugin-params", "plugin", "link", "to-main"], ["plugin-params", "plugin"]]);
    expect(clipUi(clip("lost", "x-acme-lost"))).toBe(UNKNOWN_CLIP_UI);
    expect(UNKNOWN_CLIP_UI.name(clip("lost", "x-acme-lost"), project)).toBe("Plugin “x-acme-lost” is not installed");
    expect(unknownTypeClips(project).map((p) => p.id)).toEqual(["pc", "lost"]);
    expect(exportUnknownTypeWarning(project)).toEqual({
      title: "2 clips use plugins that can't play here",
      body: "They export as black frames: plugin “Moving stripes”, “x-acme-lost”. The plugins aren't enabled or available in this project, so their settings are kept but not drawn. Export anyway, or remove those clips first.",
    });
  });

  it("opens a project with a plugin: the timeline card and the inspector's Plugin tab show it by name", async () => {
    const { storage, project } = await pluginProject();
    await storage.projects.save(project);
    storage.lastProjectId.set(project.id);
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { const r = createRoot(el); roots.push(r); r.render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const card = el.querySelector('[data-placement-id="pc"]') as HTMLElement;
    expect(card.className).toContain("is-plugin");
    expect(card.textContent).toContain("Moving stripes");
    expect(card.textContent).toContain("Not enabled");
    expect(el.querySelector('[data-placement-id="lost"]')!.className).toContain("is-unknown");
    await act(async () => { card.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    const panel = el.querySelector('[data-testid="plugin-clip"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain("Not enabled");
    expect(panel.textContent).toContain("1.0.0");
    expect(panel.textContent).toContain("Dionysus samples");
    expect(panel.textContent).toContain("unverified");
    // P87: the settings are an editable form (values in the controls), grouped as the manifest's editor says.
    expect((panel.querySelector('input[aria-label="Moving stripes Title"]') as HTMLInputElement).value).toBe("Hello");
    expect(Array.from(panel.querySelectorAll("h4")).map((h) => h.textContent?.trim())).toEqual(["Moving stripes 1.0.0", "Stripes", "Motion", "Title", "About this plugin"]);
  });
});
