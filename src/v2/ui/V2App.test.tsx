// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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
/**
 * Unmount every app after each test and let its async work settle (autosave flush, storage, logs), so nothing writes
 * to the console after the file's environment is torn down (that made CI fail with EnvironmentTeardownError).
 */
const roots: Root[] = [];
const track = (r: Root) => { roots.push(r); return r; };
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  document.body.innerHTML = "";
});

describe("V2App", () => {
  it("boots with desktop layout: media, preview and timeline", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { track(createRoot(el)).render(<V2App />); });
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
    await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
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
    await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const clip = el.querySelector('[data-placement-id="v"]') as HTMLElement;
    await act(async () => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    const btn = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    // V2-106: speed lives in the inspector's Speed tab (segmented control).
    await act(async () => { Array.from(el.querySelectorAll<HTMLButtonElement>('.v2-inspect [role="tab"]')).find((b) => b.textContent === "Speed")!.click(); });
    await act(async () => { Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Speed"] button')).find((b) => b.textContent === "2×")!.click(); });
    expect(el.querySelector('[data-placement-id="v"]')!.textContent).toContain("2×");
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
    await act(async () => { track(createRoot(el)).render(<V2App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const btn = (label: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    // V2-106: text is added from the asset browser's Text tab.
    await act(async () => { (el.querySelector('.v2-abtabs [title="Text"]') as HTMLButtonElement).click(); });
    await act(async () => { btn("Default text").click(); });
    expect(el.querySelector(".v2-clip.clip-text")).toBeTruthy();
    await act(async () => { btn("Done").click(); });
    expect(btn("Add subtitle")).toBeUndefined(); // V2-104: replaced by Import SRT + Edit subtitles
    const input = el.querySelector('input[aria-label="Import SRT file"]') as HTMLInputElement;
    const file = new File(["1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n"], "s.srt");
    Object.defineProperty(file, "text", { value: async () => "1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    const lanes = el.querySelectorAll(".v2-lane[data-track-id]").length, texts = el.querySelectorAll(".v2-clip.clip-text").length;
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); });
    // SRT import adds a NEW text layer with one text clip per cue (nothing replaced).
    expect(el.querySelectorAll(".v2-lane[data-track-id]").length).toBe(lanes + 1);
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(texts + 2);
    // V2-104: Edit subtitles list editor on the imported layer
    await act(async () => { (el.querySelector('[aria-label="Edit subtitles in Subtitles"]') as HTMLButtonElement).click(); });
    const rows = el.querySelectorAll(".v2-cue");
    expect(rows.length).toBe(2);
    const ta = el.querySelector('textarea[aria-label="Subtitle 1 text"]') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { ta.focus(); setter.call(ta, "Hi"); ta.dispatchEvent(new Event("input", { bubbles: true })); setter.call(ta, "Hi there"); ta.dispatchEvent(new Event("input", { bubbles: true })); ta.blur(); });
    expect(Array.from(el.querySelectorAll(".v2-clip.clip-text")).some((c) => c.textContent?.includes("Hi there"))).toBe(true);
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect((el.querySelector('textarea[aria-label="Subtitle 1 text"]') as HTMLTextAreaElement).value).toBe("A");
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(el.querySelectorAll(".v2-lane[data-track-id]").length).toBe(lanes);
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(texts);
  });

  it("ripple toggle persists and is reflected on Delete", async () => {
    localStorage.removeItem("v2.ripple");
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { track(createRoot(el)).render(<V2App />); });
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
    await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
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

  const twoClipStorage = async () => {
    const { createMemoryStorage } = await import("../persistence");
    const { createProject } = await import("../domain");
    const storage = createMemoryStorage();
    const p = createProject();
    p.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "video/mp4", durationTicks: 1200000 }, provenance: { source: "import", inputs: [] } }] };
    const mk = (id: string, start: number) => ({ id, startTicks: start, durationTicks: 240000, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "1" }, clipType: "video" as const });
    p.compositions[p.rootCompositionId].tracks[0].placements.push(mk("v1", 0), mk("v2", 240000));
    await storage.projects.save(p); storage.lastProjectId.set(p.id);
    return storage;
  };

  it("transition picker (desktop): the junction opens it without adding anything; tiles apply, None removes, each pick is one undo step", async () => {
    const storage = await twoClipStorage();
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const marker = () => el.querySelector(".v2-trans") as HTMLButtonElement;
    expect(marker().getAttribute("aria-label")).toBe("Add transition");
    await act(async () => { marker().click(); });
    expect(marker().getAttribute("aria-label")).toBe("Add transition");
    const tile = (id: string) => el.querySelector(`.v2-transpick [data-transition="${id}"]`) as HTMLButtonElement;
    expect(tile("none").getAttribute("aria-checked")).toBe("true");
    await act(async () => { tile("crossfade").click(); });
    expect(marker().getAttribute("aria-label")).toBe("Crossfade 0.5s");
    expect(marker().classList.contains("has-trans")).toBe(true);
    expect(tile("crossfade").getAttribute("aria-checked")).toBe("true");
    await act(async () => { tile("zoom-in").click(); });
    expect(marker().getAttribute("aria-label")).toMatch(/^Zoom.* 0\.5s$/);
    await act(async () => { tile("none").click(); });
    expect(marker().getAttribute("aria-label")).toBe("Add transition");
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(marker().getAttribute("aria-label")).toMatch(/^Zoom/);
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(marker().getAttribute("aria-label")).toBe("Crossfade 0.5s");
    // search filters across categories and hides the tabs
    const search = el.querySelector('input[aria-label="Search transitions"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(search, "wipe"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelector('.v2-transpick [role="tablist"]')).toBeNull();
    expect(tile("wipe-up")).toBeTruthy();
    expect(tile("crossfade")).toBeNull();
  });

  it("transition picker (mobile): the junction opens a non-dimming bottom sheet; ✓ closes it", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const storage = await twoClipStorage();
      const el = document.createElement("div"); document.body.appendChild(el);
      await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await act(async () => { (el.querySelector(".v2-trans") as HTMLButtonElement).click(); });
      const sheet = document.querySelector(".v2-trans-sheet") as HTMLElement;
      expect(sheet).toBeTruthy();
      expect(sheet.closest(".v2-sheet-backdrop")!.classList.contains("is-clear")).toBe(true);
      await act(async () => { (document.querySelector('.v2-trans-sheet [data-transition="crossfade"]') as HTMLButtonElement).click(); });
      expect((el.querySelector(".v2-trans") as HTMLElement).getAttribute("aria-label")).toBe("Crossfade 0.5s");
      const done = Array.from(sheet.querySelectorAll("button")).find((b) => /done/i.test(b.getAttribute("aria-label") ?? b.textContent ?? "")) as HTMLButtonElement;
      await act(async () => { done.click(); });
      expect(document.querySelector(".v2-trans-sheet")).toBeNull();
    } finally { window.matchMedia = mm; }
  });

  it("V2-ADD-MEDIA-TABS mobile: main [+] opens Add Media (Video/Photo/Code/Sticker); Code → Create opens the Code Editor and adds the new clip", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const text = Blob.prototype.text;
    if (!text) Blob.prototype.text = function (this: Blob) { return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
    try {
      const el = document.createElement("div");
      document.body.appendChild(el);
      await act(async () => { track(createRoot(el)).render(<V2App />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await act(async () => { (el.querySelector('[aria-label="Add media to main track"]') as HTMLElement).click(); });
      const picker = el.querySelector('.v2-picker[aria-label="Add media"]')!;
      expect([...picker.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(["Video", "Photo", "Code", "Sticker"]);
      await act(async () => { ([...picker.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Code") as HTMLElement).click(); });
      await act(async () => { ([...picker.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Create")) as HTMLElement).click(); });
      expect(el.querySelector(".v2-picker")).toBeNull();
      const editor = el.querySelector('[aria-label="HTML clip editor"]')!;
      expect(editor).toBeTruthy();
      await act(async () => { ([...editor.querySelectorAll("button")].find((b) => b.textContent === "Add to timeline") as HTMLElement).click(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(el.querySelector('[aria-label="HTML clip editor"]')).toBeNull();
      expect([...el.querySelectorAll(".v2-clip-name")].some((n) => n.textContent?.includes("Code clip"))).toBe(true);
    } finally { window.matchMedia = mm; if (!text) delete (Blob.prototype as { text?: unknown }).text; }
  });

  it("mobile: track controls sit inside the scroll content before t=0 (scroll with clips, never over them); no floating action button", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const el = document.createElement("div");
      document.body.appendChild(el);
      await act(async () => { track(createRoot(el)).render(<V2App />); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const side = el.querySelector('[data-testid="side-col"]')!;
      const scroll = el.querySelector(".v2-scroll")!;
      expect(side).toBeTruthy();
      expect(side.parentElement).toBe(el.querySelector(".v2-content"));
      expect(scroll.contains(side)).toBe(true);
      // Right edge of the column is exactly t=0 (the content's left padding).
      const content = side.parentElement as HTMLElement;
      expect(parseFloat((side as HTMLElement).style.left) + 184).toBe(parseFloat(content.style.paddingLeft));
      expect(el.querySelector(".v2-fab")).toBeNull();
      // V2-109: the CapCut "+" trails the main lane (scrolls with the track) and is never a floating overlay.
      const add = el.querySelector('[aria-label="Add media to main track"]') as HTMLElement;
      expect(add.parentElement!.classList.contains("v2-lane")).toBe(true);
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

  // V2-SB-133: a video clip's in point (slip) on desktop (Speed tab) and phone ("In point" tool and sheet).
  const slipStorage = async () => {
    const { createMemoryStorage } = await import("../persistence");
    const { createProject } = await import("../domain");
    const storage = createMemoryStorage();
    const p = createProject();
    p.assets.a = { id: "a", kind: "video", name: "dust.mp4", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "video/mp4", durationTicks: 1200000 }, provenance: { source: "import", inputs: [] } }] };
    p.compositions[p.rootCompositionId].tracks[0].placements.push({ id: "v", startTicks: 0, durationTicks: 480000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "video" });
    await storage.projects.save(p);
    storage.lastProjectId.set(p.id);
    return storage;
  };
  const mountSlip = async () => {
    const storage = await slipStorage();
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => { track(createRoot(el)).render(<V2App openStorage={async () => storage} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const clip = el.querySelector('[data-placement-id="v"]') as HTMLElement;
    await act(async () => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    return el;
  };
  const typeIn = async (root: ParentNode, v: string) => {
    const input = root.querySelector('input[aria-label="In point in seconds"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  };
  const readout = (root: ParentNode) => root.querySelector(".v2-inpoint [aria-live]")!.textContent;

  it("in point (desktop): Speed tab slips the clip, clamps to the media and undoes", async () => {
    const el = await mountSlip();
    await act(async () => { Array.from(el.querySelectorAll<HTMLButtonElement>('.v2-inspect [role="tab"]')).find((b) => b.textContent === "Speed")!.click(); });
    const sec = el.querySelector('section[aria-label="In point"]') as HTMLElement;
    expect(sec).toBeTruthy();
    expect(readout(sec)).toBe("Plays 0–4 s of 10 s. Length and position stay.");
    await typeIn(sec, "2.5");
    expect(readout(el)).toBe("Plays 2.5–6.5 s of 10 s. Length and position stay.");
    await act(async () => { (el.querySelector('[aria-label="In point 0.1 s later"]') as HTMLButtonElement).click(); });
    expect(readout(el)).toBe("Plays 2.6–6.6 s of 10 s. Length and position stay.");
    await typeIn(el, "99");
    expect(readout(el)).toBe("Plays 6–10 s of 10 s. Length and position stay.");
    expect((el.querySelector('[aria-label="In point 0.1 s later"]') as HTMLButtonElement).disabled).toBe(true);
    // Leaving the field unchanged (as clicking Undo does in a browser) is not an edit, so one Undo still steps back.
    await act(async () => { (el.querySelector('input[aria-label="In point in seconds"]') as HTMLInputElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await act(async () => { (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(); });
    expect(readout(el)).toBe("Plays 2.6–6.6 s of 10 s. Length and position stay.");
  });

  it("in point (mobile): the In point tool opens a sheet with the same control", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      const el = await mountSlip();
      const tool = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.trim() === "In point") as HTMLButtonElement;
      expect(tool).toBeTruthy();
      await act(async () => { tool.click(); });
      const sheet = document.querySelector('[role="dialog"][aria-label="In point"]') as HTMLElement ?? document.querySelector(".v2-inpoint")!.closest(".v2-msheet-insp") as HTMLElement;
      expect(sheet).toBeTruthy();
      await typeIn(sheet, "1");
      expect(readout(document)).toBe("Plays 1–5 s of 10 s. Length and position stay.");
    } finally { window.matchMedia = mm; }
  });
});
