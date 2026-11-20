// @vitest-environment jsdom
/**
 * P87 (Phase 3 step 3.5): editing a plugin clip and switching plugin versions. The settings form from the manifest's
 * editor groups (one undo step per committed edit, Reset), the timeline card's icon and title, and update / downgrade
 * with param migration (kept, defaults for new, dropped or clamped with a report), as one undo step. A higher `api`
 * says it needs a newer Dionysus. docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7, docs/v2/PLUGIN_PACKAGE.md §6.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, migratePluginParams, pluginClips, pluginSwitchSummary, switchPluginVersion, type HtmlClipParam, type Placement, type Project } from "../domain";
import { CLIP_TYPES, isPluginEnabled, pluginMetaOf, setPluginIssues, setPluginsEnabled, unknownSlateText } from "../clipTypes";
import { Engine, cmd } from "../engine";
import { BlobSink, ZipWriter, createMemoryStorage, pluginLockOf, readPluginZip, type PluginPackage } from "../persistence";
import { PluginClipPanel } from "./PluginClipPanel";
import { clipUi } from "./clipTypeUi";
import { installPlugin, pluginErrorText, pluginRows, pluginSwitchPreview, refreshPluginLibrary } from "./pluginManager";

const S = 120_000;
const ID = "x-dionysus-stripes";
const DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
const base = () => JSON.parse(readFileSync(resolve(DIR, "manifest.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function pkgOf(m: Record<string, unknown> = base()): Promise<PluginPackage> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  await z.addBytes("manifest.json", new TextEncoder().encode(JSON.stringify(m)));
  await z.addBytes("render.js", readFileSync(resolve(DIR, "render.js")));
  await z.finish();
  return readPluginZip(sink.blob());
}
/** 1.1.0: "Stripes" now goes to 20, "Title band" is gone, "Glow" is new. */
function v110() {
  const m = base();
  m.version = "1.1.0";
  m.params.count.max = 20;
  delete m.params.band;
  m.params.glow = { type: "boolean", default: false, label: "Glow" };
  m.editor.groups[2].fields = ["title", "glow"];
  delete m.agent.examples[1].params.band;
  return m;
}
const clipOf = (p: Project, id = "pc") => pluginClips(p, ID).find((x) => x.id === id) as Placement;

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
async function installed(params: Record<string, number | string | boolean> = { count: 30, band: false, title: "Hi" }) {
  const { blobs } = createMemoryStorage();
  const e = new Engine(createProject("Params"));
  await installPlugin({ engine: e, blobs }, await pkgOf(), "file:stripes.zip", { at: 0, id: "pc" });
  if (Object.keys(params).length) e.dispatch(cmd.setPluginParams("pc", params, "1.0.0"), "set");
  return { e, blobs };
}

describe("param migration (P87)", () => {
  const decls = v110().params as Record<string, HtmlClipParam>;
  it("keeps values that fit, clamps numbers, drops removed and invalid ones; new params take their defaults", () => {
    const r = migratePluginParams({ count: 30, angle: 10, band: false, direction: "up", title: "Hi" }, decls);
    expect(r.params).toEqual({ count: 20, angle: 10, title: "Hi" });
    expect(r.dropped).toEqual([
      { key: "count", reason: "clamped", detail: "30 is outside 2–20; 20 is used" },
      { key: "band", reason: "removed", detail: "no longer a setting" },
      { key: "direction", reason: "invalid", detail: 'must be one of "left", "right"' },
    ]);
    expect(migratePluginParams(undefined, decls)).toEqual({ params: {}, dropped: [] });
  });

  it("summarises a switch over all clips and switches the lock and every clip in one project change", async () => {
    const { e } = await installed();
    e.dispatch(cmd.addPluginClip(10 * S, ID, "1.0.0", S, "overlay", "pc2"), "add");
    const p = e.getState().project;
    const old = base().params as Record<string, HtmlClipParam>;
    expect(pluginSwitchSummary(p, ID, decls, old)).toEqual({
      clips: 2, added: ["glow"], removed: ["band"],
      changes: [{ key: "count", reason: "clamped", detail: "30 is outside 2–20; 20 is used", clips: 1 }, { key: "band", reason: "removed", detail: "no longer a setting", clips: 1 }],
    });
    const pkg = await pkgOf(v110());
    const next = switchPluginVersion(p, ID, pluginLockOf(pkg), decls);
    expect(next.plugins?.[ID]).toMatchObject({ version: "1.1.0", hash: pkg.hash });
    expect(clipOf(next).plugin).toEqual({ data: { params: { count: 20, title: "Hi" } }, v: "1.1.0" });
    expect(clipOf(next, "pc2").plugin).toEqual({ data: { params: {} }, v: "1.1.0" });
    expect(() => switchPluginVersion(createProject("x"), ID, pluginLockOf(pkg), decls)).toThrow(/not in this project/);
  });
});

