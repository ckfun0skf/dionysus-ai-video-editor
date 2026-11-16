// @vitest-environment jsdom
/**
 * P76 (Phase 2 step 2.3): the scene editor. Tracks and blocks come from the scene; selecting a block or a track opens
 * its form; every committed edit is ONE step of the editor's own undo (P80: nothing is stored until Save, which
 * replaces the current version or adds a new one as ONE project undo step); the preview shows the unsaved scene at
 * once and keeps the clip's page when only events or properties changed.
 */
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createProject, SAMPLE_SCENE, stateAt, versionOfPlacement, type Placement, type Project, type SceneDoc, type Track } from "../domain";
import { Engine, cmd } from "../engine";
import { clipRendererFor, type ClipFrameHost } from "../render/clipRenderers";
import { SceneEditor, type SceneSel } from "./SceneEditor";
import { ScenePanel } from "./ScenePanel";
import { cachedSceneDoc, sceneAsset } from "./sceneAsset";
import { memorySceneDrafts } from "./sceneDrafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const S = 120_000;
const readText = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const memBlobs = () => {
  const m = new Map<string, Blob & { text(): Promise<string> }>();
  return { m, put: async (k: string, b: Blob) => { const t = await readText(b); m.set(k, Object.assign(b, { text: async () => t })); }, get: async (k: string) => m.get(k), delete: async () => undefined, keys: async () => [...m.keys()] };
};
const clip = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements)[0];
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const shownDoc = (p: Project) => cachedSceneDoc(versionOfPlacement(p, clip(p))?.media.blobKey)!;

async function open(opts: { mobile?: boolean; initialSel?: SceneSel; time?: number } = {}) {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, SAMPLE_SCENE);
  const e = new Engine(createProject("scene"));
  e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const primed: [string, SceneDoc][] = [];
  const previews: [string, SceneDoc | undefined][] = [];
  const seeks: number[] = [];
  let closed = 0;
  const draw = () => { const p = e.getState().project; root.render(<SceneEditor engine={e} project={p} placement={clip(p)} blobs={blobs as never} mobile={!!opts.mobile} time={opts.time ?? 0} playing={false} onSeek={(t) => seeks.push(t)} onTogglePlay={() => undefined} onClose={() => { closed++; }} onPrime={(k, d) => primed.push([k, d])} onPreview={(k, d) => previews.push([k, d])} initialSel={opts.initialSel} drafts={memorySceneDrafts()} />); };
  const unsub = e.subscribe(draw);
  await act(async () => draw()); await settle();
  const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T & Element>(sel) as unknown as T;
  const button = (re: RegExp) => [...el.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") ?? "") || re.test((b.textContent ?? "").trim()))!;
  const field = (label: string) => [...el.querySelectorAll<HTMLLabelElement>(".v2-sed-field")].find((l) => l.querySelector("span")?.textContent === label)!.querySelector<HTMLInputElement & HTMLSelectElement>("input,select")!;
  const typeIn = async (input: HTMLInputElement, v: string) => {
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.focus(); input.blur(); });
    await settle();
  };
  const choose = async (select: HTMLSelectElement, v: string) => {
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!; set.call(select, v); select.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
  };
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); }); await settle(); };
  const done = () => { unsub(); act(() => root.unmount()); el.remove(); };
  /** The editor's scene: the unsaved work the preview shows, else the stored scene. */
  const work = () => previews.at(-1)?.[1] ?? shownDoc(e.getState().project);
  const undo = () => click(button(/^Undo$/));
  const save = async (choice: "replace" | "new") => { await click(button(/^Save$/)); await click(el.querySelector(`[data-choice="${choice}"]`)!); };
  return { e, blobs, asset, el, q, button, field, typeIn, choose, click, primed, previews, seeks, closed: () => closed, done, work, undo, save };
}

