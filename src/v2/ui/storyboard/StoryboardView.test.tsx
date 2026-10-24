// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, EXAMPLE_STORYBOARD, runtimeAiLinks, storyboardShortPrompt, storyboardSystemPrompt, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
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
let engine: Engine;
async function mount(onClose = () => {}) {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={onClose} />));
  return el;
}
const doc = (() => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return r.doc; })();

describe("storyboard workspace", () => {
  it("sends shots with clips to the timeline and marks them", async () => {
    const el = await mount();
    await act(async () => engine.dispatch(cmd.createStoryboard(doc)));
    await act(async () => btn(el, "Send to timeline").click());
    expect(el.querySelector(".v2-sb-note")!.textContent).toMatch(/No clips to send yet/);
    const clip: MediaRef = { blobKey: "c", mime: "video/mp4", durationTicks: 1000 };
    await act(async () => engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, clip)));
    await act(async () => btn(el, "Send to timeline").click());
    expect(el.querySelector(".v2-sb-note")!.textContent).toBe("Added 1 clip to the end of the timeline · 2 shots still need a clip");
    expect(el.querySelectorAll(".v2-sb-placed")).toHaveLength(1);
    await act(async () => btn(el, "Undo").click());
    expect(el.querySelectorAll(".v2-sb-placed")).toHaveLength(0);
  });

  it("copies the short AI prompt, and the full prompt when chosen", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = await mount();
    await act(async () => (el.querySelector('[data-testid="step-prompt"]') as HTMLButtonElement).click());
    const ta = () => (el.querySelector('[aria-label="AI system prompt"]') as HTMLTextAreaElement).value;
    expect(ta()).toBe(storyboardShortPrompt());
    expect(ta()).toContain(runtimeAiLinks().guide);
    await act(async () => (el.querySelector('[data-testid="copy-prompt"]') as HTMLButtonElement).click()); await wait();
    expect(writeText).toHaveBeenLastCalledWith(storyboardShortPrompt());
    expect(el.querySelector('[data-testid="copy-prompt"]')!.textContent).toContain("Copied");
    await act(async () => (el.querySelector('[data-testid="prompt-full"]') as HTMLButtonElement).click());
    expect(el.querySelector('[data-testid="prompt-full"]')!.getAttribute("aria-checked")).toBe("true");
    expect(ta()).toBe(storyboardSystemPrompt());
    expect(el.querySelector('[data-testid="copy-prompt"]')!.textContent).toContain("Copy full prompt");
    await act(async () => (el.querySelector('[data-testid="copy-prompt"]') as HTMLButtonElement).click()); await wait();
    expect(writeText).toHaveBeenLastCalledWith(storyboardSystemPrompt());
  });

  it("builds the copied prompt and the Open guide link from the deployment it runs on (V2-OPS-LINKS)", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
    vi.stubGlobal("location", { href: `https://video.example.com${base}?v2`, hostname: "video.example.com", origin: "https://video.example.com" });
    try {
      const el = await mount();
      await act(async () => (el.querySelector('[data-testid="step-prompt"]') as HTMLButtonElement).click());
      const site = `https://video.example.com${base}`;
      const ta = (el.querySelector('[aria-label="AI system prompt"]') as HTMLTextAreaElement).value;
      expect(ta).toContain(`guide: ${site}ai/storyboard-guide.md`);
      expect(ta).toContain(`${site}ai/presets.json`);
      expect(ta).not.toContain("github.io");
      expect((el.querySelector('a[title^="Open the storyboard guide"]') as HTMLAnchorElement).getAttribute("href")).toBe(`${site}ai/storyboard-guide.html`);
      await act(async () => (el.querySelector('[data-testid="copy-prompt"]') as HTMLButtonElement).click()); await wait();
      expect(writeText).toHaveBeenLastCalledWith(ta);
    } finally { vi.unstubAllGlobals(); }
  });

  it("lists path-addressed errors for bad JSON and previews a valid storyboard", async () => {
    const el = await mount();
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
    expect(engine.getState().project.storyboard?.order).toEqual(["s1", "s2", "s3"]);
    expect(el.querySelectorAll(".v2-sb-shot")).toHaveLength(3);
    expect(el.querySelector('[role="status"]')!.textContent).toContain("The Lantern Keeper");
  });

  it("shows shots in order with connections, asset needs and transitive warnings; undo/replace", async () => {
    const el = await mount();
    await act(async () => engine.dispatch(cmd.createStoryboard(doc)));
    const shots = [...el.querySelectorAll(".v2-sb-shot")];
    expect(shots.map((s) => s.querySelector(".v2-sb-no")!.textContent)).toEqual(["1", "2", "3"]);
    expect(el.querySelectorAll(".v2-sb-conn")).toHaveLength(2);
    expect(el.querySelector(".v2-sb-conn.continuity")).not.toBeNull();
    expect(shots[0].textContent).toContain("No clip yet");
    expect(shots[1].textContent).toContain("Taken from shot 1’s clip");
    const img: MediaRef = { blobKey: "b", mime: "image/png", width: 16, height: 9 };
    const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };
    await act(async () => { engine.dispatch(cmd.addStoryVersion({ slot: "keeper" }, img)); engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid)); });
    expect(el.querySelector(".v2-sb-shot")!.textContent).toContain("1 version");
    expect(el.textContent).not.toMatch(/may not match/);
    await act(async () => engine.dispatch(cmd.addStoryVersion({ slot: "keeper" }, img)));
    expect(el.querySelector(".v2-sb-shot")!.classList.contains("stale")).toBe(true);
    expect(el.querySelector(".v2-sb-stats")!.textContent).toMatch(/may not match/);
    await act(async () => btn(el, "Undo").click());
    expect(el.querySelector(".v2-sb-shot")!.classList.contains("stale")).toBe(false);
    await act(async () => btn(el, "Replace storyboard").click());
    // V2-SB-R12: replacing asks first.
    expect(el.querySelector('[aria-label="Storyboard JSON"]')).toBeNull();
    await act(async () => btn(el, "Continue").click());
    const ta = el.querySelector('[aria-label="Storyboard JSON"]') as HTMLTextAreaElement;
    const other = structuredClone(EXAMPLE_STORYBOARD) as unknown as { meta: { title: string } }; other.meta.title = "Second cut";
    await act(async () => setText(ta, JSON.stringify(other)));
    await act(async () => btn(el, "Replace storyboard").click());
    expect(engine.getState().project.storyboard?.meta.title).toBe("Second cut");
    expect(el.querySelector('[role="status"]')!.textContent).toMatch(/Undo/);
    await act(async () => btn(el, "Undo").click());
    expect(engine.getState().project.storyboard?.meta.title).toBe("The Lantern Keeper");
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
    expect(el.querySelector(".v2-board .v2-hint")!.textContent).toMatch(/never calls an AI/);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
    await act(async () => btn(el, "Back to editor").click());
    expect(el.querySelector('[role="region"][aria-label="Storyboard"]')).toBeNull();
  });
});
