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

  it("shows a recovery notice (not a silent reset) when the last project fails its schema check", async () => {
    const { createMemoryStorage } = await import("../persistence");
    const storage = createMemoryStorage();
    storage.projects.load = async () => { throw new Error('Unsupported project schema "dionysus/0.1".'); };
    storage.lastProjectId.set("broken");
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const alert = el.querySelector(".v2-recovery")!;
    expect(alert.textContent).toContain("couldn’t be opened");
    expect(alert.textContent).toContain("dionysus/0.1");
    (Array.from(alert.querySelectorAll("button")).find((b) => b.textContent === "Dismiss") as HTMLButtonElement).click();
    await act(async () => {});
    expect(el.querySelector(".v2-recovery")).toBeNull();
  });
});
