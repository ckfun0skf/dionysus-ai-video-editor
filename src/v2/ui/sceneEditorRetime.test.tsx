// @vitest-environment jsdom
/**
 * P77 (Phase 2 step 2.4): retiming in the scene editor. Dragging a block moves its event, the selected block's edge
 * handles change its start or length; the tracks and the preview follow the drag live without touching the project,
 * and the release is ONE undo step stored by the version rules. Esc cancels; snapping lands on the playhead; touch
 * needs a selected block; a drop on another object's track gives the event to it; the ruler scrubs; arrow keys nudge.
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createProject, SAMPLE_SCENE, versionOfPlacement, type Project, type SceneDoc } from "../domain";
import { Engine, cmd } from "../engine";
import { SceneEditor, type SceneSel } from "./SceneEditor";
import { cachedSceneDoc, sceneAsset } from "./sceneAsset";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const S = 120_000;
const readText = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const memBlobs = () => {
  const m = new Map<string, Blob & { text(): Promise<string> }>();
  return { m, put: async (k: string, b: Blob) => { const t = await readText(b); m.set(k, Object.assign(b, { text: async () => t })); }, get: async (k: string) => m.get(k), delete: async () => undefined, keys: async () => [...m.keys()] };
};
const clip = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements)[0];
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 30)); });
const shownDoc = (p: Project) => cachedSceneDoc(versionOfPlacement(p, clip(p))?.media.blobKey)!;
const PPS = 96; // the desktop editor's starting zoom

/** A pointer event as React and the window listeners see it (jsdom has no PointerEvent). */
function ptr(type: string, target: EventTarget, x: number, y = 0, o: { alt?: boolean; touch?: boolean } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, altKey: !!o.alt });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: o.touch ? "touch" : "mouse" });
  target.dispatchEvent(ev);
}

async function open(opts: { mobile?: boolean; initialSel?: SceneSel; time?: number } = {}) {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, SAMPLE_SCENE);
  const e = new Engine(createProject("scene"));
  e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const previews: [string, SceneDoc | undefined][] = [];
  const seeks: number[] = [];
  let closed = 0;
  const draw = () => { const p = e.getState().project; root.render(<SceneEditor engine={e} project={p} placement={clip(p)} blobs={blobs as never} mobile={!!opts.mobile} time={opts.time ?? 0} playing={false} onSeek={(t) => seeks.push(t)} onTogglePlay={() => undefined} onClose={() => { closed++; }} onPreview={(k, d) => previews.push([k, d])} initialSel={opts.initialSel} />); };
  const unsub = e.subscribe(draw);
  await act(async () => draw()); await settle();
  const byLabel = (re: RegExp) => [...el.querySelectorAll<HTMLElement>("[aria-label]")].find((b) => re.test(b.getAttribute("aria-label")!))!;
  const versions = () => e.getState().project.assets[asset.id].versions.length;
  const drag = async (target: HTMLElement, dx: number, o: { alt?: boolean; touch?: boolean; y?: number; end?: "up" | "esc" } = {}) => {
    await act(async () => { ptr("pointerdown", target, 100, 10, o); });
    await act(async () => { ptr("pointermove", window, 100 + dx / 2, o.y ?? 10, o); ptr("pointermove", window, 100 + dx, o.y ?? 10, o); });
    await settle();
    const during = { versions: versions(), previews: previews.length, status: el.querySelector('[data-testid="scene-drag-status"]')?.textContent, guide: !!el.querySelector('[data-testid="scene-snap-guide"]') };
    await act(async () => {
      if (o.end === "esc") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else ptr("pointerup", window, 100 + dx, o.y ?? 10, o);
    });
    await settle();
    return during;
  };
  const done = () => { unsub(); act(() => root.unmount()); el.remove(); };
  return { e, asset, el, byLabel, versions, drag, previews, seeks, closed: () => closed, done };
}

