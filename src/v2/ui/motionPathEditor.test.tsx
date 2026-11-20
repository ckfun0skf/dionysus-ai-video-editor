// @vitest-environment jsdom
/** P89: Motion path mode — points by click, ✓ = one undo step, ✕ / Esc discard, session undo, Delete, inspector, gizmo routing. */
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, findPlacement, motion, secondsToTicks as s, type Placement } from "../domain";
import { cmd, Engine } from "../engine";
import { MotionPathBar, MotionPathOverlay, MotionPathSection, shownPath, useMotionKeys, useMotionSession, type MotionApi } from "./MotionPathEditor";
import { applyPatch, valuesAt } from "./Transform";

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
const rect = (w: number, h: number) => () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
function mount(keys = false) {
  const e = new Engine(createProject("m"));
  e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "t1"));
  if (keys) { e.dispatch(cmd.setKeyframe("t1", "x", 0, -0.3)); e.dispatch(cmd.setKeyframe("t1", "x", s(2), 0.3)); }
  const pl = () => findPlacement(e.getState().project.compositions[e.getState().project.rootCompositionId], "t1")!.placement;
  const wrap = document.createElement("div"); const canvas = document.createElement("canvas"); wrap.appendChild(canvas); document.body.appendChild(wrap);
  canvas.getBoundingClientRect = rect(320, 180); wrap.getBoundingClientRect = rect(320, 180);
  const onPreview = vi.fn(), onToast = vi.fn();
  const apiRef: { current?: MotionApi } = {};
  function Harness() {
    const api = useMotionSession(e, onPreview, onToast);
    useMotionKeys(api);
    const r = useRef(api); r.current = api; apiRef.current = api;
    const p: Placement = pl();
    return <div>
      {api.session && <MotionPathOverlay canvas={canvas} placement={p} path={api.session.draft} offset={0} aspect={16 / 9} api={api} />}
      {api.session && <MotionPathBar api={api} placement={p} aspect={16 / 9} offset={0} onSeekOffset={() => undefined} name="Hi" />}
      <MotionPathSection engine={e} placement={p} api={api} aspect={16 / 9} onStart={() => api.start(p)} />
    </div>;
  }
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  mounted.push(root);
  const render = () => act(() => { root.render(<Harness />); });
  render();
  const svg = () => el.querySelector('[data-testid="motion-path-editor"]') as SVGSVGElement;
  const tap = (x: number, y: number, target?: Element) => {
    const t = target ?? svg();
    act(() => { t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); });
    act(() => { t.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); });
  };
  const click = (sel: string) => act(() => { (el.querySelector(sel) as HTMLElement).click(); });
  const key = (k: string, o: KeyboardEventInit = {}) => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o })); });
  return { e, el, pl, svg, tap, click, key, api: () => apiRef.current!, onPreview, onToast, render, root };
}

