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
