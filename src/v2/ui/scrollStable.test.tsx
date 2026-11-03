// @vitest-environment jsdom
/** P30-SCROLL: a user scroll must never be pulled back by state that lags behind it. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Timeline, USER_SCROLL_IDLE_MS } from "./Timeline";
import { Engine } from "../engine";
import { createProject } from "../domain";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
});

describe("Timeline scroll stays monotonic (P30-SCROLL)", () => {
  it("touch drag + momentum with lagging time and unrelated re-renders never jumps backwards", () => {
    vi.useFakeTimers();
    const p = createProject();
    p.compositions[p.rootCompositionId].tracks[0].placements.push({ id: "c1", startTicks: 0, durationTicks: 120000 * 60, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video" });
    const engine = new Engine(p);
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    const seeks: number[] = [];
    let loads = new Map<string, { progress?: number }>();
    const render = (time: number) => act(() => { root.render(<Timeline engine={engine} project={p} time={time} playing={false} onSeek={(t) => seeks.push(t)} onSelect={() => {}} pps={40} centered loads={loads} />); });
    render(0);
    const scroll = el.querySelector(".v2-scroll") as HTMLElement;
    const seen: number[] = [];
    const ev = (n: string) => act(() => { scroll.dispatchEvent(new Event(n, { bubbles: true })); });
    ev("touchstart");
    let x = 0, stale = 0;
    for (let i = 0; i < 40; i += 1) {
      if (i === 20) ev("touchend"); // finger lifted: momentum keeps scrolling
      x += i < 20 ? 12 : Math.max(1, 12 - (i - 20) * 0.6);
      scroll.scrollLeft = x;
      ev("scroll");
      seen.push(scroll.scrollLeft);
      render(stale); // throttled state: the time from a few events ago
      seen.push(scroll.scrollLeft);
      loads = new Map(i % 3 ? [] : [["c1", { progress: i / 40 }]]); render(stale); // P29 loading poll re-render
      seen.push(scroll.scrollLeft);
      stale = seeks[Math.max(0, seeks.length - 3)] ?? 0;
      act(() => { vi.advanceTimersByTime(16); });
    }
    // Scrolling settles; state catches up with the last scroll (possibly frame-snapped): the view stays put.
    act(() => { vi.advanceTimersByTime(USER_SCROLL_IDLE_MS + 50); });
    render(Math.round(seeks[seeks.length - 1] / 4000) * 4000);
    seen.push(scroll.scrollLeft);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBeCloseTo(x, 0);
    // An external seek after scrolling has settled still moves the view.
    render(120000 * 30);
    expect(scroll.scrollLeft).toBe(30 * 40);
    vi.useRealTimers();
  });
});