describe("Motion path mode", () => {
  it("adds points by click (spread over the clip at even speed), previews the draft, and ✓ commits ONE undo step", () => {
    const t = mount();
    t.click('[data-testid="mp-edit"]');
    expect(t.svg()).toBeTruthy();
    expect(t.el.querySelector('[data-testid="mp-add"]')!.getAttribute("aria-pressed")).toBe("true");
    t.tap(40, 120); t.tap(160, 40); t.tap(280, 120);
    const d = t.api().session!.draft;
    expect(d.nodes.map((n) => [n.x, n.y])).toEqual([[-0.375, 0.1667], [0, -0.2778], [0.375, 0.1667]]);
    expect(d.constantSpeed).toBe(true);
    expect(d.nodes[0].t).toBe(0);
    expect(d.nodes[2].t).toBe(t.pl().durationTicks);
    expect(t.pl().motionPath).toBeUndefined(); // still a draft
    expect(t.onPreview).toHaveBeenLastCalledWith({ id: "t1", path: d });
    expect(t.el.querySelectorAll('[data-mp="node"]')).toHaveLength(3);
    expect(t.el.querySelector('[data-mp="node"]')!.getAttribute("r")).toBe("22"); // 44px target
    t.click('[data-testid="mp-done"]');
    expect(t.pl().motionPath!.nodes).toHaveLength(3);
    expect(t.onToast).toHaveBeenCalledWith("Motion path saved (3 points)");
    expect(t.onPreview).toHaveBeenLastCalledWith(null);
    expect(t.e.undo()).toBe(true);
    expect(t.pl().motionPath).toBeUndefined();
    expect(t.e.undo()).toBe(true); // the next step back is adding the text clip: the session was one step
    expect(findPlacement(t.e.getState().project.compositions[t.e.getState().project.rootCompositionId], "t1")).toBeUndefined();
  });

  it("✕ and Esc discard; inside the mode Delete removes the selected point and ⌘Z undoes that without touching the project", () => {
    const t = mount();
    t.click('[data-testid="mp-edit"]');
    t.tap(40, 120); t.tap(160, 40);
    t.click('[data-testid="mp-cancel"]');
    expect(t.svg()).toBeNull();
    expect(t.pl().motionPath).toBeUndefined();
    t.click('[data-testid="mp-edit"]');
    t.tap(40, 120); t.tap(160, 40); t.tap(280, 120);
    t.key("p"); // stop adding
    const second = t.el.querySelectorAll('[data-mp="node"]')[1];
    t.tap(160, 40, second);
    expect(t.api().session!.sel).toBe("n2");
    t.key("Delete");
    expect(t.api().session!.draft.nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
    t.key("z", { ctrlKey: true });
    expect(t.api().session!.draft.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    t.key("Escape");
    expect(t.api().session).toBeUndefined();
    expect(t.pl().motionPath).toBeUndefined();
    // The session's own steps never reached the project's history: one undo removes the text clip itself.
    expect(t.e.undo()).toBe(true);
    expect(findPlacement(t.e.getState().project.compositions[t.e.getState().project.rootCompositionId], "t1")).toBeUndefined();
  });

  it("clicking a segment inserts a point there; double-click toggles smooth / corner; Enter commits", () => {
    const t = mount();
    t.click('[data-testid="mp-edit"]');
    t.tap(40, 90); t.tap(280, 90);
    t.key("p");
    t.tap(160, 90); // on the straight segment
    const d = t.api().session!.draft;
    expect(d.nodes.map((n) => n.id)).toEqual(["n1", "n3", "n2"]);
    expect(d.nodes[1].x).toBeCloseTo(0, 3);
    const mid = t.el.querySelectorAll('[data-mp="node"]')[1];
    t.tap(160, 90, mid); t.tap(160, 90, t.el.querySelectorAll('[data-mp="node"]')[1]);
    expect(motion.isSmooth(t.api().session!.draft.nodes[1])).toBe(true);
    t.key("Enter");
    expect(t.pl().motionPath!.nodes).toHaveLength(3);
  });

  it("x / y keyframes show as a dashed path and become a motion path when edited", () => {
    const t = mount(true);
    expect(shownPath(t.pl())).toMatchObject({ fromKeys: true });
    expect(t.el.textContent).toMatch(/Moves by X \/ Y keyframes/);
    t.click('[data-testid="mp-edit"]');
    expect(t.api().session!.draft.nodes.map((n) => n.x)).toEqual([-0.3, 0.3]);
    t.click('[data-testid="mp-done"]'); // unchanged: nothing to commit
    expect(t.pl().motionPath).toBeUndefined();
    t.click('[data-testid="mp-edit"]');
    t.key("p"); t.tap(160, 90, t.el.querySelectorAll('[data-mp="node"]')[1]);
    t.click('[data-testid="mp-smooth"]');
    t.click('[data-testid="mp-done"]');
    expect(t.pl().motionPath!.nodes).toHaveLength(2);
    expect(t.pl().keyframes?.x).toBeUndefined();
  });

  it("the inspector's Orient switch is one undo step; the gizmo and X / Y fields move the path point at the playhead", () => {
    const t = mount();
    t.e.dispatch(cmd.setMotionPath("t1", { nodes: [{ id: "a", t: 0, x: -0.2, y: 0 }, { id: "b", t: s(2), x: 0.2, y: 0 }] }));
    t.render();
    const sw = [...t.el.querySelectorAll('button[role="switch"]')].find((b) => /Orient/.test(b.textContent ?? "")) as HTMLButtonElement;
    act(() => { sw.click(); });
    expect(t.pl().motionPath!.orient).toEqual({ offset: 0 });
    t.e.undo();
    expect(t.pl().motionPath!.orient).toBeUndefined();
    applyPatch(t.e, t.pl(), s(1), { x: 0.1, y: 0.3 });
    expect(t.pl().motionPath!.nodes.map((n) => [n.id, n.t, n.x, n.y])).toEqual([["a", 0, -0.2, 0], ["n3", s(1), 0.1, 0.3], ["b", s(2), 0.2, 0]]);
    expect(t.pl().keyframes?.x).toBeUndefined();
    expect(valuesAt(t.pl(), s(1))).toMatchObject({ x: 0.1, y: 0.3 });
    applyPatch(t.e, t.pl(), s(2), { x: 0.25 });
    expect(t.pl().motionPath!.nodes.find((n) => n.id === "b")!.x).toBe(0.25);
  });
});
