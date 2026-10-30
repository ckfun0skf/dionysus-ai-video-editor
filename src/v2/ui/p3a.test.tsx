// @vitest-environment jsdom
/** P3A UI: in/out frame fields (24), Match frames panel (23), frame scoring and trim-to-playhead keys (15). */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, findPlacement, ops, type Asset, type Placement, type Project } from "../domain";
import { cmd, Engine } from "../engine";
import { secondsToTicks as s, TICKS_PER_SECOND } from "../domain/time";
import { useEngineState } from "./useEditor";
import { ClipFrames } from "./ClipFrames";
import { MatchFrames, type Analyse } from "./MatchFrames";
import { lumaOf, mad, sampleTicks, similarity, ssim, topMatches, SCORE_W, SCORE_H, type Frame } from "./frameMatch";
import { V2App } from "./V2App";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
});
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; localStorage.clear(); });

const F = TICKS_PER_SECOND / 30;
const asset = (id: string, sec: number): Asset => ({ id, kind: "video", name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "video/mp4", durationTicks: s(sec) }, provenance: { source: "import", inputs: [] } }] });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const pl = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement;
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", 10)), cmd.importAsset(asset("w", 6))]);
  const main = ops.mainTrack(root(e.getState().project))!.id;
  e.dispatch(cmd.addAssetToTimeline("v", 0, main, "A"));
  e.dispatch(cmd.addAssetToTimeline("w", s(10), main, "B"));
  return e;
}
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const btn = (el: ParentNode, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;
const typeIn = (input: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };
async function mount(node: () => JSX.Element) {
  const el = document.createElement("div"); el.className = "v2-app"; document.body.appendChild(el);
  const r = createRoot(el); roots.push(r);
  function Host() { return node(); }
  await act(async () => r.render(<Host />));
  await act(() => wait());
  return el;
}

describe("P3A-24 ClipFrames", () => {
  it("shows in/out frame numbers and timecodes; ± steps one frame and typing sets a frame, each undoable", async () => {
    const e = setup();
    const el = await mount(() => { const { project } = useEngineState(e); return <ClipFrames engine={e} project={project} placement={findPlacement(root(project), "A")!.placement} />; });
    const num = (l: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${l} frame number"]`)!;
    const tc = (l: string) => el.querySelector(`output[aria-label="${l} timecode"]`)!.textContent;
    expect([num("In").value, num("Out").value, tc("In"), tc("Out")]).toEqual(["0", "299", "00:00:00", "00:09:29"]);
    await act(async () => btn(el, "In one frame later").click());
    expect(pl(e, "A")).toMatchObject({ startTicks: 0, sourceInTicks: F, durationTicks: 299 * F });
    expect(num("In").value).toBe("1");
    await act(async () => { typeIn(num("Out"), "149"); num("Out").dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(pl(e, "A")).toMatchObject({ sourceInTicks: F, durationTicks: 149 * F });
    expect(tc("Out")).toBe("00:04:29");
    expect(el.textContent).toContain("149 frames at 30 fps");
    await act(async () => { e.undo(); });
    expect(pl(e, "A").durationTicks).toBe(299 * F);
    el.querySelectorAll<HTMLButtonElement>(".v2-frames-row .v2-btn").forEach((b) => expect(b.className).toContain("v2-btn"));
  });
});

describe("P3A-23 frame scoring", () => {
  const flat = (v: number) => new Float32Array(SCORE_W * SCORE_H).fill(v);
  const grad = (off = 0) => Float32Array.from({ length: SCORE_W * SCORE_H }, (_, i) => ((i % SCORE_W) * 8 + off) % 256);
  it("scores identical frames 1 and different frames lower", () => {
    expect(ssim(grad(), grad())).toBeCloseTo(1, 5);
    expect(mad(flat(10), flat(30))).toBe(20);
    expect(similarity(grad(), grad())).toBeCloseTo(1, 5);
    expect(similarity(grad(), grad(40))).toBeLessThan(similarity(grad(), grad(4)));
    expect(lumaOf([255, 255, 255, 255, 0, 0, 0, 255], 2, 1)[0]).toBeCloseTo(255, 3);
  });
  it("ranks the matching pair first and keeps candidates apart", () => {
    const fr = (t: number, l: Float32Array): Frame => ({ ticks: t, luma: l });
    const a = [fr(0, grad(100)), fr(F * 3, grad(20)), fr(F * 6, grad(60))];
    const b = [fr(0, grad(200)), fr(F * 3, grad(22)), fr(F * 6, grad(150))];
    const top = topMatches(a, b, 3, F * 2);
    expect(top[0]).toMatchObject({ aTicks: F * 3, bTicks: F * 3 });
    expect(top[0].score).toBeGreaterThan(top[1].score);
    expect(new Set(top.map((c) => `${c.aTicks}-${c.bTicks}`)).size).toBe(top.length);
  });
  it("samples frame-aligned times ~10 per second, always including the last frame", () => {
    const t = sampleTicks(s(8), s(10), 30);
    expect(t.length).toBe(20);
    expect(t[t.length - 1]).toBe(s(10) - F);
    expect(t.every((x) => Number.isInteger(x / F))).toBe(true);
  });
});

describe("P3A-23 MatchFrames panel", () => {
  it("shows candidate pairs side by side with scores; Apply sets A's out and B's in; Auto-apply best uses the top pair", async () => {
    const e = setup();
    const analyse: Analyse = async () => [
      { aTicks: s(9), bTicks: s(0.5), score: 0.93, aThumb: "data:a", bThumb: "data:b" },
      { aTicks: s(8.5), bTicks: s(1), score: 0.81 },
    ];
    let done = "";
    const el = await mount(() => { const { project } = useEngineState(e); const c = root(project); return <MatchFrames engine={e} project={project} a={findPlacement(c, "A")!.placement} b={findPlacement(c, "B")!.placement} analyse={analyse} onDone={(m) => { done = m ?? ""; }} />; });
    await act(() => wait());
    const cands = el.querySelectorAll('[role="radio"]');
    expect(cands.length).toBe(2);
    expect(cands[0].textContent).toContain("93%");
    expect(cands[0].querySelectorAll("img").length).toBe(2);
    expect(cands[0].textContent).toContain("A out 270 · 00:09:00");
    await act(async () => (cands[1] as HTMLElement).click());
    await act(async () => btn(el, "Apply pair 2").click());
    expect(pl(e, "A").durationTicks).toBe(s(8.5) + F);
    expect(pl(e, "B")).toMatchObject({ startTicks: s(8.5) + F, sourceInTicks: s(1) });
    expect(done).toContain("81%");
    await act(async () => { e.undo(); });
    await act(async () => btn(el, "Auto-apply best").click());
    expect(pl(e, "B")).toMatchObject({ startTicks: s(9) + F, sourceInTicks: s(0.5) });
  });
  it("reports a read error instead of hanging", async () => {
    const e = setup();
    const el = await mount(() => { const { project } = useEngineState(e); const c = root(project); return <MatchFrames engine={e} project={project} a={findPlacement(c, "A")!.placement as Placement} b={findPlacement(c, "B")!.placement} analyse={async () => { throw new Error("The video files for these clips are not on this device"); }} onDone={() => {}} />; });
    await act(() => wait());
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("not on this device");
  });
});

describe("P3A-15 trim to playhead (desktop)", () => {
  it("toolbar buttons with labels, Q/W shortcuts, undoable", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const r = createRoot(el); roots.push(r);
    await act(async () => { r.render(<V2App />); });
    await act(() => wait(20));
    expect(btn(el, "Trim start to playhead").textContent).toBe("Trim start");
    expect(btn(el, "Trim end to playhead").textContent).toBe("Trim end");
    // A code clip at the playhead gives something to trim.
    await act(async () => (el.querySelector('.v2-abtabs [title="Code"]') as HTMLElement).click());
    await act(async () => btn(el, "Create").click());
    await act(async () => btn(el.querySelector('[aria-label="Code editor"]')!, "Add to timeline").click());
    await act(() => wait(50));
    const clip = () => el.querySelector<HTMLElement>(".v2-clip")!;
    const geo = () => [clip().style.left, clip().style.width];
    const start = geo();
    const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
    for (let i = 0; i < 30; i += 1) await key("ArrowRight");
    await key("w");
    const afterW = geo();
    expect(afterW[1]).not.toBe(start[1]);
    await key("q");
    expect(geo()).toEqual(afterW); // playhead is at the new end: nothing left to trim from the start
    await act(async () => btn(el, "Undo").click());
    expect(geo()).toEqual(start);
  });
});