describe("editing a plugin clip (P87)", () => {
  it("stores settings per clip; a gesture is one undo step; Reset goes back to the defaults", async () => {
    const { e } = await installed({});
    e.beginGesture();
    for (const n of [9, 10, 11]) e.dispatch(cmd.setPluginParams("pc", { count: n }, "1.0.0"));
    e.endGesture();
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({ count: 11 });
    e.dispatch(cmd.setPluginParams("pc", { band: false }, "1.0.0"));
    e.undo();
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({ count: 11 });
    e.undo();
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({});
    e.redo();
    expect(e.dispatch(cmd.setPluginParams("pc", undefined, "1.0.0"))).toBe(true);
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({});
    expect(e.dispatch(cmd.setPluginParams("pc", undefined, "1.0.0"))).toBe(false); // nothing to reset
    expect(e.dispatch(cmd.setPluginParams("nope", { count: 3 }, "1.0.0"))).toBe(false);
  });

  it("draws the form from the editor groups and edits through the engine", async () => {
    const { e } = await installed({ title: "Hi" });
    const render = () => mount(<PluginClipPanel project={e.getState().project} placement={clipOf(e.getState().project)} engine={e} part="params" />);
    let host = render();
    expect([...host.querySelectorAll(".v2-plugin-group h4")].map((h) => h.textContent)).toEqual(["Stripes", "Motion", "Title"]);
    expect((host.querySelector('input[aria-label="Moving stripes Title"]') as HTMLInputElement).value).toBe("Hi");
    act(() => (host.querySelector('[role="switch"][aria-label="Moving stripes Title band"]') as HTMLButtonElement).click());
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({ title: "Hi", band: false });
    const sel = host.querySelector('select[aria-label="Moving stripes Direction"]') as HTMLSelectElement;
    act(() => { sel.value = "right"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(clipOf(e.getState().project).plugin?.data?.params?.direction).toBe("right");
    e.undo();
    expect(clipOf(e.getState().project).plugin?.data?.params?.direction).toBeUndefined();
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    host = render();
    act(() => ([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Reset to defaults")) as HTMLButtonElement).click());
    expect(clipOf(e.getState().project).plugin?.data?.params).toEqual({});
    // read-only without an engine; the details part has no form
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    const ro = mount(<PluginClipPanel project={e.getState().project} placement={clipOf(e.getState().project)} part="details" />);
    expect(ro.querySelector('[data-testid="plugin-params"]')).toBeNull();
  });

  it("shows Update available with its action, and the plugin's icon and the clip's title on the card", async () => {
    const { e } = await installed({ title: "Under construction" });
    const onUpdate = vi.fn();
    const host = mount(<PluginClipPanel project={e.getState().project} placement={clipOf(e.getState().project)} engine={e} updateTo="1.1.0" onUpdate={onUpdate} />);
    expect(host.querySelector(".v2-plugin-update")?.textContent).toContain("Update available: 1.1.0");
    act(() => (host.querySelector('[data-testid="plugin-update-clip"]') as HTMLButtonElement).click());
    expect(onUpdate).toHaveBeenCalledWith(ID);
    const pl = clipOf(e.getState().project);
    const card = mount(<>{clipUi(pl).body!(pl)}</>);
    expect(card.textContent).toBe(" Moving stripes · Under construction");
    expect(card.querySelector("svg")).toBeTruthy();
  });
});

describe("switching plugin versions (P87)", () => {
  it("updates as one undo step with migration, offers the update after Undo, and downgrades with a report", async () => {
    const { e, blobs } = await installed();
    const v1 = e.getState().project;
    const pkg11 = await pkgOf(v110());
    const preview = pluginSwitchPreview(v1, pkg11)!;
    expect(preview).toMatchObject({ kind: "update", from: "1.0.0", clips: 1, added: ["glow"], removed: ["band"] });
    expect(preview.labels).toMatchObject({ glow: "Glow", band: "Title band", count: "Stripes" });
    const r = await installPlugin({ engine: e, blobs }, pkg11, "file:stripes-1.1.0.zip");
    expect(r.switched).toMatchObject({ kind: "update", from: "1.0.0", to: "1.1.0", clips: 1 });
    expect(r.switched!.changes.map((c) => c.key)).toEqual(["count", "band"]);
    expect(clipOf(e.getState().project).plugin).toEqual({ data: { params: { count: 20, title: "Hi" } }, v: "1.1.0" });
    expect(pluginMetaOf(ID)?.version).toBe("1.1.0");
    expect(isPluginEnabled(ID)).toBe(true); // the new hash is allowed for this project
    e.undo();
    expect(e.getState().project).toBe(v1);
    const rows = pluginRows(e.getState().project, await refreshPluginLibrary());
    expect(rows[0]).toMatchObject({ version: "1.0.0", update: { version: "1.1.0", hash: pkg11.hash }, versions: [{ version: "1.1.0", hash: pkg11.hash }] });
    e.redo();
    const rows11 = pluginRows(e.getState().project, await refreshPluginLibrary());
    expect(rows11[0].update).toBeUndefined();
    expect(rows11[0].versions.map((v) => v.version)).toEqual(["1.0.0"]);
    const down = await installPlugin({ engine: e, blobs }, await pkgOf(), "file:stripes.zip");
    expect(down.switched).toMatchObject({ kind: "downgrade", from: "1.1.0", to: "1.0.0", changes: [] });
    expect(clipOf(e.getState().project).plugin).toEqual({ data: { params: { count: 20, title: "Hi" } }, v: "1.0.0" });
  });

  it("says a plugin for a higher host API needs a newer Dionysus", async () => {
    const m = base(); m.api = 2; m.version = "2.0.0";
    const err = await pkgOf(m).catch((x: unknown) => x);
    expect(pluginErrorText(err)).toBe("This plugin needs a newer Dionysus (host API 2; this build has 1). Update Dionysus to use it.");
    setPluginIssues([[ID, { state: "newer", name: "Moving stripes", message: "x" }]]);
    expect(unknownSlateText(ID)).toEqual(["Plugin “Moving stripes”", "NEEDS A NEWER DIONYSUS"]);
  });
});
