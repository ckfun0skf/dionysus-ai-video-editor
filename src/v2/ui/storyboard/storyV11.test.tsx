// @vitest-environment jsdom
/** Storyboard v1.1 UI (V2-SB-113): html/still shots, layers in the shot detail, transitions on the board, Send note. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, story } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

vi.mock("../../persistence", async (orig) => {
  const m = await orig<typeof import("../../persistence")>();
  return { ...m, importFile: vi.fn(async (f: File, blobs: { put: (k: string, b: Blob) => Promise<void> }) => {
    const kind = f.type === "text/html" ? "html" : f.type.split("/")[0]; const key = `ast_${f.name}/ver_1`; await blobs.put(key, f);
    return { id: `ast_${f.name}`, kind, name: f.name, selectedVersionId: "ver_1", versions: [{ id: "ver_1", createdAt: "", media: { blobKey: key, mime: f.type, width: 1920, height: 1080 }, provenance: { source: "import", inputs: [] } }] };
  }) };
});

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const doc = (() => {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1",
    meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "logo", name: "Logo page", type: "html", prompt: "spinning logo", qa: [] }],
    shots: [
      { id: "s1", title: "Walk", durationSec: 4, prompt: "a walk", assets: [], qa: [], dialogue: "Hi.", captions: true },
      { id: "s2", title: "Logo", durationSec: 3, render: "html", clip: "logo", assets: [], qa: [], layers: [{ id: "t", type: "text", text: "Hello", position: { x: 0.5, y: 0.8 }, startSec: 0, endSec: 3 }], effects: [{ preset: "ken-burns" }] },
    ],
    connections: [{ from: "s1", to: "s2", kind: "cut", transition: { preset: "crossfade", params: { durationSec: 0.8 } } }],
  });
  if (!r.ok) throw new Error("bad");
  return r.doc;
})();

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  const storage = createMemoryStorage();
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
  return { el, engine };
}

describe("storyboard v1.1 UI", () => {
  it("shows the transition on the board and an html shot's clip asset, layers and effects; uploads HTML to the slot", async () => {
    const { el, engine } = await mount();
    expect(el.querySelector(".v2-sb-conn-label")!.textContent).toContain("Crossfade 0.8 s");
    const shots = [...el.querySelectorAll(".v2-sb-shot-main")] as HTMLButtonElement[];
    await act(async () => shots[1].click());
    expect(el.querySelector(".v2-sb-cliplink")!.textContent).toContain("Plays the HTML “Logo page” for 3 s");
    const layers = el.querySelector(".v2-sb-layers")!.textContent!;
    expect(layers).toContain("Text “Hello”");
    expect(layers).toContain("Effect ken-burns");
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe(".html,.htm,text/html,.zip,application/zip");
    Object.defineProperty(input, "files", { value: [new File(["<html></html>"], "logo.html", { type: "text/html" })], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await wait();
    const b = engine.getState().project.storyboard!;
    expect(b.slots.logo.assetId).toBeTruthy();
    expect(b.shots.s2.assetId).toBe(b.slots.logo.assetId);
    expect(el.querySelector(".v2-sb-err")).toBeNull();
  });

  it("Send says how many layers came with the clips", async () => {
    const { el, engine } = await mount();
    await act(async () => {
      engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "v", mime: "video/mp4", durationTicks: 480_000 }));
      engine.dispatch(cmd.addStoryVersion({ slot: "logo" }, { blobKey: "h", mime: "text/html", width: 1920, height: 1080 }));
    });
    const send = [...el.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Send to timeline")!;
    await act(async () => send.click());
    // Caption for s1, text layer and effect for s2.
    expect(el.querySelector(".v2-sb-note")!.textContent).toContain("Added 2 clips and 3 layers to the end of the timeline");
  });
});
