// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { V2App } from "./V2App";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
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

  it("speed, reverse and freeze on a selected video clip are undoable", async () => {
    const { createMemoryStorage } = await import("../persistence");
    const { createProject } = await import("../domain");
    const storage = createMemoryStorage();
    const p = createProject();
    p.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "video/mp4", durationTicks: 1200000 }, provenance: { source: "import", inputs: [] } }] };
    p.compositions[p.rootCompositionId].tracks[0].placements.push({ id: "v", startTicks: 0, durationTicks: 480000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video" });
    await storage.projects.save(p);
    storage.lastProjectId.set(p.id);
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const clip = el.querySelector('[data-placement-id="v"]') as HTMLElement;
    await act(async () => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    const speed = el.querySelector('select[aria-label="Speed"]') as HTMLSelectElement;
    await act(async () => { speed.value = "2"; speed.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(el.querySelector('[data-placement-id="v"]')!.textContent).toContain("2×");
    const btn = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    await act(async () => { btn("Reverse").click(); });
    expect(el.querySelector('[aria-label="Reversed"]')).toBeTruthy();
    await act(async () => { btn("Freeze").click(); });
    expect(el.querySelector('[aria-label="Freeze frame"]')).toBeTruthy();
    for (let i = 0; i < 3; i += 1) await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('[data-placement-id="v"]')!.textContent).not.toContain("2×");
    expect(el.querySelector('[aria-label="Reversed"]')).toBeNull();
  });

  it("adds, edits and deletes text; SRT import is one undo step", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const btn = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    await act(async () => { btn("Add text").click(); });
    expect(el.querySelector(".v2-clip.clip-text")).toBeTruthy();
    await act(async () => { btn("Done").click(); });
    await act(async () => { btn("Add subtitle").click(); });
    const ta = el.querySelector('textarea[aria-label="Subtitle text"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(ta, "Hi there"); ta.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelector("[data-subtitle-id]")!.textContent).toContain("Hi there");
    await act(async () => { btn("Delete").click(); });
    expect(el.querySelector("[data-subtitle-id]")).toBeNull();
    const input = el.querySelector('input[aria-label="Import SRT file"]') as HTMLInputElement;
    const file = new File(["1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n"], "s.srt");
    Object.defineProperty(file, "text", { value: async () => "1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const lanes = el.querySelectorAll(".v2-lane[data-track-id]").length, texts = el.querySelectorAll(".v2-clip.clip-text").length;
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); });
    // SRT import adds a NEW text layer with one text clip per cue (nothing replaced).
    expect(el.querySelectorAll(".v2-lane[data-track-id]").length).toBe(lanes + 1);
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(texts + 2);
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(el.querySelectorAll(".v2-lane[data-track-id]").length).toBe(lanes);
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(texts);
  });

  it("ripple toggle persists and is reflected on Delete", async () => {
    localStorage.removeItem("v2.ripple");
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const toggle = el.querySelector('button[aria-pressed][title^="Ripple"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("v2.ripple")).toBe("1");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" })); });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("shift-click multi-select: duplicate, copy/paste and delete act on all selected clips", async () => {
    const { createMemoryStorage } = await import("../persistence");
    const { createProject } = await import("../domain");
    const storage = createMemoryStorage();
    const p = createProject();
    p.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "video/mp4", durationTicks: 1200000 }, provenance: { source: "import", inputs: [] } }] };
    for (const [id, start] of [["m1", 0], ["m2", 240000]] as const) p.compositions[p.rootCompositionId].tracks[0].placements.push({ id, startTicks: start, durationTicks: 240000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video" });
    await storage.projects.save(p);
    storage.lastProjectId.set(p.id);
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const down = (id: string, shiftKey = false) => act(async () => { el.querySelector(`[data-placement-id="${id}"]`)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, shiftKey })); window.dispatchEvent(new MouseEvent("pointerup")); });
    const clips = () => el.querySelectorAll("[data-placement-id]").length;
    const btn = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    await down("m1");
    await down("m2", true);
    expect(el.querySelector(".v2-sel-count")!.textContent).toContain("2 selected");
    expect(el.querySelectorAll(".v2-clip.is-selected").length).toBe(2);
    await act(async () => { btn("Duplicate").click(); });
    expect(clips()).toBe(4);
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(clips()).toBe(2);
    await down("m1");
    await down("m2", true);
    await act(async () => { btn("Copy").click(); });
    await act(async () => { btn("Done").click(); });
    await act(async () => { btn("Paste").click(); });
    expect(clips()).toBe(4);
    await act(async () => { btn("Delete").click(); });
    expect(clips()).toBe(2);
  });

  it("crossfade: add at a cut, change length, remove, all undoable", async () => {
    const { createMemoryStorage } = await import("../persistence");
    const { createProject } = await import("../domain");
    const storage = createMemoryStorage();
    const p = createProject();
    p.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "video/mp4", durationTicks: 1200000 }, provenance: { source: "import", inputs: [] } }] };
    const mk = (id: string, start: number) => ({ id, startTicks: start, durationTicks: 240000, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "1" }, clipType: "video" as const });
    p.compositions[p.rootCompositionId].tracks[0].placements.push(mk("v1", 0), mk("v2", 240000));
    await storage.projects.save(p); storage.lastProjectId.set(p.id);
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const marker = () => el.querySelector(".v2-trans") as HTMLButtonElement;
    expect(marker().getAttribute("aria-label")).toBe("Add crossfade");
    await act(async () => { marker().click(); });
    expect(marker().getAttribute("aria-label")).toBe("Crossfade 0.5s");
    const group = () => el.querySelector('[aria-label="Transition"]') as HTMLElement;
    const btnIn = (root: Element, t: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes(t)) as HTMLButtonElement;
    await act(async () => { btnIn(group(), "1s").click(); });
    expect(marker().getAttribute("aria-label")).toBe("Crossfade 1s");
    await act(async () => { btnIn(group(), "No transition").click(); });
    expect(marker().getAttribute("aria-label")).toBe("Add crossfade");
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(marker().getAttribute("aria-label")).toMatch(/^Crossfade/);
  });

  it("mobile: track controls sit inside the scroll content before t=0 (scroll with clips, never over them); no floating action button", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const el = document.createElement("div");
      document.body.appendChild(el);
      await act(async () => { createRoot(el).render(<V2App />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const side = el.querySelector('[data-testid="side-col"]')!;
      const scroll = el.querySelector(".v2-scroll")!;
      expect(side).toBeTruthy();
      expect(side.parentElement).toBe(el.querySelector(".v2-content"));
      expect(scroll.contains(side)).toBe(true);
      // Right edge of the column is exactly t=0 (the content's left padding).
      const content = side.parentElement as HTMLElement;
      expect(parseFloat((side as HTMLElement).style.left) + 144).toBe(parseFloat(content.style.paddingLeft));
      expect(el.querySelector(".v2-fab")).toBeNull();
      // V2-096: the root toolbar is exactly the five CapCut modes; each mode has ‹ back to root.
      const labels = () => [...el.querySelectorAll(".v2-toolbar .v2-tool span")].map((x) => x.textContent);
      expect(labels()).toEqual(["Edit", "Audio", "Text", "Effect", "Overlay"]);
      const tap = async (name: string) => { await act(async () => { ([...el.querySelectorAll(".v2-toolbar .v2-tool")].find((b) => b.textContent === name) as HTMLButtonElement).click(); }); };
      await tap("Audio");
      expect(labels()).toEqual(["Add audio"]);
      await act(async () => { (el.querySelector(".v2-tool-back") as HTMLButtonElement).click(); });
      expect(labels()).toEqual(["Edit", "Audio", "Text", "Effect", "Overlay"]);
      await tap("Text");
      expect(labels()).toEqual(expect.arrayContaining(["Add text", "Stickers", "Import SRT", "Templates"]));
      await act(async () => { (el.querySelector(".v2-tool-back") as HTMLButtonElement).click(); });
      await tap("Overlay");
      expect(labels()).toEqual(["Add overlay"]);
    } finally { window.matchMedia = mm; }
  });
});
