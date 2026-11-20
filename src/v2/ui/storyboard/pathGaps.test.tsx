// @vitest-environment jsdom
/** P90: skip / reopen a path step, image references (no tracking, drawn over the picture), the reference version picker, Go to time. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { board, createProject, parseTimecode, storyPaths, type Project } from "../../domain";
import { runStoryTool } from "../../domain/storyAgent";
import { validateStoryboard, type StoryDoc } from "../../domain/storyJson";
import { storyboardFromDoc } from "../../domain/storyboard";
import { storyboardToDoc } from "../../domain/storyRoundtrip";
import { cmd, Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { GoToTimeSheet } from "../GoToTime";
import { PathStepDetail } from "./PathStep";

const S = 120_000;
const PLAN = { nodes: [{ id: "a", x: 0.1, y: 0.5 }, { id: "b", x: 0.5, y: 0.2 }, { id: "c", x: 0.9, y: 0.5 }] };
const origRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
  URL.createObjectURL = vi.fn((b: Blob) => `blob:${(b as Blob & { key?: string }).key ?? "x"}`); URL.revokeObjectURL = vi.fn();
  if (typeof PointerEvent === "undefined") {
    class PE extends MouseEvent { pointerId = 1; constructor(t: string, i?: MouseEventInit & { pointerId?: number }) { super(t, i); this.pointerId = i?.pointerId ?? 1; } }
    (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PE as unknown as typeof MouseEvent;
  }
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
});
afterAll(() => { Element.prototype.getBoundingClientRect = origRect; });
const mounted: { unmount: () => void }[] = [];
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); document.body.innerHTML = ""; });

function doc(paths: unknown[]) {
  return {
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "bee", type: "video", name: "Bee reference", prompt: "a bee", source: "upload" }, { id: "logo", type: "image", name: "Logo", prompt: "logo", source: "upload" }],
    paths,
    shots: [{ id: "s1", title: "One", durationSec: 4, prompt: "p", assets: [], qa: [], layers: [
      { id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.5 }, motionPath: { ref: "flight", stretch: true } },
    ] }],
    connections: [],
  };
}
function boardEngine(paths: unknown[]) {
  const r = validateStoryboard(doc(paths));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.doc as StoryDoc));
  return e;
}
const getKeys: string[] = [];
const blobs = { get: async (k: string) => { getKeys.push(k); return Object.assign(new Blob(["x"]), { key: k }); }, put: async () => undefined, delete: async () => undefined, keys: async () => [] } as unknown as BlobStore;
const flight = (p: Project) => p.storyboard!.paths!.find((x) => x.id === "flight")!;
const step = (p: Project) => board.productionSteps(p).find((s) => s.key === "path:flight")!;
function mountStep(e: Engine) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el); mounted.push(root);
  const onNote = vi.fn();
  const render = () => act(() => { root.render(<PathStepDetail project={e.getState().project} pathId="flight" thumbs={{}} engine={e} blobs={blobs} mobile={false} onOpen={() => undefined} onNote={onNote} />); });
  render(); e.subscribe(() => render());
  const q = (sel: string) => el.querySelector(sel) as HTMLElement;
  return { el, q, onNote };
}

describe("P90 skip a path step", () => {
  it("Skip keeps the planned points as final (Send still moves the layer); Reopen puts it back; each is one undo step", () => {
    const e = boardEngine([{ id: "flight", name: "Bee flight", from: "bee", track: "the bee", motionPath: PLAN, durationSec: 2 }]);
    expect(step(e.getState().project)).toMatchObject({ state: "blocked", waitsFor: "bee" }); // no reference yet
    const t = mountStep(e);
    act(() => t.q('[data-testid="path-skip"]').click());
    expect(flight(e.getState().project).skipped).toBe(true);
    expect(step(e.getState().project).state).toBe("skipped");
    expect(t.q('[data-testid="path-state"]').textContent).toContain("Skipped · the 3 points planned are final");
    expect(t.onNote).toHaveBeenCalledWith("Bee flight: skipped · the 3 points planned are final");
    // The plan still moves the layer.
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: 4 * S }, { versionId: "o1" }));
    e.dispatch(cmd.sendStoryToTimeline());
    const text = Object.values(e.getState().project.compositions).flatMap((c) => c.tracks.flatMap((x) => x.placements)).find((x) => x.clipType === "text")!;
    expect(text.motionPath!.nodes).toHaveLength(3);
    e.undo(); e.undo();
    act(() => t.q('[data-testid="path-reopen"]').click());
    expect(flight(e.getState().project).skipped).toBeUndefined();
    expect(step(e.getState().project).state).toBe("blocked");
    e.undo();
    expect(flight(e.getState().project).skipped).toBe(true);
  });

  it("the JSON carries skipped (export → import), a made path is never skipped, and drawing clears it", () => {
    const r = validateStoryboard(doc([{ id: "flight", from: "bee", skipped: true }, { id: "p2", skipped: "yes" }, { id: "p3", motionPath: PLAN, createdBy: "draw", skipped: true }]));
    expect(r.ok).toBe(true);
    const d = (r as { doc: StoryDoc }).doc;
    expect(d.paths!.map((x) => [x.id, x.skipped])).toEqual([["flight", true], ["p2", undefined], ["p3", undefined]]);
    expect(r.warnings.some((w) => w.path === "paths[1].skipped")).toBe(true);
    expect(r.warnings.some((w) => w.path === "paths[0]")).toBe(false); // skipped: no "asks to draw it" warning
    const back = storyboardToDoc(storyboardFromDoc(d));
    expect(back.paths![0]).toMatchObject({ id: "flight", skipped: true });
    const p = d.paths![0];
    expect(storyPaths.withPathSkipped(p, false).skipped).toBeUndefined();
    expect(storyPaths.withPathSkipped({ ...p, skipped: undefined, createdBy: "draw" }, true).skipped).toBeUndefined();
  });

  it("set_story_path skipped true / false; left out it is kept", () => {
    const ctx = { guide: () => "" };
    const r = validateStoryboard(doc([{ id: "flight", name: "Bee flight", from: "bee", motionPath: PLAN }]));
    let d = storyboardToDoc(storyboardFromDoc((r as { doc: StoryDoc }).doc));
    const sk = runStoryTool("set_story_path", { path: { id: "flight", name: "Bee flight", from: "bee", skipped: true } }, d, ctx);
    expect(sk.ok).toBe(true);
    d = storyboardToDoc(storyboardFromDoc(sk.doc!));
    expect(d.paths![0].skipped).toBe(true);
    const ren = runStoryTool("set_story_path", { path: { id: "flight", name: "Bee route", from: "bee" } }, d, ctx);
    d = storyboardToDoc(storyboardFromDoc(ren.doc!));
    expect([d.paths![0].name, d.paths![0].skipped]).toEqual(["Bee route", true]);
    const re = runStoryTool("set_story_path", { path: { id: "flight", from: "bee", skipped: false } }, d, ctx);
    expect(re.doc!.paths![0].skipped).toBeUndefined();
  });
});

describe("P90 references", () => {
  it("an image reference hides Track with a reason; Draw shows the picture under the points", async () => {
    const e = boardEngine([{ id: "flight", name: "Logo swoop", from: "logo" }]);
    e.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "kimg", mime: "image/png", width: 400, height: 400 }, { versionId: "g1" }));
    expect(step(e.getState().project).state).toBe("todo");
    const t = mountStep(e);
    expect(t.q('[data-testid="path-track"]')).toBeNull();
    expect(t.q('[data-testid="path-no-track"]').textContent).toContain("“Logo” is a still picture, so nothing in it moves to be tracked. Draw the path over it instead");
    expect(t.q('[data-testid="path-draw"]').textContent).toContain("Draw over reference");
    act(() => t.q('[data-testid="path-draw"]').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const img = t.q('[data-testid="path-draw-sheet"] img.v2-pathdraw-frame') as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:kimg");
    expect(t.q(".v2-pathdraw-sub").textContent).toContain("over the reference");
    expect(board.productionSteps(e.getState().project).find((s) => s.key === "path:flight")).toBeTruthy();
  });

  it("several reference versions: pick which one to track / draw over (the one in use by default)", async () => {
    const e = boardEngine([{ id: "flight", name: "Bee flight", from: "bee" }]);
    e.dispatch(cmd.addStoryVersion({ slot: "bee" }, { blobKey: "kv1", mime: "video/mp4", durationTicks: 2 * S, width: 1920, height: 1080 }, { versionId: "b1" }));
    e.dispatch(cmd.addStoryVersion({ slot: "bee" }, { blobKey: "kv2", mime: "video/mp4", durationTicks: 3 * S, width: 1920, height: 1080 }, { versionId: "b2" }));
    const inUse = board.selectedOf(e.getState().project, e.getState().project.storyboard!.slots.bee);
    const t = mountStep(e);
    const sel = t.q('[data-testid="path-ref-version"]') as HTMLSelectElement;
    expect(sel.options).toHaveLength(2);
    expect(sel.value).toBe(inUse);
    expect([...sel.options].find((o) => o.value === inUse)!.textContent).toContain("in use");
    const other = inUse === "b1" ? "b2" : "b1";
    act(() => { sel.value = other; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    act(() => t.q('[data-testid="path-track"]').click());
    const n = other === "b1" ? 1 : 2;
    expect(t.q(`[role="dialog"][aria-label="Track for path Bee flight · v${n}"]`)).toBeTruthy();
    act(() => (t.q(".v2-modal-back") as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    getKeys.length = 0;
    act(() => t.q('[data-testid="path-draw"]').click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(getKeys).toContain(other === "b1" ? "kv1" : "kv2");
    expect(t.q(".v2-pathdraw-sub").textContent).toContain(`over the reference · v${n}`);
  });
});

describe("P90 go to an exact time", () => {
  it("parses timecodes, seconds and frames, snapped to the frame start", () => {
    expect(parseTimecode("00:02:15", 30)).toBe(2.5 * S);
    expect(parseTimecode("1:02.5", 30)).toBe(62.5 * S);
    expect(parseTimecode("2.5s", 30)).toBe(2.5 * S);
    expect(parseTimecode("45f", 30)).toBe(1.5 * S);
    expect(parseTimecode("0.51", 30)).toBe(0.5 * S); // nearest frame
    expect(parseTimecode("00:61:00", 30)).toBeUndefined();
    expect(parseTimecode("00:01:30", 30)).toBeUndefined(); // frame 30 of 30 fps
    expect(parseTimecode("soon", 30)).toBeUndefined();
  });

  it("the phone sheet: type a time, ± one frame, ± one second, and a bad time says how to type it", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); mounted.push(root);
    let time = 0;
    const onSeek = vi.fn((t: number) => { time = t; render(); });
    const render = () => act(() => { root.render(<GoToTimeSheet time={time} duration={4 * S} fps={30} onSeek={onSeek} onClose={() => undefined} />); });
    render();
    const input = el.querySelector('[data-testid="goto-time"]') as HTMLInputElement;
    const type = (v: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    type("00:02:15");
    act(() => (el.querySelector('[data-testid="goto-go"]') as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenLastCalledWith(2.5 * S);
    expect(el.querySelector('[data-testid="goto-frame"]')!.textContent).toBe("Frame 76 of 120");
    act(() => (el.querySelector('[aria-label="Next frame"]') as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenLastCalledWith(2.5 * S + S / 30);
    act(() => (el.querySelector('[aria-label="Back one second"]') as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenLastCalledWith(1.5 * S + S / 30);
    type("99:00:00");
    act(() => (el.querySelector('[data-testid="goto-go"]') as HTMLButtonElement).click());
    expect(onSeek).toHaveBeenLastCalledWith(119 * (S / 30)); // clamped to the last frame
    type("later");
    act(() => (el.querySelector('[data-testid="goto-go"]') as HTMLButtonElement).click());
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("00:01:15");
  });
});
