// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { loadPreviewVh, PanelGrabber, PREVIEW_DEFAULT, PREVIEW_SNAPS, Sheet, SHEET_SNAPS } from "./Sheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sheet", () => {
  it("closes from the grabber and the backdrop, not from inside", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const onClose = vi.fn();
    await act(async () => createRoot(el).render(<Sheet label="Media" onClose={onClose}><p id="in">x</p></Sheet>));
    (el.querySelector("#in") as HTMLElement).click();
    expect(onClose).not.toHaveBeenCalled();
    (el.querySelector('[aria-label="Close Media"]') as HTMLElement).click();
    (el.querySelector(".v2-sheet-backdrop") as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("opens at the half snap height", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<Sheet label="Text" onClose={() => {}}><p>x</p></Sheet>));
    expect((el.querySelector(".v2-sheet") as HTMLElement).style.height).toBe(`${Math.round(SHEET_SNAPS[1] * window.innerHeight)}px`);
  });
  it("timeline splitter defaults, remembers a valid snap, ignores junk", () => {
    localStorage.removeItem("v2.mobile.previewVh");
    expect(loadPreviewVh()).toBe(PREVIEW_DEFAULT);
    localStorage.setItem("v2.mobile.previewVh", String(PREVIEW_SNAPS[0]));
    expect(loadPreviewVh()).toBe(PREVIEW_SNAPS[0]);
    localStorage.setItem("v2.mobile.previewVh", "37");
    expect(loadPreviewVh()).toBe(PREVIEW_DEFAULT);
    localStorage.removeItem("v2.mobile.previewVh");
  });
  it("splitter keyboard steps snap and persist", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const target = document.createElement("section"); document.body.appendChild(target);
    const onChange = vi.fn();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    await act(async () => createRoot(el).render(<PanelGrabber vh={45} onChange={onChange} target={() => target} />));
    const sep = el.querySelector('[role="separator"]') as HTMLElement;
    await act(async () => { sep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    expect(onChange).toHaveBeenLastCalledWith(PREVIEW_SNAPS[2]);
    expect(target.style.height).toBe(`${PREVIEW_SNAPS[2]}dvh`);
    expect(localStorage.getItem("v2.mobile.previewVh")).toBe(String(PREVIEW_SNAPS[2]));
    vi.unstubAllGlobals(); localStorage.removeItem("v2.mobile.previewVh");
  });
});

describe("Sheet header CSS (V2-SB-R02)", () => {
  it("pins the grabber at top:0 above the sticky header, after the coarse-pointer override", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "v2.css"), "utf8");
    const relative = css.indexOf(".v2-app .v2-grabber { position: relative; }");
    const pinned = css.indexOf(".v2-app .v2-sheet > .v2-grabber, .v2-sheet > .v2-grabber { position: sticky; top: 0; z-index: 2; }");
    expect(relative).toBeGreaterThan(-1);
    expect(pinned).toBeGreaterThan(relative);
    expect(css).toMatch(/\.v2-sheet-head \{ position: sticky; top: 24px; z-index: 1;/);
  });
});

describe("P20 sheet scrolling", () => {
  it("snaps use the visible viewport (Android Chrome / iOS toolbars)", async () => {
    const { sheetPoints, viewportHeight } = await import("./Sheet");
    vi.stubGlobal("visualViewport", { height: 600 });
    expect(viewportHeight()).toBe(Math.min(600, window.innerHeight));
    expect(sheetPoints([0.5])).toEqual([Math.round(0.5 * Math.min(600, window.innerHeight))]);
    vi.unstubAllGlobals();
  });
  it("a sheet that cannot grow lets content pull-ups scroll instead of dragging", async () => {
    const { canGrow } = await import("./Sheet");
    const parent = document.createElement("div"); const el = document.createElement("div"); parent.appendChild(el); document.body.appendChild(parent);
    Object.defineProperty(parent, "clientHeight", { value: 500, configurable: true });
    el.getBoundingClientRect = () => ({ height: 499 } as DOMRect);
    expect(canGrow(el)).toBe(false);
    el.getBoundingClientRect = () => ({ height: 300 } as DOMRect);
    expect(canGrow(el)).toBe(true);
    el.style.maxHeight = "300px";
    expect(canGrow(el)).toBe(false);
  });
  it("CSS: sheets scroll vertically, sliders keep vertical pans, bottom safe area is padded", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/v2/ui/v2.css", "utf8");
    const rule = css.slice(css.indexOf("/* P20:"));
    expect(rule).toMatch(/\.v2-sheet\.is-snap \{[^}]*overflow-y: auto[^}]*overscroll-behavior: contain[^}]*100dvh[^}]*safe-area-inset-bottom/);
    expect(rule).toMatch(/\.v2-sheet input\[type=range\][^{]*\{ touch-action: pan-y; \}/);
    expect(rule).toMatch(/min-height: 0/);
  });
});
