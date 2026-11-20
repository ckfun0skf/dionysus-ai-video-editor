// @vitest-environment jsdom
/** P90: the Motion path editing view — one view transform for zoom and pan; targets stay 44 px; fit / reset. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, findPlacement, type Placement } from "../domain";
import { cmd, Engine } from "../engine";
import { clampView, FIT, MotionPathOverlay, panBy, useMotionKeys, useMotionSession, viewBox, zoomAt, type MotionApi } from "./MotionPathEditor";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  if (typeof PointerEvent === "undefined") {
    class PE extends MouseEvent { pointerId = 1; constructor(t: string, i?: MouseEventInit & { pointerId?: number }) { super(t, i); this.pointerId = i?.pointerId ?? 1; } }
    (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PE as unknown as typeof MouseEvent;
  }
});
const mounted: { unmount: () => void }[] = [];
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()); document.body.innerHTML = ""; });

const BASE = { left: 0, top: 0, width: 320, height: 180 };

describe("P90 view math", () => {
  it("zooms about a point, pans, and clamps so the frame always covers its box", () => {
    expect(viewBox(BASE, FIT)).toEqual(BASE);
    const z = zoomAt(FIT, BASE, 2, 80, 45); // the point (80, 45) stays put
    const b = viewBox(BASE, z);
    expect((80 - b.left) / b.width).toBeCloseTo(80 / 320, 6);
    expect((45 - b.top) / b.height).toBeCloseTo(45 / 180, 6);
    expect(panBy(z, BASE, 1000, -1000)).toEqual({ z: 2, tx: 160, ty: -90 }); // clamped: no empty margin
    expect(clampView({ z: 0.5, tx: 30, ty: 0 }, BASE)).toEqual(FIT);
    expect(clampView({ z: 20, tx: 0, ty: 0 }, BASE).z).toBe(8);
  });
});

/** A frame whose client rect follows the CSS transform the overlay puts on it (like a browser). */
function mount() {
  const e = new Engine(createProject("v"));
  e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "t1"));
  const pl = () => findPlacement(e.getState().project.compositions[e.getState().project.rootCompositionId], "t1")!.placement;
  const wrap = document.createElement("div"); const canvas = document.createElement("canvas"); wrap.appendChild(canvas); document.body.appendChild(wrap);
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 180, right: 320, bottom: 180, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  canvas.getBoundingClientRect = () => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/.exec(canvas.style.transform);
    const v = m ? { tx: +m[1], ty: +m[2], z: +m[3] } : FIT;
    const r = viewBox(BASE, v);
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
  };
  const onSpaceTap = vi.fn();
  const apiRef: { current?: MotionApi } = {};
  function Harness() {
    const api = useMotionSession(e, () => undefined, () => undefined);
    useMotionKeys(api, { onSpaceTap });
    apiRef.current = api;
    const p: Placement = pl();
    return <div>{api.session && <MotionPathOverlay canvas={canvas} placement={p} path={api.session.draft} offset={0} aspect={16 / 9} api={api} />}</div>;
  }
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el); mounted.push(root);
  act(() => { root.render(<Harness />); });
  act(() => apiRef.current!.start(pl()));
  const svg = () => el.querySelector('[data-testid="motion-path-editor"]') as SVGSVGElement;
  const ptr = (type: string, x: number, y: number, o: PointerEventInit = {}) => act(() => { svg().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, ...o })); });
  const tap = (x: number, y: number) => { ptr("pointerdown", x, y); ptr("pointerup", x, y); };
  const key = (type: "keydown" | "keyup", k: string) => act(() => { window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })); });
  const view = () => apiRef.current!.session!.view;
  const btn = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  return { el, canvas, svg, ptr, tap, key, view, btn, api: () => apiRef.current!, onSpaceTap };
}

