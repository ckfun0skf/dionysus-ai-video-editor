// @vitest-environment jsdom
/** V2-SB-121: the upload choice (trim or keep full), the trim window, Adjust trim, and undo. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, story, TICKS_PER_SECOND } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let clipSec = 8;
vi.mock("../../persistence", async (orig) => {
  const real = await orig<typeof import("../../persistence")>();
  // jsdom cannot probe media: report a clip `clipSec` long.
  return { ...real, importFile: (f: File, blobs: Parameters<typeof real.importFile>[1]) => real.importFile(f, blobs, async () => ({ durationTicks: clipSec * TICKS_PER_SECOND, width: 1920, height: 1080 })) };
});

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  URL.createObjectURL = (() => "blob:test") as never;
  URL.revokeObjectURL = (() => {}) as never;
});
afterEach(() => { document.body.innerHTML = ""; clipSec = 8; });

const doc = (() => {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [],
    shots: [{ id: "a", title: "One", description: "", durationSec: 4, prompt: "Walk", assets: [], qa: [], genDurationSec: 8 }],
    connections: [],
  });
  if (!r.ok) throw new Error("bad");
  return r.doc;
})();
const S = (sec: number) => sec * TICKS_PER_SECOND;
const btn = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;
const primary = () => document.querySelector('[role="dialog"][aria-modal="true"] .v2-modal-actions .primary') as HTMLButtonElement;
const click = (b: HTMLElement) => act(async () => b.click());
const dialog = () => document.querySelector('.v2-trim[role="dialog"]');
let engine: Engine;
const sb = () => engine.getState().project.storyboard!;
const versions = () => { const id = sb().shots.a.assetId; return id ? engine.getState().project.assets[id].versions : []; };
async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  await click(document.querySelector('[data-shot="a"] .v2-sb-shot-main') as HTMLElement);
}
async function upload() {
  const input = document.querySelector('input[type="file"][aria-label^="Upload video"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "take.mp4", { type: "video/mp4" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const range = () => document.querySelector('input[aria-label="Trim start (seconds)"]') as HTMLInputElement;
const setRange = (v: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range(), v);
  range().dispatchEvent(new Event("input", { bubbles: true }));
});

describe("trim on upload (V2-SB-121)", () => {
  it("shows the generate length and offers trim for a long clip; the centred window is stored; undo removes the upload", async () => {
    await mount();
    expect(document.querySelector(".v2-sb-detail-desc")!.textContent).toContain("generate 8s");
    await upload();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("This clip is 8 s, the shot is planned at 4 s");
    expect(document.querySelector(".v2-trim-read")!.textContent).toBe("Uses 2 s – 6 s of 8 s");
    expect(primary().textContent).toBe("Trim to 4 s");
    await click(primary());
    expect(dialog()).toBeNull();
    const v = versions()[0];
    expect(sb().versions[v.id].trim).toEqual({ inTicks: S(2), outTicks: S(6) });
    expect(document.querySelector(".v2-sb-trimmed")!.textContent).toContain("2–6 s of 8 s");
    engine.undo();
    expect(versions()).toHaveLength(0);
  });

  it("keep full extends the shot in the same undo step; cancel adds nothing", async () => {
    await mount();
    await upload();
    await click(btn("Cancel"));
    expect(versions()).toHaveLength(0);
    await upload();
    await click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Keep full")) as HTMLElement);
    expect(primary().textContent).toBe("Keep full 8 s");
    await click(primary());
    expect(sb().shots.a.durationSec).toBe(8);
    expect(sb().versions[versions()[0].id].trim).toBeUndefined();
    engine.undo();
    expect(sb().shots.a.durationSec).toBe(4);
    expect(versions()).toHaveLength(0);
  });

  it("a short or matching clip is added directly", async () => {
    clipSec = 4.4;
    await mount();
    await upload();
    expect(dialog()).toBeNull();
    expect(versions()).toHaveLength(1);
  });

  it("adjust trim moves the window, and Use full clip removes the trim", async () => {
    await mount();
    await upload();
    await click(primary());
    await click(btn("Adjust trim of v1"));
    expect(dialog()!.getAttribute("aria-label")).toBe("Adjust trim");
    expect(document.querySelector(".v2-trim-read")!.textContent).toBe("Uses 2 s – 6 s of 8 s");
    await setRange("4");
    await click(primary());
    const id = versions()[0].id;
    expect(sb().versions[id].trim).toEqual({ inTicks: S(4), outTicks: S(8) });
    await click(btn("Adjust trim of v1"));
    await click(btn("Use full clip"));
    expect(sb().versions[id].trim).toBeUndefined();
    engine.undo();
    expect(sb().versions[id].trim).toEqual({ inTicks: S(4), outTicks: S(8) });
  });
});
