// @vitest-environment jsdom
/** P89b: the "Create path <name> from <reference>" step (draw / track), the layer path picker, and named paths in the inspector. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { board, createProject, storyEdit, type Project } from "../../domain";
import { validateStoryboard, type StoryDoc } from "../../domain/storyJson";
import { cmd, Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import type { TrackAnalyse } from "../trackAnalyse";
import { NamedPaths } from "../MotionPathEditor";
import { PathStepDetail } from "./PathStep";
import { ProductionView } from "./ProductionView";
import { LayersEditor } from "./ShotLayers";

const S = 120_000;
const PLAN = { nodes: [{ id: "a", x: 0.1, y: 0.5 }, { id: "b", x: 0.5, y: 0.2 }, { id: "c", x: 0.9, y: 0.5 }] };
const origRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
  URL.createObjectURL = vi.fn(() => "blob:ref"); URL.revokeObjectURL = vi.fn();
  if (typeof PointerEvent === "undefined") {
    class PE extends MouseEvent { pointerId = 1; constructor(t: string, i?: MouseEventInit & { pointerId?: number }) { super(t, i); this.pointerId = i?.pointerId ?? 1; } }
    (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PE as unknown as typeof MouseEvent;
  }
  // Every frame / stage is 160 × 90 at the origin.
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});
afterAll(() => { Element.prototype.getBoundingClientRect = origRect; });
const mounted: { unmount: () => void }[] = [];
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); document.body.innerHTML = ""; });

function doc(paths: unknown[] = [{ id: "flight", name: "Bee flight", from: "bee", track: "the bee", durationSec: 2 }]) {
  return {
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "bee", type: "video", name: "Bee reference", prompt: "a bee flying", source: "upload" }, { id: "logo", type: "image", name: "Logo", prompt: "logo" }],
    paths,
    shots: [{ id: "s1", title: "One", durationSec: 4, prompt: "p", assets: [], qa: [], layers: [
      { id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } },
      { id: "i1", type: "image", asset: "logo", startSec: 1, endSec: 3, box: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 } },
    ] }],
    connections: [],
  };
}
function boardEngine(d = doc(), withRef = true) {
  const r = validateStoryboard(d);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.doc as StoryDoc));
  if (withRef) e.dispatch(cmd.addStoryVersion({ slot: "bee" }, { blobKey: "kb", mime: "video/mp4", durationTicks: 2 * S, width: 1920, height: 1080 }, { versionId: "b1" }));
  return e;
}
const blobs = { get: async () => new Blob(["x"]), put: async () => undefined, delete: async () => undefined, keys: async () => [] } as unknown as BlobStore;
const flight = (p: Project) => p.storyboard!.paths!.find((x) => x.id === "flight")!;
const step = (p: Project) => board.productionSteps(p).find((s) => s.key === "path:flight")!;

function mountStep(e: Engine, analyse?: TrackAnalyse) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el); mounted.push(root);
  const onOpen = vi.fn(), onNote = vi.fn();
  const render = () => act(() => { root.render(<PathStepDetail project={e.getState().project} pathId="flight" thumbs={{}} engine={e} blobs={blobs} mobile={false} onOpen={onOpen} onNote={onNote} analyse={analyse} />); });
  render();
  e.subscribe(() => render());
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  const btn = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text) as HTMLButtonElement;
  return { el, q, btn, onOpen, onNote };
}
const ptr = (t: Element, type: string, x: number, y: number) => act(() => { t.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); });

describe("P89b path step", () => {
  it("the guide lists “Create path <name> from <reference>” after the reference, waiting until it is added", () => {
    const e = boardEngine(doc(), false);
    expect(step(e.getState().project)).toMatchObject({ state: "blocked", waitsFor: "bee" });
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); mounted.push(root);
    act(() => { root.render(<ProductionView project={e.getState().project} thumbs={{}} engine={e} blobs={blobs} mobile={false} />); });
    const items = [...el.querySelectorAll(".v2-prod-item")].map((x) => x.textContent ?? "");
    const at = items.findIndex((x) => x.includes("Create path Bee flight from Bee reference"));
    expect(at).toBeGreaterThan(items.findIndex((x) => x.includes("Bee reference") && !x.includes("Create path")));
    expect(items[at]).toContain("After “Bee reference” is added");
    act(() => (el.querySelectorAll(".v2-prod-item button")[at] as HTMLButtonElement).click());
    const d = el.querySelector('[data-testid="path-step"]')!;
    expect(d.textContent).toContain("has no version yet");
    expect(d.textContent).toContain("Moves 1 layer");
    expect(el.querySelector('[data-testid="path-track"]')).toBeNull(); // nothing to track yet
  });

  it("Draw over reference: points on the frame, ✓ stores them as drawn (one undo step) and the step is done", async () => {
    const e = boardEngine();
    expect(step(e.getState().project).state).toBe("todo");
    const t = mountStep(e);
    expect(t.q('[data-testid="path-state"]').textContent).toContain("No points yet");
    act(() => t.q('[data-testid="path-draw"]').click());
    const sheet = t.q('[data-testid="path-draw-sheet"]');
    expect(sheet.getAttribute("aria-label")).toBe("Draw path Bee flight");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(sheet.querySelector("video")!.getAttribute("src")).toBe("blob:ref"); // the reference frame under the path
    const svg = () => t.q('[data-testid="motion-path-editor"]');
    for (const [x, y] of [[16, 45], [80, 18], [144, 45]]) { ptr(svg(), "pointerdown", x, y); ptr(svg(), "pointerup", x, y); }
    expect(sheet.querySelector('[data-testid="mp-count"]')!.textContent).toBe("3 pts");
    act(() => t.q('[data-testid="mp-done"]').click());
    expect(t.q('[data-testid="path-draw-sheet"]')).toBeNull();
    const p = flight(e.getState().project);
    expect(p.createdBy).toBe("draw");
    expect(p.motionPath!.nodes.map((n) => [n.x, n.y])).toEqual([[-0.4, 0], [0, -0.3], [0.4, 0]]);
    expect(p.motionPath!.nodes.at(-1)!.t).toBe(2 * S); // the path's length
    expect(step(e.getState().project).state).toBe("done");
    expect(t.q('[data-testid="path-state"]').textContent).toContain("Drawn · 3 points");
    expect(t.onNote).toHaveBeenCalledWith("Bee flight: 3 points drawn");
    e.undo();
    expect(flight(e.getState().project).createdBy).toBeUndefined();
  });

  it("✕ in the draw sheet changes nothing; Clear removes the points", () => {
    const e = boardEngine(doc([{ id: "flight", name: "Bee flight", from: "bee", motionPath: PLAN, durationSec: 2 }]));
    expect(step(e.getState().project).state).toBe("todo"); // planned but made from a reference: still to do
    const t = mountStep(e);
    expect(t.q('[data-testid="path-state"]').textContent).toContain("Planned · 3 points");
    act(() => t.q('[data-testid="path-draw"]').click());
    const svg = t.q('[data-testid="motion-path-editor"]');
    ptr(svg, "pointerdown", 150, 80); ptr(svg, "pointerup", 150, 80);
    act(() => t.q('[data-testid="mp-cancel"]').click());
    expect(t.q('[data-testid="path-draw-sheet"]')).toBeNull();
    expect(flight(e.getState().project).motionPath!.nodes).toHaveLength(3);
    act(() => t.q('[data-testid="path-clear"]').click());
    expect(flight(e.getState().project).motionPath).toBeUndefined();
  });

  it("Track in reference: the Track sheet's ✓ turns the box centre into the path (no followers or mask)", async () => {
    const e = boardEngine();
    const analyse: TrackAnalyse = async (ticks, _start, box, onProgress) => {
      onProgress(1, []);
      return { srcW: 1920, srcH: 1080, samples: ticks.map((s, i) => ({ s, x: 0.2 + (0.6 * i) / Math.max(1, ticks.length - 1), y: box.y + box.h / 2 - 0.2 * Math.sin((Math.PI * i) / Math.max(1, ticks.length - 1)), w: box.w, h: box.h, scale: 1, conf: 0.95 })) };
    };
    const t = mountStep(e, analyse);
    act(() => t.q('[data-testid="path-track"]').click());
    const sheet = t.q('[role="dialog"][aria-label="Track for path Bee flight"]');
    expect(sheet).toBeTruthy();
    const stage = t.q(".v2-track-stage");
    ptr(stage, "pointerdown", 30, 30); ptr(stage, "pointermove", 50, 50); ptr(stage, "pointerup", 50, 50);
    const track = [...sheet.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Track")!;
    await act(async () => { track.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(t.q('[data-testid="track-path-note"]')).toBeTruthy();
    expect(sheet.textContent).not.toContain("Follow");
    expect(sheet.textContent).not.toContain("Mask");
    await act(async () => { t.btn("Make the path").click(); await new Promise((r) => setTimeout(r, 0)); });
    const p = flight(e.getState().project);
    expect(p.createdBy).toBe("track");
    expect(p.motionPath!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(p.motionPath!.nodes[0].t).toBe(0);
    expect(p.motionPath!.nodes[0].x).toBeCloseTo(-0.3, 2);
    expect(p.motionPath!.nodes.at(-1)!.x).toBeCloseTo(0.3, 2);
    expect(step(e.getState().project).state).toBe("done");
    expect(t.q('[data-testid="path-state"]').textContent).toMatch(/Made by tracking/);
  });
});

describe("P89b layer path picker", () => {
  it("links a layer to a path or makes a new one; saving the shot adds only paths a layer uses", () => {
    const e = boardEngine();
    const b = e.getState().project.storyboard!;
    let layers = b.shots.s1.layers!;
    const made: { id: string; name?: string }[] = [];
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); mounted.push(root);
    const render = () => act(() => { root.render(<LayersEditor b={b} layers={layers} effects={[]} dur={4} onLayers={(l) => { layers = l; render(); }} onEffects={() => undefined} effectName={(x) => x} newPaths={made as never} onNewPath={(x) => { made.push(x); }} />); });
    render();
    act(() => ([...el.querySelectorAll(".v2-sb-layer-name")][1] as HTMLButtonElement).click());
    const sel = el.querySelector('[data-testid="layer-path"]') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "flight", "__new"]);
    act(() => { sel.value = "__new"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(made).toEqual([{ id: "path-2", name: "Path 2", durationSec: 2 }]);
    expect(layers[1].pathRef).toEqual({ ref: "path-2", stretch: true });
    expect(el.querySelector(".v2-sb-pathrow input[type=checkbox]")).toBeTruthy(); // Fit to layer
    const next = storyEdit.updateShot(e.getState().project, "s1", { layers, newPaths: [...made, { id: "unused", name: "Unused" }] as never });
    expect(next.storyboard!.paths!.map((x) => x.id)).toEqual(["flight", "path-2"]);
    expect(board.productionSteps(next).find((s) => s.key === "path:path-2")!.state).toBe("todo"); // "Draw path Path 2"
  });
});

describe("P89b named paths in the inspector", () => {
  function sent() {
    const e = boardEngine(doc([{ id: "flight", name: "Bee flight", motionPath: PLAN, durationSec: 2 }]), false);
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: 4 * S }, { versionId: "o1" }));
    e.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "k3", mime: "image/png", width: 200, height: 200 }, { versionId: "g1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    return e;
  }
  const clips = (e: Engine) => Object.values(e.getState().project.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));
  function mountNamed(e: Engine, kind: "text" | "image") {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); mounted.push(root);
    const pl = () => clips(e).find((x) => x.clipType === kind)!;
    const render = () => act(() => { root.render(<NamedPaths engine={e} placement={pl()} />); });
    render(); e.subscribe(() => render());
    const btn = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
    return { el, pl, btn };
  }
  it("shows the link, unlinks, saves as a named path, and uses / links named paths on another clip", () => {
    const e = sent();
    const t = mountNamed(e, "text");
    expect(t.pl().pathRef).toEqual({ ref: "flight", stretch: true });
    expect(t.el.textContent).toContain("From storyboard path “Bee flight”, fitted to the clip");
    expect(t.btn("Link to storyboard path Bee flight").textContent).toContain("Linked");
    act(() => (t.el.querySelector('[data-testid="mp-unlink"]') as HTMLButtonElement).click());
    expect(t.pl().pathRef).toBeUndefined();
    expect(t.pl().motionPath!.nodes).toHaveLength(3);
    act(() => (t.el.querySelector('[data-testid="mp-save-as"]') as HTMLButtonElement).click());
    const name = t.el.querySelector('input[aria-label="Path name"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Swoop"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => (t.el.querySelector(".v2-mp-saveform button[type=submit]") as HTMLButtonElement).click());
    expect(e.getState().project.motionPaths!.map((x) => x.name)).toEqual(["Swoop"]);
    const i = mountNamed(e, "image");
    expect(i.pl().motionPath).toBeUndefined();
    act(() => i.btn("Use saved path Swoop").click());
    expect(i.pl().motionPath!.nodes).toHaveLength(3);
    expect(i.pl().motionPath!.nodes.at(-1)!.t).toBe(i.pl().durationTicks); // fitted to the clip
    expect(i.pl().pathRef).toBeUndefined(); // a copy
    act(() => i.btn("Link to storyboard path Bee flight").click());
    expect(i.pl().pathRef).toEqual({ ref: "flight", stretch: true });
    act(() => i.btn("Delete saved path Swoop").click());
    expect(e.getState().project.motionPaths ?? []).toEqual([]);
  });
});
