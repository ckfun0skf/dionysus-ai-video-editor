// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { V2App } from "./V2App";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});
afterEach(() => { document.body.innerHTML = ""; });

describe("V2App", () => {
  it("boots with desktop layout: media, preview and timeline", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(el.querySelector('[aria-label="Media"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Preview"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Timeline"]')).toBeTruthy();
    expect(el.querySelectorAll(".v2-lane").length).toBe(2);
    const add = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Video track"))!;
    await act(async () => { add.click(); });
    expect(el.querySelectorAll(".v2-lane").length).toBe(3);
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(el.querySelectorAll(".v2-lane").length).toBe(2);
  });
});
