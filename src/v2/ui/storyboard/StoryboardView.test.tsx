// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EXAMPLE_STORYBOARD, storyboardSystemPrompt } from "../../domain";
import { createMemoryStorage } from "../../persistence";
import { V2App } from "../V2App";
import { StoryboardView } from "./StoryboardView";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const btn = (el: Element, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;
const setText = (ta: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, v);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};
async function mount(onClose = () => {}, onCreate?: () => void) {
  const el = document.createElement("div"); document.body.appendChild(el);
  await act(async () => createRoot(el).render(<StoryboardView onClose={onClose} onCreate={onCreate} />));
  return el;
}

describe("storyboard workspace", () => {
  it("copies the AI prompt and shows confirmation", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = await mount();
    await act(async () => (el.querySelector('[data-testid="step-prompt"]') as HTMLButtonElement).click());
    expect((el.querySelector('[aria-label="AI system prompt"]') as HTMLTextAreaElement).value).toBe(storyboardSystemPrompt());
    await act(async () => (el.querySelector('[data-testid="copy-prompt"]') as HTMLButtonElement).click()); await wait();
    expect(writeText).toHaveBeenCalledWith(storyboardSystemPrompt());
    expect(el.querySelector('[data-testid="copy-prompt"]')!.textContent).toContain("Copied");
  });

  it("lists path-addressed errors for bad JSON and previews a valid storyboard", async () => {
    const onCreate = vi.fn();
    const el = await mount(() => {}, onCreate);
    await act(async () => (el.querySelector('[data-testid="step-import"]') as HTMLButtonElement).click());
    const ta = el.querySelector('[aria-label="Storyboard JSON"]') as HTMLTextAreaElement;
    await act(async () => setText(ta, '{ "shots": [ }'));
    expect(el.querySelector('[data-testid="story-errors"]')!.textContent).toMatch(/line 1, column/);
    const bad = structuredClone(EXAMPLE_STORYBOARD) as unknown as { shots: { durationSec: number }[] };
    bad.shots[1].durationSec = 0;
    await act(async () => setText(ta, JSON.stringify(bad)));
    expect(el.querySelector('[data-testid="story-errors"]')!.textContent).toContain("shots[1].durationSec");
    await act(async () => setText(ta, "Here you go:\n```json\n" + JSON.stringify(EXAMPLE_STORYBOARD) + "\n```"));
    expect(el.querySelector('[data-testid="story-errors"]')).toBeNull();
    const pv = el.querySelector('[data-testid="story-preview"]')!;
    expect(pv.textContent).toContain("The Lantern Keeper");
    expect(pv.querySelectorAll(".v2-sb-shotlist li")).toHaveLength(3);
    const clicked: string[] = [];
    URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    await act(async () => btn(pv, "Download .json").click());
    expect(clicked).toEqual(["the-lantern-keeper.storyboard.json"]);
    await act(async () => btn(pv, "Create storyboard").click());
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ shots: expect.any(Array) }));
  });

  it("imports a chosen .json file", async () => {
    const el = await mount();
    await act(async () => (el.querySelector('[data-testid="step-import"]') as HTMLButtonElement).click());
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const f = new File([JSON.stringify(EXAMPLE_STORYBOARD)], "lantern.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await wait();
    expect(el.textContent).toContain("From lantern.json");
    expect(el.querySelector('[data-testid="story-preview"]')).not.toBeNull();
  });

  it("Escape steps back, then closes", async () => {
    const onClose = vi.fn();
    const el = await mount(onClose);
    await act(async () => (el.querySelector('[data-testid="step-import"]') as HTMLButtonElement).click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector('[data-testid="step-import"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalled();
  });

  it("opens from the editor header and returns to the editor", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<V2App openStorage={async () => createMemoryStorage()} />));
    await wait();
    await act(async () => btn(el, "Storyboard").click());
    expect(el.querySelector('[role="region"][aria-label="Storyboard"]')).not.toBeNull();
    await act(async () => btn(el, "Back to editor").click());
    expect(el.querySelector('[role="region"][aria-label="Storyboard"]')).toBeNull();
  });
});