describe("P76 scene editor", () => {
  it("draws the scene/camera track first, one track per object, and events as blocks labelled with their call", async () => {
    const t = await open();
    const names = [...t.el.querySelectorAll(".v2-sed-tname span")].map((x) => x.textContent);
    expect(names).toEqual(["Scene", "floor", "ball", "cube", "sign"]);
    const blocks = [...t.el.querySelectorAll(".v2-sed-block")].map((b) => b.textContent);
    expect(blocks).toEqual(["moveTo", "moveTo", "setMood", "rotation", "opacity", "visible"]);
    expect(t.q('[data-testid="scene-form"]')).toBeTruthy();
    expect(t.button(/^ball\.moveTo at 0\.5s for 1\.5s$/)).toBeTruthy();
    // Every button in the editor is at least 44 px tall in CSS (checked in Chrome for the screenshots); here: the blocks.
    for (const b of t.el.querySelectorAll<HTMLElement>(".v2-sed-block")) expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(44);
    t.done();
  });

  it("edits stay in the editor (one step of its own undo each); Save as new version stores ONE version in ONE project undo step", async () => {
    const t = await open();
    const v0 = t.asset.versions[0].id, p0 = t.e.getState().project;
    await t.click(t.button(/^ball\.moveTo at 0\.5s/));
    expect(t.q('[data-testid="event-form"]').textContent).toMatch(/ball\.moveTo/);
    await t.typeIn(t.field("At (s)"), "1.2");
    expect(t.work().events![1]).toMatchObject({ at: 1.2, call: "moveTo" });
    await t.typeIn(t.field("Duration (s)"), "0.5");
    await t.choose(t.field("Ease"), "outBack");
    let p = t.e.getState().project;
    expect(p.assets[t.asset.id].versions).toHaveLength(1); // nothing stored yet
    expect(p).toBe(p0); // the project is untouched (no project undo step)
    expect(t.work().events![1]).toMatchObject({ at: 1.2, dur: 0.5, ease: "outBack" });
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v1 · edited");
    // The editor's undo / redo: three gestures, three steps.
    await t.undo();
    expect(t.work().events![1]).toMatchObject({ at: 1.2, dur: 0.5, ease: "inOutCubic" });
    await t.click(t.button(/^Redo$/));
    expect(t.work().events![1]).toMatchObject({ ease: "outBack" });
    await t.save("new");
    p = t.e.getState().project;
    expect(p.assets[t.asset.id].versions).toHaveLength(2);
    expect(shownDoc(p).events![1]).toMatchObject({ at: 1.2, dur: 0.5, ease: "outBack" });
    expect(t.primed.at(-1)![1]).toBe(shownDoc(p));
    expect(p.settings.versionSaveMode ?? "new").toBe("new");
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v2");
    expect(t.el.querySelector('[role="status"]')!.textContent).toMatch(/Saved as v2/);
    expect(t.button(/^Save$/).hasAttribute("disabled")).toBe(true);
    // One project undo removes the save.
    t.e.undo(); await settle();
    p = t.e.getState().project;
    expect(p.assets[t.asset.id].versions.map((v) => v.id)).toEqual([v0]);
    expect(shownDoc(p)).toEqual(SAMPLE_SCENE);
    t.done();
  });

  it("Save → Replace current overwrites the shown version (no new version); one project undo puts the old scene back", async () => {
    const t = await open({ initialSel: { kind: "object", id: "cube" } });
    const key0 = t.asset.versions[0].media.blobKey;
    const x = t.el.querySelectorAll<HTMLInputElement>('[data-testid="object-form"] .v2-sed-vec')[0].querySelector("input")!;
    await t.typeIn(x, "-2");
    const y = t.el.querySelectorAll<HTMLInputElement>('[data-testid="object-form"] .v2-sed-vec')[0].querySelectorAll("input")[1];
    await t.typeIn(y, "1");
    await t.click(t.button(/^Save$/));
    const box = t.q('[aria-label="Save scene"]');
    expect(box.textContent).toMatch(/Replace current.*Overwrite v1.*Save as new version.*add v2/s);
    await t.click(box.querySelector('[data-choice="replace"]')!);
    const p = t.e.getState().project;
    expect(p.assets[t.asset.id].versions).toHaveLength(1);
    expect(p.assets[t.asset.id].versions[0].media.blobKey).not.toBe(key0);
    expect(shownDoc(p).objects[2].position).toEqual([-2, 1, -0.5]);
    expect(p.settings.versionSaveMode).toBe("replace");
    t.e.undo(); await settle();
    expect(t.e.getState().project.assets[t.asset.id].versions[0].media.blobKey).toBe(key0);
    t.done();
  });

  it("adds and deletes objects and events; renames an object (its events follow)", async () => {
    const t = await open({ time: 1.5 * S });
    await t.click(t.button(/^Add object$/));
    await t.click([...t.el.querySelectorAll('[role="menuitem"]')].find((b) => /torus/i.test(b.textContent ?? ""))!);
    let d = t.work();
    expect(d.objects.at(-1)).toMatchObject({ id: "torus", shape: "torus" });
    expect(t.q('[data-testid="object-form"]').textContent).toMatch(/torus/);
    await t.click(t.button(/^Add event to torus$/));
    d = t.work();
    expect(d.events!.at(-1)).toMatchObject({ at: 1.5, obj: "torus", call: "moveTo", dur: 1 });
    expect(t.q('[data-testid="event-form"]').textContent).toMatch(/torus\.moveTo/);
    await t.choose(t.field("Call"), "color");
    expect(t.work().events!.at(-1)).toMatchObject({ call: "color", args: { value: expect.stringMatching(/^#/) } });
    await t.click(t.button(/^Delete$/));
    expect(t.work().events).toHaveLength(6);
    await t.click(t.button(/^ball$/));
    await t.typeIn(t.field("Id"), "orb");
    d = t.work();
    expect(d.objects[1].id).toBe("orb");
    expect(d.events!.filter((e) => e.obj === "orb").map((e) => e.call)).toEqual(["moveTo", "setMood"]);
    await t.click(t.button(/^Delete object$/));
    d = t.work();
    expect(d.objects.map((o) => o.id)).toEqual(["floor", "cube", "sign", "torus"]);
    expect(t.el.querySelector('[role="status"]')!.textContent).toMatch(/Deleted “orb” and 2 events/);
    // Nothing stored; six steps of the editor's undo (add, add event, call, delete event, rename, delete object).
    expect(t.e.getState().project.assets[t.asset.id].versions).toHaveLength(1);
    for (let i = 0; i < 6; i++) await t.undo();
    expect(t.work()).toEqual(SAMPLE_SCENE);
    expect(t.button(/^Undo$/).hasAttribute("disabled")).toBe(true);
    t.done();
  });

  it("the ruler seeks in scene time; Escape closes; the Scene tab opens the editor; the phone editor is full screen", async () => {
    const t = await open({ mobile: true });
    expect(t.q(".v2-scene-editor").className).toMatch(/is-phone/);
    expect(t.button(/^Close scene editor$/)).toBeTruthy();
    await act(async () => { t.q(".v2-scene-editor").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(t.closed()).toBe(1);
    t.done();
    const blobs = memBlobs();
    const asset = await sceneAsset(blobs, SAMPLE_SCENE);
    const e = new Engine(createProject("scene"));
    e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    const onEdit = vi.fn();
    await act(async () => root.render(<ScenePanel project={e.getState().project} placement={clip(e.getState().project)} blobs={blobs as never} engine={e} onEdit={onEdit} />));
    await settle();
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Edit scene"))!.click());
    expect(onEdit).toHaveBeenCalledOnce();
    act(() => root.unmount()); el.remove();
  });

  it("the renderer draws the same time again when the clip's scene changed on a kept page", () => {
    const requests: { t: number; fresh?: boolean }[] = [];
    const host = { frame: undefined, issue: undefined, request: (t: number, _d?: number, _x?: unknown, fresh?: boolean) => requests.push({ t, fresh }) };
    const pl = { id: "sc", startTicks: 0, durationTicks: 5 * S, sourceInTicks: 0, clipType: "scene", source: { kind: "assetVersion", assetId: "a", versionId: "v" } } as Placement;
    let doc: SceneDoc = SAMPLE_SCENE;
    const frame = () => clipRendererFor(pl)!.frame!({
      g: undefined, canvas: undefined, time: S, offline: false, track: { id: "t", kind: "video", name: "t", placements: [pl] } as Track, placement: pl, sourceTicks: S,
      version: { id: "v", createdAt: "", media: { blobKey: "k", mime: "x" }, provenance: { source: "import", inputs: [] } },
      frame: { live: new Set(), loads: new Map(), stalled: false, missing: false, holding: false, run: false },
      media: { sceneDoc: () => doc, sceneHost: () => host, keyOf: () => undefined },
    } as unknown as ClipFrameHost);
    frame(); frame();
    doc = { ...SAMPLE_SCENE, events: [] };
    frame();
    expect(requests).toEqual([{ t: 1, fresh: false }, { t: 1, fresh: false }, { t: 1, fresh: true }]);
    expect(stateAt(doc, 1).objects[1].position).toEqual([-1.6, 0.5, 0]);
  });
});
