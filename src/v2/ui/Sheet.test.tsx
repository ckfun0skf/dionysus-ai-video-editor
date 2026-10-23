// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { previewHeightAfterDrag, PREVIEW_MAX, PREVIEW_MIN, Sheet, shouldDismiss } from "./Sheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sheet", () => {
  it("dismisses on a long drag or a fast flick, not a nudge", () => {
    expect(shouldDismiss(10, 400, 0.1)).toBe(false);
    expect(shouldDismiss(130, 400, 0.1)).toBe(true);
    expect(shouldDismiss(40, 400, 1)).toBe(true);
  });
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
  it("clamps the resizable preview height", () => {
    expect(previewHeightAfterDrag(45, 844, 844)).toBe(PREVIEW_MAX);
    expect(previewHeightAfterDrag(45, -844, 844)).toBe(PREVIEW_MIN);
    expect(previewHeightAfterDrag(45, 84.4, 844)).toBeCloseTo(55);
  });
});
