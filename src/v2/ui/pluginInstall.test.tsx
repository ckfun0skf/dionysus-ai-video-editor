// @vitest-environment jsdom
/**
 * P86 (Phase 3 step 3.4): installing plugins and managing a project's plugins. The project commands (lock, add a clip,
 * remove with or without its clips, one undo step each), install from the consent dialog (device library, project blob,
 * trust, lock and first clip as one step), the Plugins list rows and the review banner's list, the inspector's Stopped /
 * Retry and Not enabled / Review states, and the Plugins tabs. docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type Placement, type Project } from "../domain";
import { CLIP_TYPES, isPluginEnabled, setPluginIssues, setPluginsEnabled } from "../clipTypes";
import { mainTrack } from "../domain/ops";
import { Engine, cmd } from "../engine";
import { BlobSink, ZipWriter, createMemoryStorage, pluginLockOf, readPluginZip, type PluginPackage } from "../persistence";
import { markPluginStopped, pluginStatus, retryPluginClip } from "../render/pluginStatus";
import { BROWSER_TABS } from "./desktop/AssetBrowser";
import { MediaPicker } from "./MediaPicker";
import { PluginClipPanel } from "./PluginClipPanel";
import { addPluginClipAt, installPlugin, pluginFacts, pluginRows, pluginSampleUrl, pluginsToReview, refreshPluginLibrary, removePluginFromProject, shortPluginHash } from "./pluginManager";
import { devicePluginLibrary, syncPlugins } from "./pluginRuntime";

const S = 120_000;
const ID = "x-dionysus-stripes";
const DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
const manifest = () => JSON.parse(readFileSync(resolve(DIR, "manifest.json"), "utf8")) as Record<string, unknown>;
async function pkgOf(over: Record<string, unknown> = {}): Promise<PluginPackage> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  await z.addBytes("manifest.json", new TextEncoder().encode(JSON.stringify({ ...manifest(), ...over })));
  await z.addBytes("render.js", readFileSync(resolve(DIR, "render.js")));
  await z.finish();
  return readPluginZip(sink.blob());
}
const root = (p: Project) => p.compositions[p.rootCompositionId];
const clipsOf = (p: Project) => root(p).tracks.flatMap((t) => t.placements.map((x) => ({ id: x.id, track: t.id, start: x.startTicks, type: x.clipType })));
const pluginClips = (p: Project) => clipsOf(p).filter((c) => c.type === ID);
const mainId = (p: Project) => mainTrack(root(p))!.id;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  CLIP_TYPES.setRuntime([]); setPluginIssues([]); setPluginsEnabled([]);
});
function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  roots.push(r);
  act(() => r.render(node));
  return host;
}

describe("project plugin commands (P86)", () => {
  it("locks a plugin and adds clips on an overlay layer with room, the main track or a given track", async () => {
    const pkg = await pkgOf();
    const e = new Engine(createProject("Cmd"));
    expect(e.dispatch(cmd.lockPlugin(ID, pluginLockOf(pkg)), "lock")).toBe(true);
    expect(e.getState().project.plugins?.[ID]).toMatchObject({ hash: pkg.hash, version: "1.0.0" });
    e.dispatch(cmd.addPluginClip(0, ID, "1.0.0", 5 * S, "overlay", "a"), "a");
    e.dispatch(cmd.addPluginClip(2 * S, ID, "1.0.0", 5 * S, "overlay", "b"), "b"); // overlaps a: a new layer
    e.dispatch(cmd.addPluginClip(10 * S, ID, "1.0.0", 5 * S, "overlay", "c"), "c");
    e.dispatch(cmd.addPluginClip(0, ID, "1.0.0", 5 * S, "main", "m"), "m");
    const p = e.getState().project;
    const by = Object.fromEntries(clipsOf(p).map((c) => [c.id, c]));
    expect(by.a.track).not.toBe(mainId(p));
    expect(by.b.track).not.toBe(by.a.track);
    expect([by.a.track, by.b.track]).toContain(by.c.track); // room on an existing layer: no new one
    expect(root(p).tracks.filter((t) => t.kind === "video")).toHaveLength(3);
    expect(by.m.track).toBe(mainId(p));
    const a = root(p).tracks.flatMap((t) => t.placements).find((x) => x.id === "a") as Placement;
    expect(a).toMatchObject({ clipType: ID, durationTicks: 5 * S, plugin: { data: { params: {} }, v: "1.0.0" } });
    // a given track with room is used; a busy one falls back to an overlay layer
    e.dispatch(cmd.addPluginClip(20 * S, ID, "1.0.0", S, { trackId: by.b.track }, "t1"), "t1");
    e.dispatch(cmd.addPluginClip(2 * S, ID, "1.0.0", S, { trackId: by.b.track }, "t2"), "t2");
    const after = Object.fromEntries(clipsOf(e.getState().project).map((c) => [c.id, c]));
    expect(after.t1.track).toBe(by.b.track);
    expect(after.t2.track).not.toBe(by.b.track);
    expect(() => cmd.addPluginClip(0, "text" as `x-${string}`, "1", S).apply(createProject("x"))).toThrow(/not a plugin/);
  });

  it("removes a plugin keeping its clips, or with them, as one undo step", async () => {
    const pkg = await pkgOf();
    const e = new Engine(createProject("Remove"));
    e.dispatch([cmd.lockPlugin(ID, pluginLockOf(pkg)), cmd.addPluginClip(0, ID, "1.0.0", 5 * S, "overlay", "a"), cmd.addPluginClip(0, ID, "1.0.0", 5 * S, "main", "m")], "add");
    expect(removePluginFromProject(e, ID, false)).toBe(true);
    expect(e.getState().project.plugins?.[ID]).toBeUndefined();
    expect(pluginClips(e.getState().project).map((c) => c.id).sort()).toEqual(["a", "m"]); // clips keep their settings
    e.undo();
    expect(removePluginFromProject(e, ID, true)).toBe(true);
    expect(e.getState().project.plugins?.[ID]).toBeUndefined();
    expect(pluginClips(e.getState().project)).toEqual([]);
    e.undo();
    expect(e.getState().project.plugins?.[ID]?.hash).toBe(pkg.hash);
    expect(pluginClips(e.getState().project)).toHaveLength(2);
    expect(removePluginFromProject(new Engine(createProject("none")), ID, true)).toBe(false); // not in the project
  });
});

describe("install and the Plugins list (P86)", () => {
  it("installs: device library, project blob, trust, lock and a first clip as one undo step", async () => {
    const pkg = await pkgOf();
    const { blobs } = createMemoryStorage();
    const e = new Engine(createProject("Install"));
    const { clipId: id } = await installPlugin({ engine: e, blobs }, pkg, "https://example.com/stripes/manifest.json", { at: S, id: "plc_first" });
    expect(id).toBe("plc_first");
    const p = e.getState().project;
    expect(p.plugins?.[ID]?.hash).toBe(pkg.hash);
    expect(await blobs.get(p.plugins![ID].blobKey)).toBeTruthy();
    expect(pluginClips(p)).toEqual([expect.objectContaining({ id: "plc_first", start: S })]);
    expect(await devicePluginLibrary().isTrusted(p.id, pkg.hash)).toBe(true);
    expect(isPluginEnabled(ID)).toBe(true);
    const lib = await refreshPluginLibrary();
    expect(lib.find((x) => x.hash === pkg.hash)).toMatchObject({ id: ID, source: "https://example.com/stripes/manifest.json", manifest: expect.objectContaining({ name: "Moving stripes" }) });
    expect(pluginRows(p, lib)).toEqual([expect.objectContaining({ id: ID, inProject: true, state: "enabled", clips: 1 })]);
    // an enabled plugin adds clips straight away
    expect(addPluginClipAt(e, ID, 10 * S)).toMatch(/^plc/);
    expect(pluginClips(e.getState().project)).toHaveLength(2);
    e.undo(); e.undo();
    expect(e.getState().project.plugins?.[ID]).toBeUndefined(); // lock and first clip went together
    expect(pluginClips(e.getState().project)).toEqual([]);
    // in another project the device library lists it, not allowed there
    const other = createProject("Other");
    expect(pluginRows(other, lib)).toEqual([expect.objectContaining({ id: ID, inProject: false, state: "device", clips: 0 })]);
  });

  it("lists plugins that aren't allowed on this device for the review banner, and refuses changed contents", async () => {
    const pkg = await pkgOf();
    const { blobs } = createMemoryStorage();
    const e = new Engine(createProject("Review"));
    await installPlugin({ engine: e, blobs }, pkg, "file");
    const p = e.getState().project;
    await devicePluginLibrary().setTrusted(p.id, pkg.hash, false);
    await syncPlugins(p, blobs);
    const rows = pluginRows(p, await refreshPluginLibrary());
    expect(rows[0]).toMatchObject({ state: "review" });
    expect(pluginsToReview(rows).map((r) => r.id)).toEqual([ID]);
    // Allow = install the same package again: trust comes back, nothing new to undo
    const undoBefore = e.getState().canUndo;
    await installPlugin({ engine: e, blobs }, pkg, "project");
    expect(isPluginEnabled(ID)).toBe(true);
    expect(e.getState().canUndo).toBe(undoBefore);
    expect(e.getState().project).toBe(p);
    // the same version with other contents is a conflict (another version is a switch, P87)
    const changed = await pkgOf({ description: "Changed without a new version number." });
    await expect(installPlugin({ engine: e, blobs }, changed, "file")).rejects.toThrow(/needs a new version number/);
  });

  it("states the consent facts plainly", async () => {
    const pkg = await pkgOf();
    const f = pluginFacts(pkg, "https://example.com/p/manifest.json");
    expect(f).toMatchObject({ name: "Moving stripes", version: "1.0.0", hash: pkg.hash, libs: [] });
    expect(f.params.length).toBeGreaterThan(3);
    expect(shortPluginHash(pkg.hash)).toHaveLength(12);
    expect(pluginSampleUrl("x-dionysus-stripes", "/app/", "https://h.test/app/editor?v2")).toBe("https://h.test/app/plugins/samples/x-dionysus-stripes/manifest.json");
  });
});

describe("inspector states and Plugins tabs (P86)", () => {
  it("shows Stopped with Retry for a stopped clip, Enabled after Retry, and Review for a plugin that isn't allowed", async () => {
    const pkg = await pkgOf();
    const { blobs } = createMemoryStorage();
    const e = new Engine(createProject("Panel"));
    await installPlugin({ engine: e, blobs }, pkg, "file", { at: 0, id: "pc" });
    const p = e.getState().project;
    const pl = root(p).tracks.flatMap((t) => t.placements).find((x) => x.id === "pc")!;
    const onRetry = vi.fn((id: string) => retryPluginClip(id));
    const onReview = vi.fn();
    const host = mount(<PluginClipPanel project={p} placement={pl} onRetry={onRetry} onReview={onReview} />);
    expect(host.querySelector(".v2-ph-state")?.textContent).toBe("Enabled");
    const gen = pluginStatus.generation("pc");
    act(() => markPluginStopped("pc", { clipType: ID, reason: "A frame took longer than 4 s twice in a row." }));
    expect(host.querySelector(".v2-ph-state")?.textContent).toBe("Stopped");
    expect(host.textContent).toContain("Last problem: A frame took longer than 4 s");
    act(() => (host.querySelector('[data-testid="plugin-retry"]') as HTMLButtonElement).click());
    expect(onRetry).toHaveBeenCalledWith("pc");
    expect(pluginStatus.generation("pc")).toBe(gen + 1);
    expect(pluginStatus.stopped("pc")).toBeUndefined();
    expect(host.querySelector(".v2-ph-state")?.textContent).toBe("Enabled");
    // not allowed on this device: Review and allow
    await devicePluginLibrary().setTrusted(p.id, pkg.hash, false);
    await act(() => syncPlugins(p, blobs));
    const again = mount(<PluginClipPanel project={p} placement={pl} onRetry={onRetry} onReview={onReview} />);
    expect(again.querySelector(".v2-ph-state")?.textContent).toBe("Not enabled");
    act(() => (again.querySelector('[data-testid="plugin-review"]') as HTMLButtonElement).click());
    expect(onReview).toHaveBeenCalledWith(ID);
  });

  it("shows a Plugins tab in Add media only when given, and in the desktop rail", () => {
    expect(BROWSER_TABS.map((t) => t.id)).toContain("plugins");
    const tabNames = (h: HTMLElement) => [...h.querySelectorAll('[role="tab"]')].map((b) => b.textContent?.trim());
    const without = mount(<MediaPicker title="Add media" onAdd={() => undefined} onClose={() => undefined} />);
    expect(tabNames(without)).not.toContain("Plugins");
    const done = vi.fn();
    const withTab = mount(<MediaPicker title="Add media" onAdd={() => undefined} onClose={done} initialTab="plugins" pluginsTab={(close) => <button data-testid="pt" onClick={close}>tile</button>} />);
    expect(tabNames(withTab)).toContain("Plugins");
    act(() => (withTab.querySelector('[data-testid="pt"]') as HTMLButtonElement).click());
    expect(done).toHaveBeenCalled();
  });
});
