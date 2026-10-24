// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { board, createProject, EXAMPLE_STORYBOARD, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

vi.mock("../../persistence", async (orig) => {
  const m = await orig<typeof import("../../persistence")>();
  return { ...m, importFile: vi.fn(async (f: File, blobs: { put: (k: string, b: Blob) => Promise<void> }) => {
    const kind = f.type.split("/")[0]; const key = `ast_${f.name}/ver_1`; await blobs.put(key, f);
    return { id: `ast_${f.name}`, kind, name: f.name, selectedVersionId: "ver_1", versions: [{ id: "ver_1", createdAt: "", media: { blobKey: key, mime: f.type }, provenance: { source: "import", inputs: [] } }] };
  }) };
});
vi.mock("./lastFrame", () => ({ extractLastFrame: vi.fn(async () => ({ blob: new Blob(["png"], { type: "image/png" }), width: 1280, height: 720 })) }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const btn = (el: Element, t: string | RegExp) => [...el.querySelectorAll("button")].find((b) => { const s = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""; return typeof t === "string" ? s === t || b.textContent?.trim() === t : t.test(s) || t.test(b.textContent ?? ""); }) as HTMLButtonElement;
const doc = (() => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return r.doc; })();
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  const storage = createMemoryStorage();
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
  const p = () => engine.getState().project;
  return { el, engine, storage, p };
}
const pick = async (input: HTMLInputElement, f: File) => {
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await wait();
};

describe("storyboard detail", () => {
  it("says when picking a version changes the length of the linked timeline clip (V2-SB-R01)", async () => {
    const { el, engine } = await mount();
    await act(async () => {
      engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, { ...vid, durationTicks: 600_000 }, { versionId: "a1" }));
      engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, { ...vid, durationTicks: 360_000 }, { versionId: "a2" }));
      engine.dispatch(cmd.sendStoryToTimeline());
    });
    await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());
    const vs = [...el.querySelectorAll(".v2-sb-version")] as HTMLButtonElement[];
    await act(async () => vs[0].click());
    expect(el.querySelector(".v2-sb-swapnote")!.textContent).toContain("Shot 1 on timeline updated to v1 (5 s, was 3 s)");
  });

  it("opens a shot with its prompt, uploads clip versions and picks one", async () => {
    const { el, p } = await mount();
    await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());
    const d = el.querySelector('[role="dialog"]')!;
    expect(d.getAttribute("aria-label")).toBe("Shot 1 · Climbing the cliff path");
    expect(d.textContent).toContain("Clip prompt");
    expect(d.textContent).toContain("Assets in this shot");
    const input = d.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("video/*");
    await pick(input, new File(["a"], "take1.mp4", { type: "video/mp4" }));
    await pick(input, new File(["b"], "take2.mp4", { type: "video/mp4" }));
    const s1 = p().storyboard!.shots.s1;
    expect(board.versionsOf(p(), s1)).toHaveLength(2);
    const vs = [...el.querySelectorAll(".v2-sb-version")] as HTMLButtonElement[];
    expect(vs.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(el.querySelector(".v2-sb-shot")!.textContent).toContain("v2 of 2");
    await act(async () => vs[0].click());
    expect(board.selectedOf(p(), p().storyboard!.shots.s1)).toBe(board.versionsOf(p(), s1)[0].id);
    expect(el.querySelector(".v2-sb-shot")!.textContent).toContain("v1 of 2");
  });

  it("rejects a file of the wrong kind with a clear message", async () => {
    const { el, p, storage } = await mount();
    await act(async () => btn(el, /^The keeper:/).click());
    const d = el.querySelector('[role="dialog"]')!;
    await pick(d.querySelector('input[type="file"]') as HTMLInputElement, new File(["a"], "clip.mp4", { type: "video/mp4" }));
    expect(el.querySelector('[role="alert"]')!.textContent).toMatch(/needs an image.*clip\.mp4.*video/);
    expect(p().storyboard!.slots.keeper.assetId).toBeUndefined();
    expect(await storage.blobs.keys()).toEqual([]);
  });

  it("uses the last frame of the source shot and marks it stale when the shot changes", async () => {
    const { el, engine, p, storage } = await mount();
    await act(async () => btn(el, /^Last frame of shot 1:/).click());
    const lf = () => btn(el.querySelector('[role="dialog"]')!, /Use last frame of shot 1/);
    expect(lf().disabled).toBe(true);
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain("Shot 1 needs a clip first");
    await storage.blobs.put("v", new Blob(["x"], { type: "video/mp4" }));
    await act(async () => engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid)));
    expect(lf().disabled).toBe(false);
    await act(async () => lf().click()); await wait();
    const slot = p().storyboard!.slots["s1-end"];
    const v = board.versionsOf(p(), slot)[0];
    expect(v.media).toMatchObject({ mime: "image/png", width: 1280, height: 720 });
    expect(p().storyboard!.versions[v.id].derivedFrom).toEqual({ shotId: "s1", versionId: board.selectedOf(p(), p().storyboard!.shots.s1) });
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain("Frame of shot 1");
    await act(async () => engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid)));
    expect(el.querySelector(".v2-sb-warnbox")!.textContent).toMatch(/older version of shot 1/);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('[role="region"]')).not.toBeNull();
  });
  it("mobile: Escape inside the sheet closes only the sheet, not the board", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      let closed = 0;
      const el = document.createElement("div"); document.body.appendChild(el);
      const engine = new Engine(createProject("t")); engine.dispatch(cmd.createStoryboard(doc));
      await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => { closed++; }} />));
      await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());
      const sheet = el.querySelector(".v2-sb-sheet")!; expect(sheet).not.toBeNull();
      await act(async () => sheet.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(el.querySelector(".v2-sb-sheet")).toBeNull();
      expect(closed).toBe(0);
    } finally { window.matchMedia = mm; }
  });
});
