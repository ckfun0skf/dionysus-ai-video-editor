// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine";
import { createProject, findPlacement, transformOf, type Placement } from "../domain";
import type { Placed } from "../render";
import { TransformHandles, type GizmoActions } from "./Transform";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => vi.useRealTimers());

const box: Placed = { cx: 500, cy: 500, w: 20, h: 10, rot: 0, alpha: 1, sx: 0, sy: 0, sw: 20, sh: 10 };

function setup(extra: Partial<GizmoActions> = {}) {
  const p = createProject();
  const comp = p.compositions[p.rootCompositionId];
  const clip: Placement = { id: "v", startTicks: 0, durationTicks: 120000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "image" };
  comp.tracks[0].placements.push(clip);
  const engine = new Engine(p);
  const wrap = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.width = 1000; canvas.height = 1000;
  wrap.appendChild(canvas);
  const host = document.createElement("div");
  wrap.appendChild(host);
  document.body.appendChild(wrap);
  const actions: GizmoActions = { onDelete: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onDoubleTap: vi.fn(), onTap: vi.fn(), otherAt: () => undefined, ...extra };
  const root = createRoot(host);
  const current = () => { const s = engine.getState().project; return findPlacement(s.compositions[s.rootCompositionId], "v")!.placement; };
  const render = () => root.render(<TransformHandles engine={engine} placement={current()} time={0} box={box} canvas={canvas} actions={actions} snapping={false} />);
  engine.subscribe(render);
  const ev = (el: Element, type: string, id: number, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.assign(e, { pointerId: id });
    el.dispatchEvent(e);
  };
  const q = (s: string) => host.querySelector(`[data-testid="${s}"]`)!;
  return { engine, actions, render, current, ev, q };
}

describe("V2-113 preview gestures with a selection", () => {
  it("drags from anywhere on the preview to move the selection, as one undo step", async () => {
    const { engine, render, current, ev, q } = setup();
    await act(async () => render());
    await act(async () => {
      ev(q("preview-catch"), "pointerdown", 1, 100, 100);
      ev(q("preview-catch"), "pointermove", 1, 104, 100); // under the tap slop: no move yet
    });
    expect(current().transform).toBeUndefined();
    await act(async () => {
      ev(q("preview-catch"), "pointermove", 1, 200, 150);
      ev(q("preview-catch"), "pointerup", 1, 200, 150);
    });
    expect(transformOf(current()).x).toBeCloseTo(0.1); // 100 canvas px of 1000, measured from press start
    expect(transformOf(current()).y).toBeCloseTo(0.05);
    await act(async () => { engine.undo(); });
    expect(current().transform).toBeUndefined();
  });

  it("a short press is a tap (select / deselect), not a move", async () => {
    const { actions, render, current, ev, q } = setup();
    await act(async () => render());
    await act(async () => {
      ev(q("preview-catch"), "pointerdown", 1, 100, 100);
      ev(q("preview-catch"), "pointermove", 1, 103, 102);
      ev(q("preview-catch"), "pointerup", 1, 103, 102);
    });
    expect(actions.onTap).toHaveBeenCalledWith(103, 102, false);
    expect(current().transform).toBeUndefined();
  });

  it("a drag that starts on another element does not move the selection", async () => {
    const { actions, render, current, ev, q } = setup({ otherAt: () => "other" });
    await act(async () => render());
    await act(async () => {
      ev(q("preview-catch"), "pointerdown", 1, 100, 100);
      ev(q("preview-catch"), "pointermove", 1, 200, 200);
      ev(q("preview-catch"), "pointerup", 1, 200, 200);
    });
    expect(current().transform).toBeUndefined();
    expect(actions.onTap).not.toHaveBeenCalled();
  });

  it("two fingers anywhere pinch-scale and twist the selection in one undo step", async () => {
    const { engine, actions, render, current, ev, q } = setup();
    await act(async () => render());
    const c = q("preview-catch");
    await act(async () => {
      ev(c, "pointerdown", 1, 100, 100);
      ev(c, "pointerdown", 2, 200, 100);
      ev(c, "pointermove", 2, 300, 100); // distance 100 → 200
      ev(c, "pointermove", 1, 100, 100);
      ev(c, "pointerup", 1, 100, 100);
      ev(c, "pointerup", 2, 300, 100);
    });
    expect(transformOf(current()).scale).toBeCloseTo(2);
    expect(actions.onTap).not.toHaveBeenCalled();
    await act(async () => { engine.undo(); });
    expect(current().transform).toBeUndefined();
  });

  it("keeps a tiny element's frame at least 64px so its buttons never overlap", async () => {
    const { render, q } = setup();
    await act(async () => render());
    const s = (q("transform-box") as HTMLElement).style;
    expect(parseFloat(s.width)).toBeGreaterThanOrEqual(64);
    expect(parseFloat(s.height)).toBeGreaterThanOrEqual(64);
  });

  it("re-tapping the frame reports a gizmo tap after the double-tap window; a double tap edits instead", async () => {
    vi.useFakeTimers();
    const { actions, render, ev, q } = setup();
    await act(async () => render());
    const b = q("transform-body");
    await act(async () => { ev(b, "pointerdown", 1, 500, 500); ev(b, "pointerup", 1, 500, 500); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(actions.onTap).toHaveBeenCalledWith(500, 500, true);
    vi.mocked(actions.onTap!).mockClear();
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => { ev(b, "pointerdown", 1, 500, 500); ev(b, "pointerup", 1, 500, 500); ev(b, "pointerdown", 1, 500, 500); ev(b, "pointerup", 1, 500, 500); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(actions.onDoubleTap).toHaveBeenCalled();
    expect(actions.onTap).not.toHaveBeenCalled();
  });
});