describe("P77 scene editor retiming", () => {
  it("dragging a block moves its event: live in the tracks and preview, stored on release as one undo step", async () => {
    const t = await open();
    const key0 = t.asset.versions[0].media.blobKey;
    const during = await t.drag(t.byLabel(/^ball\.moveTo at 0\.5s/), 0.5 * PPS, { alt: true }); // Alt: snapping off
    expect(during.versions).toBe(1); // nothing stored while dragging
    expect(during.status).toBe("1s → 2.5s");
    const live = t.previews.filter(([, d]) => d).at(-1)!;
    expect(live[0]).toBe(key0);
    expect(live[1]!.events![1]).toMatchObject({ at: 1, dur: 1.5 });
    expect(t.previews.at(-1)).toEqual([key0, undefined]); // the stored scene is put back after the release
    expect(t.versions()).toBe(2);
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 1, dur: 1.5, obj: "ball" });
    expect(t.byLabel(/^ball\.moveTo at 1s for 1\.5s$/).getAttribute("aria-pressed")).toBe("true");
    t.e.undo(); await settle();
    expect(shownDoc(t.e.getState().project)).toEqual(SAMPLE_SCENE);
    t.done();
  });

  it("the selected block's handles change its start (end stays) and its length; arrow keys nudge by a frame", async () => {
    const t = await open({ initialSel: { kind: "event", index: 1 } });
    const end = t.byLabel(/^End of ball\.moveTo$/);
    expect(end.getAttribute("role")).toBe("slider");
    await t.drag(end, -0.5 * PPS, { alt: true });
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 0.5, dur: 1 });
    await t.drag(t.byLabel(/^Start of ball\.moveTo$/), 0.25 * PPS, { alt: true });
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 0.75, dur: 0.75 });
    await act(async () => { t.byLabel(/^ball\.moveTo at 0\.75s/).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await settle();
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 0.767, dur: 0.75 }); // frame 23 at 30 fps
    // Same session ("New version"): one version; three gestures, three undo steps.
    expect(t.versions()).toBe(2);
    for (let i = 0; i < 3; i++) t.e.undo();
    await settle();
    expect(shownDoc(t.e.getState().project)).toEqual(SAMPLE_SCENE);
    t.done();
  });

  it("snaps the start to the playhead with a guide; clamps to the clip; Esc cancels and puts the preview back", async () => {
    const t = await open({ time: 1.2 * S });
    const during = await t.drag(t.byLabel(/^ball\.moveTo at 0\.5s/), 66);
    expect(during.guide).toBe(true);
    expect(during.status).toMatch(/snapped/);
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 1.2 });
    // Far past the clip's end: the event ends at 5 s.
    await t.drag(t.byLabel(/^ball\.moveTo at 1\.2s/), 20 * PPS);
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 3.5, dur: 1.5 });
    const n = t.versions(), undo = t.e.getState().canUndo;
    const before = shownDoc(t.e.getState().project);
    await t.drag(t.byLabel(/^ball\.moveTo at 3\.5s/), -PPS, { end: "esc" });
    expect(shownDoc(t.e.getState().project)).toBe(before);
    expect(t.versions()).toBe(n);
    expect(t.e.getState().canUndo).toBe(undo);
    expect(t.previews.at(-1)![1]).toBeUndefined();
    expect(t.closed()).toBe(0); // Esc ended the drag, not the editor
    t.done();
  });

  it("touch: a swipe over an unselected block doesn't move it; once selected it drags", async () => {
    const t = await open({ mobile: true });
    await t.drag(t.byLabel(/^ball\.moveTo at 0\.5s/), 64, { touch: true });
    expect(t.versions()).toBe(1);
    await act(async () => t.byLabel(/^ball\.moveTo at 0\.5s/).click());
    await t.drag(t.byLabel(/^ball\.moveTo at 0\.5s/), 64, { touch: true, alt: true }); // phone zoom 64 px/s
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ at: 1.5 });
    t.done();
  });

  it("a drop on another object's track gives the event to it when the call fits there", async () => {
    const t = await open();
    const lane = (id: string) => t.el.querySelector<HTMLElement>(`[data-track="${id}"]`)!;
    const rows: Record<string, number> = { camera: 0, floor: 50, ball: 100, cube: 150, sign: 200 };
    for (const [id, top] of Object.entries(rows)) lane(id).getBoundingClientRect = () => ({ top, bottom: top + 48, height: 48, left: 0, right: 500, width: 500, x: 0, y: top, toJSON: () => ({}) });
    const during = await t.drag(t.byLabel(/^ball\.moveTo at 0\.5s/), 0, { y: 170 });
    expect(during.status).toMatch(/to cube/);
    expect(shownDoc(t.e.getState().project).events![1]).toMatchObject({ obj: "cube", call: "moveTo", at: 0.5 });
    expect(t.byLabel(/^cube\.moveTo at 0\.5s/)).toBeTruthy();
    // setMood is ball's own function: the sign has none, so the drop is refused and nothing changes.
    const n = t.versions();
    const refused = await t.drag(t.byLabel(/^ball\.setMood/), 0, { y: 220 });
    expect(refused.status).toMatch(/no setMood/);
    expect(t.versions()).toBe(n);
    expect(shownDoc(t.e.getState().project).events![2]).toMatchObject({ obj: "ball" });
    t.done();
  });

  it("the ruler scrubs the playhead in scene time; Esc in an edited field reverts it, in a clean field it closes", async () => {
    const t = await open({ initialSel: { kind: "event", index: 1 } });
    const ruler = t.el.querySelector<HTMLElement>('[data-testid="scene-ruler"]')!;
    await act(async () => { ptr("pointerdown", ruler, PPS); ptr("pointermove", window, 2 * PPS); ptr("pointerup", window, 2 * PPS); ptr("pointermove", window, 3 * PPS); });
    expect(t.seeks).toEqual([1 * S, 2 * S]);
    const at = [...t.el.querySelectorAll<HTMLLabelElement>(".v2-sed-field")].find((l) => l.querySelector("span")?.textContent === "At (s)")!.querySelector("input")!;
    await act(async () => {
      at.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(at, "3");
      at.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { at.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(t.closed()).toBe(0);
    expect(at.value).toBe("0.5");
    await act(async () => { at.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(t.closed()).toBe(1);
    expect(t.versions()).toBe(1);
    t.done();
  });
});
