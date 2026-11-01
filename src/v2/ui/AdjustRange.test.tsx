// @vitest-environment jsdom
/** P26: Adjust range (slip) + Replace asset sheet — phone (bottom sheet) and desktop (side panel) hosts. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, findPlacement, ops, sourceAt, slip, type Asset, type Project } from "../domain";
import { cmd, Engine } from "../engine";
import { secondsToTicks as s } from "../domain/time";
import { useEngineState } from "./useEditor";
import { AdjustRange, canAdjustRange } from "./AdjustRange";
import { Sheet } from "./Sheet";
import type { BlobStore } from "../ports";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
});
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

const asset = (id: string, sec: number | undefined, kind: Asset["kind"] = "video"): Asset => ({ id, kind, name: `${id}.mp4`, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "x", ...(sec ? { durationTicks: s(sec) } : {}) }, provenance: { source: "import", inputs: [] } }] });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const pl = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement;
const blobs = { get: () => Promise.resolve(undefined), put: () => Promise.resolve() } as unknown as BlobStore;
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", 10)), cmd.importAsset(asset("w", 2)), cmd.importAsset(asset("x", 8))]);
  const main = ops.mainTrack(root(e.getState().project))!.id;
  e.dispatch(cmd.addAssetToTimeline("v", 0, main, "A"));
  e.dispatch(cmd.trimPlacement("A", "right", s(3)));
  e.dispatch(cmd.slipClip("A", s(3)));
  return e;
}
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const btn = (el: ParentNode, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;
const typeIn = (input: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };
const ptr = (el: Element, type: string, x: number) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x }));

type Host = "phone" | "desktop";
async function mount(e: Engine, host: Host, opts: { picker?: boolean; id?: string } = {}) {
  const done: (string | undefined)[] = [];
  const el = document.createElement("div"); el.className = `v2-app ${host === "phone" ? "is-mobile" : "is-desktop"}`; document.body.appendChild(el);
  const r = createRoot(el); roots.push(r);
  function App() {
    const { project } = useEngineState(e);
    const body = <AdjustRange engine={e} project={project} clipId={opts.id ?? "A"} blobs={blobs} peaks={{}} strips={{}} startInPicker={opts.picker} onDone={(m) => done.push(m)} />;
    return host === "phone" ? <Sheet label="Adjust range" onClose={() => undefined}>{body}</Sheet> : <aside className="v2-slip-panel">{body}</aside>;
  }
  await act(async () => r.render(<App />));
  await act(() => wait());
  return { el, done };
}
const text = (el: ParentNode, id: string) => el.querySelector(`[data-testid="${id}"]`)!.textContent;

for (const host of ["phone", "desktop"] as Host[]) {
  describe(`P26 Adjust range (${host})`, () => {
    it("dragging the window box slips the draft; Apply is one undo step and keeps start and length", async () => {
      const e = setup(), { el, done } = await mount(e, host);
      expect(text(el, "slip-in")).toBe("3.00 s"); expect(text(el, "slip-out")).toBe("6.00 s");
      const box = el.querySelector('[data-testid="slip-box"]')!, bar = el.querySelector('[data-testid="slip-bar"]')!;
      // 320 px for 10 s → 32 px = 1 s.
      await act(async () => { ptr(box, "pointerdown", 100); ptr(bar, "pointermove", 132); ptr(bar, "pointerup", 132); });
      expect(text(el, "slip-in")).toBe("4.00 s"); expect(text(el, "slip-out")).toBe("7.00 s"); expect(text(el, "slip-delta")).toBe("+1.00 s");
      expect(pl(e, "A").sourceInTicks).toBe(s(3)); // draft only
      await act(async () => btn(el, "Apply").click());
      expect(pl(e, "A")).toMatchObject({ startTicks: 0, durationTicks: s(3), sourceInTicks: s(4) });
      expect(done[0]).toMatch(/Range adjusted/);
      e.undo(); expect(pl(e, "A").sourceInTicks).toBe(s(3));
    });
    it("−/+ step one frame, the field sets exact seconds, Cancel changes nothing", async () => {
      const e = setup(), { el, done } = await mount(e, host);
      await act(async () => btn(el, "One frame later").click());
      expect(text(el, "slip-in")).toBe("3.03 s");
      await act(async () => typeIn(el.querySelector('[aria-label="Start in seconds"]') as HTMLInputElement, "6.5"));
      expect(text(el, "slip-in")).toBe("6.50 s");
      await act(async () => typeIn(el.querySelector('[aria-label="Start in seconds"]') as HTMLInputElement, "99"));
      expect(text(el, "slip-in")).toBe("7.00 s"); // clamped: 7 + 3 = 10 s of media
      await act(async () => btn(el, "Cancel").click());
      expect(pl(e, "A").sourceInTicks).toBe(s(3)); expect(done).toEqual([undefined]);
    });
    it("unlocked length: dragging an edge changes the clip length on Apply", async () => {
      const e = setup(), { el } = await mount(e, host);
      const lock = [...el.querySelectorAll("label")].find((l) => l.textContent?.includes("Lock clip length"))!.querySelector("input")!;
      await act(async () => lock.click());
      const edge = el.querySelector(".v2-slip-edge.is-r")!, bar = el.querySelector('[data-testid="slip-bar"]')!;
      await act(async () => { ptr(edge, "pointerdown", 200); ptr(bar, "pointermove", 232); ptr(bar, "pointerup", 232); });
      expect(text(el, "slip-out")).toBe("7.00 s");
      await act(async () => btn(el, "Apply").click());
      expect(pl(e, "A")).toMatchObject({ startTicks: 0, sourceInTicks: s(3), durationTicks: s(4) });
    });
    it("Replace asset: same-kind picker, short-source warning, Keep length holds the last frame — one undo step", async () => {
      const e = setup(), { el } = await mount(e, host, { picker: true });
      const names = [...el.querySelectorAll(".v2-slip-asset-name")].map((n) => n.textContent);
      expect(names).toEqual(["w.mp4", "x.mp4"]);
      await act(async () => btn(el, "Use w.mp4").click());
      expect(el.querySelector('[role="alertdialog"]')!.textContent).toContain("shorter than the clip");
      expect(btn(el, "Apply").disabled).toBe(true);
      await act(async () => btn(el, "Keep length (freeze last frame)").click());
      await act(async () => btn(el, "Apply").click());
      const p = pl(e, "A");
      expect(p).toMatchObject({ durationTicks: s(3), sourceInTicks: 0, source: { assetId: "w" } });
      expect(sourceAt(p, s(2.9))).toBe(slip.holdPoint(s(2)));
      e.undo(); expect(pl(e, "A")).toMatchObject({ source: { assetId: "v" }, sourceInTicks: s(3) });
    });
    it("Replace then adjust the range, then Apply: one undo step; Shorten clip ends with the source", async () => {
      const e = setup(), { el } = await mount(e, host, { picker: true });
      await act(async () => btn(el, "Use x.mp4").click());
      expect(text(el, "slip-in")).toBe("3.00 s"); // original in point kept (3 + 3 ≤ 8)
      await act(async () => btn(el, "One frame later").click());
      await act(async () => btn(el, "Apply").click());
      expect(pl(e, "A").source.assetId).toBe("x"); expect(pl(e, "A").sourceInTicks).toBeGreaterThan(s(3));
      e.undo(); expect(pl(e, "A")).toMatchObject({ source: { assetId: "v" }, sourceInTicks: s(3) });
      await act(async () => btn(el, "Cancel").click());
    });
  });
}

describe("P26 Adjust range: linked clips and HTML", () => {
  it("offers Move linked audio/overlays too and keeps a linked audio clip in sync", async () => {
    const e = setup();
    e.dispatch(cmd.importAsset(asset("au", 10, "audio")));
    const tr = root(e.getState().project).tracks.find((t) => t.kind === "audio")?.id;
    e.dispatch(cmd.addAssetToTimeline("au", s(1), tr, "AU"));
    e.dispatch(cmd.trimPlacement("AU", "right", s(2)));
    e.dispatch(cmd.setClipLink("AU", true));
    expect(pl(e, "AU").link?.parent).toBe("A");
    const { el } = await mount(e, "desktop");
    const cb = [...el.querySelectorAll("label")].find((l) => l.textContent?.includes("Move linked audio/overlays too"))!.querySelector("input")!;
    expect(cb.checked).toBe(true);
    await act(async () => typeIn(el.querySelector('[aria-label="Start in seconds"]') as HTMLInputElement, "5"));
    await act(async () => btn(el, "Apply").click());
    expect(pl(e, "AU")).toMatchObject({ startTicks: s(1), sourceInTicks: s(2) });
  });
  it("HTML clips slip their offset live (one undo step) and Cancel undoes it; images have no Adjust range", async () => {
    const e = new Engine(createProject("t"));
    e.dispatch([cmd.importAsset(asset("h", undefined, "html")), cmd.importAsset(asset("i", undefined, "image"))]);
    const main = ops.mainTrack(root(e.getState().project))!.id;
    e.dispatch(cmd.addAssetToTimeline("h", 0, main, "H"));
    e.dispatch(cmd.addAssetToTimeline("i", s(30), main, "I"));
    expect(canAdjustRange(pl(e, "I"))).toBe(false);
    const { el } = await mount(e, "phone", { id: "H" });
    const input = el.querySelector('[aria-label="Start in seconds"]') as HTMLInputElement;
    await act(async () => typeIn(input, "1"));
    await act(async () => typeIn(input, "2"));
    expect(pl(e, "H").sourceInTicks).toBe(s(2));
    await act(async () => btn(el, "Cancel").click());
    expect(pl(e, "H").sourceInTicks).toBe(0);
    expect(e.getState().canUndo).toBe(true); // the two adds remain
  });
});