describe("P90 editing view", () => {
  it("⌘/Ctrl + wheel zooms about the pointer; the frame gets the transform; a point added while zoomed lands under the pointer with a 44 px target", () => {
    const t = mount();
    act(() => { t.svg().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200, ctrlKey: true, clientX: 80, clientY: 45 })); });
    expect(t.view().z).toBeCloseTo(Math.exp(0.3), 6);
    expect(t.canvas.style.transform).toMatch(/scale\(/);
    // (80, 45) is still the frame point (-0.25, -0.25).
    t.tap(80, 45);
    const n = t.api().session!.draft.nodes[0];
    expect([n.x, n.y]).toEqual([-0.25, -0.25]);
    const hit = t.el.querySelector('[data-mp="node"]')!;
    expect(hit.getAttribute("r")).toBe("22"); // same target at any zoom
  });

  it("the plain wheel pans once zoomed; a drag on an empty area pans with Add point off; double-tap fits", () => {
    const t = mount();
    act(() => t.api().setAdd(false));
    act(() => t.api().setView(zoomAt(FIT, BASE, 2, 160, 90)));
    expect(t.view()).toEqual({ z: 2, tx: 0, ty: 0 });
    act(() => { t.svg().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40, clientX: 160, clientY: 90 })); });
    expect(t.view()).toEqual({ z: 2, tx: 0, ty: -40 });
    t.ptr("pointerdown", 100, 100); t.ptr("pointermove", 130, 110); t.ptr("pointerup", 130, 110);
    expect(t.view()).toEqual({ z: 2, tx: 30, ty: -30 });
    expect(t.api().session!.draft.nodes).toHaveLength(0); // a pan adds nothing
    t.tap(50, 50); t.tap(50, 50);
    expect(t.view()).toEqual(FIT);
    t.tap(50, 50); t.tap(50, 50); // at fit a double tap zooms in there
    expect(t.view().z).toBe(2.5);
  });

  it("Space held is the hand (drag pans, no play); a Space tap still plays; 0 fits, + / − zoom", () => {
    const t = mount();
    t.key("keydown", "+");
    expect(t.view().z).toBeCloseTo(1.25, 6);
    t.key("keydown", " ");
    expect(t.svg().classList.contains("is-hand")).toBe(true);
    t.ptr("pointerdown", 100, 100); t.ptr("pointermove", 90, 100); t.ptr("pointerup", 90, 100);
    expect(t.view().tx).toBe(-10);
    expect(t.api().session!.draft.nodes).toHaveLength(0); // the hand never adds a point
    t.key("keyup", " ");
    expect(t.onSpaceTap).not.toHaveBeenCalled();
    t.key("keydown", " "); t.key("keyup", " ");
    expect(t.onSpaceTap).toHaveBeenCalledTimes(1);
    t.key("keydown", "0");
    expect(t.view()).toEqual(FIT);
    t.key("keydown", "-");
    expect(t.view()).toEqual(FIT);
  });

  it("the zoom control: − / exact % / + / Fit (44 px buttons)", () => {
    const t = mount();
    expect(t.btn("Zoom out").disabled).toBe(true);
    expect(t.btn("Fit").disabled).toBe(true);
    act(() => t.btn("Zoom in").click());
    expect(t.view().z).toBeCloseTo(1.25, 6);
    const field = t.el.querySelector('input[aria-label="Zoom percent"]') as HTMLInputElement;
    expect(field.value).toBe("125");
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "300"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(t.view().z).toBeCloseTo(3, 6);
    act(() => t.btn("Fit").click());
    expect(t.view()).toEqual(FIT);
    expect(t.canvas.style.transform).toBe("");
  });

  it("two fingers zoom and pan; a point drag in progress is undone", () => {
    const t = mount();
    t.ptr("pointerdown", 100, 90, { pointerId: 1 }); t.ptr("pointerdown", 220, 90, { pointerId: 2 });
    t.ptr("pointermove", 80, 100, { pointerId: 1 }); t.ptr("pointermove", 320, 100, { pointerId: 2 });
    expect(t.view().z).toBeCloseTo(2, 6);
    t.ptr("pointerup", 80, 100, { pointerId: 1 }); t.ptr("pointerup", 320, 100, { pointerId: 2 });
    // The first finger had already added a point (Add point is on); the pinch removed it again.
    expect(t.api().session!.draft.nodes).toHaveLength(0);
  });
});
