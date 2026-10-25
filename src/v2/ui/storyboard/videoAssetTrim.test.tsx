// @vitest-environment jsdom
/** V2-SB-133: a video asset used as a 2 s layer: generate length, trim on upload, Adjust trim, and the editor field. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, story, TICKS_PER_SECOND } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let clipSec = 6;
vi.mock("../../persistence", async (orig) => {
  const real = await orig<typeof import("../../persistence")>();
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
afterEach(() => { document.body.innerHTML = ""; clipSec = 6; });

const doc = (layers = true) => {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "dust-leak", name: "Dust leak", type: "video", prompt: "Warm dust on black", qa: [], genDurationSec: 6 }],
    shots: [{ id: "a", title: "One", description: "", durationSec: 4, prompt: "Walk", assets: layers ? [] : ["dust-leak"], qa: [],
      layers: layers ? [{ id: "d", type: "video", asset: "dust-leak", startSec: 0, endSec: 2, box: { x: 0, y: 0, width: 1, height: 1 }, blend: "screen" }] : [] }],
    connections: [],
  });
  if (!r.ok) throw new Error("bad");
  return r.doc;
};
const S = (sec: number) => sec * TICKS_PER_SECOND;
const btn = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => {
  const s = b.textContent?.trim() ?? "", a = b.getAttribute("aria-label") ?? "";
  return typeof t === "string" ? s === t || a === t : t.test(s) || t.test(a);
}) as HTMLButtonElement;
const primary = () => document.querySelector('[role="dialog"][aria-modal="true"] .v2-modal-actions .primary') as HTMLButtonElement;
const click = (b: HTMLElement) => act(async () => b.click());
const dialog = () => document.querySelector('.v2-trim[role="dialog"]');
const field = (label: string) => [...document.querySelectorAll("label")].find((l) => l.firstChild?.textContent === label)?.querySelector("input") as HTMLInputElement | undefined;
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
let engine: Engine;
const sb = () => engine.getState().project.storyboard!;
const versions = () => { const id = sb().slots["dust-leak"].assetId; return id ? engine.getState().project.assets[id].versions : []; };
async function mount(layers = true) {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc(layers)));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  await click(btn(/^Dust leak:/));
}
async function upload() {
  const input = document.querySelector('input[type="file"][aria-label^="Upload video"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "dust.mp4", { type: "video/mp4" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("video asset trim (V2-SB-133)", () => {
  it("shows the generate and layer lengths, offers a trim to the layer length, and Adjust trim", async () => {
    await mount();
    expect(document.querySelector(".v2-sb-detail-desc")!.textContent).toMatch(/generate 6s.*layers use 2\s?s/);
    await upload();
    expect(dialog()!.textContent).toContain("This clip is 6 s, its layers use 2 s");
    expect(primary().textContent).toBe("Trim to 2 s");
    await click(primary());
    const v = versions()[0];
    expect(sb().versions[v.id].trim).toEqual({ inTicks: S(2), outTicks: S(4) });
    expect(btn("Adjust trim of v1")).toBeTruthy();
    engine.undo();
    expect(versions()).toHaveLength(0);
  });

  it("keep full adds the whole clip without a trim; unused assets are never asked", async () => {
    await mount();
    await upload();
    await click([...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes("Keep full")) as HTMLElement);
    expect(dialog()!.textContent).toContain("its layers start at 0 s, or at their own in point");
    await click(primary());
    expect(versions()).toHaveLength(1);
    expect(sb().versions[versions()[0].id].trim).toBeUndefined();
    document.body.innerHTML = "";
    await mount(false);
    await upload();
    expect(dialog()).toBeNull();
    expect(versions()).toHaveLength(1);
  });

  it("the asset editor sets, validates and clears the generate length", async () => {
    await mount();
    await click(btn("Edit"));
    const gen = field("Generate (s)")!;
    expect(gen.value).toBe("6");
    expect(document.getElementById("v2-sb-slotgen-hint")!.textContent).toContain("Its layers use 2 s");
    await act(async () => setValue(gen, "200"));
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("0.5–120 seconds");
    expect(btn("Save").disabled).toBe(true);
    await act(async () => setValue(gen, "8"));
    await click(btn("Save"));
    expect(sb().slots["dust-leak"].genDurationSec).toBe(8);
    await click(btn("Edit"));
    await act(async () => setValue(field("Generate (s)")!, ""));
    await click(btn("Save"));
    expect(sb().slots["dust-leak"].genDurationSec).toBeUndefined();
  });
});
