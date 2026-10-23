// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { LibraryPicker, filterLibraries } from "./LibraryPicker";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe("LibraryPicker", () => {
  it("filters by search text", () => {
    expect(filterLibraries("thr").map((l) => l.id)).toContain("three");
    expect(filterLibraries("zzz")).toHaveLength(0);
  });
  it("shows chips, removes via ✕, toggles via dropdown", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const onChange = vi.fn();
    act(() => createRoot(el).render(<LibraryPicker value={["three"]} onChange={onChange} mobile={false} />));
    act(() => (el.querySelector('[aria-label="Remove three.js"]') as HTMLElement).click());
    expect(onChange).toHaveBeenLastCalledWith([]);
    act(() => (el.querySelector(".v2-libpick-trigger") as HTMLElement).click());
    const opt = el.querySelector('[role="option"]') as HTMLElement;
    expect(opt.getAttribute("aria-selected")).toBe("true");
    act(() => opt.click());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
