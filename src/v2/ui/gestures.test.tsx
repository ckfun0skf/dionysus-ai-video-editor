// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clampPps, classifyPreview, MAX_PPS, MIN_PPS, pinchZoom, TAP_SLOP } from "./gestures";
import { Timeline } from "./Timeline";
import { Engine } from "../engine";
import { createProject } from "../domain";

describe("gesture math", () => {
  it("pinch scales zoom by finger distance and clamps", () => {
    expect(pinchZoom(40, 100, 200)).toBe(80);
    expect(pinchZoom(40, 100, 50)).toBe(20);
    expect(pinchZoom(40, 100, 100000)).toBe(MAX_PPS);
    expect(pinchZoom(40, 0, 10)).toBe(40);
    expect(clampPps(0)).toBe(MIN_PPS);
  });
});

describe("Timeline touch gestures", () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
    Element.prototype.setPointerCapture = () => {};
  });
  afterEach(() => vi.useRealTimers());

  const mount = (selectedId?: string) => {
    const p = createProject();
    const comp = p.compositions[p.rootCompositionId];
    comp.tracks[0].placements.push({ id: "c1", startTicks: 0, durationTicks: 240000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video" });
    const engine = new Engine(p);
    const onSelect = vi.fn();
    const onZoom = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    act(() => { createRoot(el).render(<Timeline engine={engine} project={p} time={0} playing={false} onSeek={() => {}} selectedId={selectedId} onSelect={onSelect} pps={40} onZoom={onZoom} centered />); });
    return { el, onSelect, onZoom };
  };

  it("long-press on an unselected clip selects it and picks it up (haptic)", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const { el, onSelect } = mount();
    const clip = el.querySelector('[data-placement-id="c1"]')!;
    act(() => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(onSelect).toHaveBeenCalledWith("c1");
    expect(vibrate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(vibrate).toHaveBeenCalled();
  });

  it("moving before the long-press delay cancels it (it's a scroll)", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const { el } = mount();
    const clip = el.querySelector('[data-placement-id="c1"]')!;
    act(() => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 })); });
    act(() => { clip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 40, clientY: 10 })); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("ctrl+wheel zooms", () => {
    const { el, onZoom } = mount();
    const scroll = el.querySelector(".v2-scroll")!;
    act(() => { scroll.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true })); });
    expect(onZoom.mock.calls[0][0]).toBeGreaterThan(40);
  });
});

describe("V2-113 preview gesture classification", () => {
  const base = { fingers: 1, moved: 0, released: false, onOther: false, hasSelection: true };
  it("tells taps from drags by the 6px slop", () => {
    expect(classifyPreview(base)).toBe("pending");
    expect(classifyPreview({ ...base, moved: 5, released: true })).toBe("tap");
    expect(classifyPreview({ ...base, moved: TAP_SLOP + 1 })).toBe("move");
  });
  it("never moves the selection from another element or without one", () => {
    expect(classifyPreview({ ...base, moved: 20, onOther: true })).toBe("ignore");
    expect(classifyPreview({ ...base, moved: 20, hasSelection: false })).toBe("ignore");
    expect(classifyPreview({ ...base, released: true, onOther: true })).toBe("tap");
  });
  it("two fingers pinch the selection", () => {
    expect(classifyPreview({ ...base, fingers: 2 })).toBe("pinch");
    expect(classifyPreview({ ...base, fingers: 2, hasSelection: false })).toBe("ignore");
  });
});
