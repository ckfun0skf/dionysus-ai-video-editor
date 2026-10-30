// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, EXAMPLE_STORYBOARD, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { secondsToTicks as s } from "../../domain/time";
import { useEngineState } from "../useEditor";
import type { BoardTarget } from "./BoardView";
import { StoryDetail } from "./StoryDetail";
import { libraryEntries } from "./StoryAssetPicker";
import { MediaPicker } from "../MediaPicker";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  URL.createObjectURL = (() => "blob:x") as never;
  URL.revokeObjectURL = (() => undefined) as never;
});
afterEach(() => { document.body.innerHTML = ""; });

const doc = (() => { const r = story.validateStoryboard(JSON.parse(JSON.stringify(EXAMPLE_STORYBOARD))); if (!r.ok) throw new Error("bad"); return r.doc; })();
const vid = (key: string, sec: number): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: s(sec), width: 1920, height: 1080 });
const btn = (el: ParentNode, t: string | RegExp) => [...el.querySelectorAll("button")].find((b) => { const x = b.textContent?.trim() ?? "", a = b.getAttribute("aria-label") ?? ""; return typeof t === "string" ? x === t || a === t : t.test(x) || t.test(a); }) as HTMLButtonElement;
const wait = () => new Promise((r) => setTimeout(r, 0));
const typeIn = (input: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };

async function mount(e: Engine, target: BoardTarget, blobs = createMemoryStorage().blobs) {
  function Host() { const { project } = useEngineState(e); return <StoryDetail project={project} target={target} thumbs={{}} engine={e} blobs={blobs} mobile={false} onClose={() => {}} onOpen={() => {}} />; }
  const el = document.createElement("div"); el.className = "v2-app"; document.body.appendChild(el);
  await act(async () => createRoot(el).render(<Host />));
  await act(wait);
  return el;
}
const setup = () => { const e = new Engine(createProject("t")); e.dispatch(cmd.createStoryboard(doc)); return e; };

describe("storyboard P2C", () => {
  it("(9) Made with suggests models already used in the project, as a datalist and 44px chips", async () => {
    const e = setup();
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid("a", 4), { model: "Veo 3", now: "2026-10-01T00:00:00Z" }));
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid("b", 4), { model: "veo 3", now: "2026-10-02T00:00:00Z" }));
    e.dispatch(cmd.addStoryVersion({ slot: "hill" }, { blobKey: "c", mime: "image/png" }, { model: "Imagen 4" }));
    expect(board.usedModels(e.getState().project)).toEqual(["veo 3", "Imagen 4"]);
    const el = await mount(e, { shot: "s2" });
    const input = el.querySelector(".v2-sb-model") as HTMLInputElement;
    const list = document.getElementById(input.getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["veo 3", "Imagen 4"]);
    const chips = [...el.querySelectorAll('[data-testid="model-chips"] button')] as HTMLButtonElement[];
    expect(chips.map((c) => c.textContent)).toEqual(["veo 3", "Imagen 4"]);
    await act(async () => chips[1].click());
    expect(input.value).toBe("Imagen 4");
    expect(chips[1].getAttribute("aria-pressed")).toBe("true");
    await act(async () => typeIn(input, "Kling"));
    expect(input.value).toBe("Kling");
  });

  it("(7) Add version opens a picker: library versions of the same kind with a preview, added as a shared new version", async () => {
    const e = setup();
    const { blobs } = createMemoryStorage();
    await blobs.put("a", new Blob(["v"], { type: "video/mp4" }));
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, vid("a", 3), { model: "Veo 3" }));
    e.dispatch(cmd.addStoryVersion({ slot: "hill" }, { blobKey: "img", mime: "image/png" }));
    const el = await mount(e, { shot: "s3" }, blobs);
    const lib = libraryEntries(e.getState().project, "video", undefined);
    expect(lib.map((x) => x.media.blobKey)).toEqual(["a"]);
    await act(async () => btn(el, /Add clip/).click());
    const dlg = el.querySelector('[role="dialog"][aria-label^="Add a version"]')!;
    expect(dlg).not.toBeNull();
    expect(btn(dlg, /Upload new/)).toBeTruthy();
    const tiles = [...dlg.querySelectorAll('[data-testid="sb-library"] [role="option"]')] as HTMLButtonElement[];
    expect(tiles).toHaveLength(1); // the image is not offered for a video shot
    await act(async () => tiles[0].click());
    await act(wait);
    expect(dlg.querySelector('[data-testid="asset-preview"] video')).not.toBeNull();
    await act(async () => (dlg.querySelector('[data-testid="sb-picker-use"]') as HTMLButtonElement).click());
    await act(wait);
    const p = e.getState().project, s3 = p.storyboard!.shots.s3;
    const v = p.assets[s3.assetId!].versions[0];
    expect(v.media.blobKey).toBe("a");
    expect(el.querySelector('[aria-label^="Add a version"]')).toBeNull();
  });

  it("(7) the Add Media picker previews project media before adding it", async () => {
    const loads: string[] = [];
    const el = document.createElement("div"); document.body.appendChild(el);
    let added: string[] | undefined;
    await act(async () => createRoot(el).render(<MediaPicker title="Add media" onClose={() => {}} onAdd={(p) => { added = p.assets; }}
      media={[{ id: "as1", name: "Take", kind: "video", createdAt: "2026-10-01", durationTicks: s(3) }, { id: "au1", name: "Wind", kind: "audio", createdAt: "2026-10-02", durationTicks: s(5) }]}
      loadMedia={async (id) => { loads.push(id); return new Blob(["x"]); }} />));
    await act(async () => btn(el, "Preview Take").click());
    await act(wait);
    expect(loads).toEqual(["as1"]);
    expect(el.querySelector('[data-testid="asset-preview"] video')).not.toBeNull();
    await act(async () => btn(el, "Select").click());
    await act(async () => btn(el, /^Add/).click());
    expect(added).toEqual(["as1"]);
  });

  it("(4) html: preview, Edit code opens the Code Editor, and shot / layer params are editable", async () => {
    const e = setup();
    const { blobs } = createMemoryStorage();
    await blobs.put("h1", new Blob(["<!doctype html><title>x</title>"], { type: "text/html" }));
    e.dispatch(cmd.addStoryVersion({ slot: "text-card" }, { blobKey: "h1", mime: "text/html", durationTicks: s(2) }));
    const el = await mount(e, { shot: "s4" }, blobs);
    // Shot params: text is THE END, change it.
    const box = el.querySelector('[data-testid="v2-sb-html-params"]')!;
    const text = box.querySelector('input[aria-label="Shot Text"]') as HTMLInputElement;
    expect(text.value).toBe("THE END");
    await act(async () => typeIn(text, "FIN"));
    expect(e.getState().project.storyboard!.shots.s4.params).toMatchObject({ text: "FIN" });
    await act(async () => btn(box, /Reset to defaults/).click());
    expect(e.getState().project.storyboard!.shots.s4.params).toBeUndefined();
    // Preview and Edit code.
    await act(async () => btn(el, "Preview v1").click());
    for (let i = 0; i < 5; i++) await act(wait);
    expect(el.querySelector('[data-testid="asset-preview"][data-kind="html"] iframe')).not.toBeNull();
    await act(async () => btn(el, "Edit code of v1").click());
    await act(wait);
    expect(document.querySelector(".v2-ce")).not.toBeNull();
  });

  it("(4) html layer params of a shot are editable in the storyboard", async () => {
    const e = setup();
    const el = await mount(e, { shot: "s1" });
    const box = el.querySelector('[data-testid="v2-sb-layer-params-0"]')!;
    expect(box).not.toBeNull();
    const text = box.querySelector('input[aria-label="Layer 1 Text"]') as HTMLInputElement;
    expect(text.value).toBe("5:58 AM");
    await act(async () => typeIn(text, "6:01 AM"));
    const l = e.getState().project.storyboard!.shots.s1.layers![0] as { params?: Record<string, unknown> };
    expect(l.params).toMatchObject({ text: "6:01 AM", place: "lower-left" });
  });

  it("(4) audio: preview player with waveform and a trim saved on the version", async () => {
    const e = setup();
    const { blobs } = createMemoryStorage();
    await blobs.put("w", new Blob(["x"], { type: "audio/mpeg" }));
    e.dispatch(cmd.addStoryVersion({ slot: "dawn-wind" }, { blobKey: "w", mime: "audio/mpeg", durationTicks: s(30) }, { versionId: "w1" }));
    const el = await mount(e, { slot: "dawn-wind" }, blobs);
    await act(async () => btn(el, "Preview v1").click());
    await act(wait);
    expect(el.querySelector('[data-testid="asset-preview"] audio')).not.toBeNull();
    expect(el.querySelector('[data-testid="wavestrip"]')).not.toBeNull();
    await act(async () => btn(el, "Trim v1").click());
    await act(wait);
    const dlg = document.querySelector('[role="dialog"][aria-label="Trim audio"]')!;
    const [start, end] = [...dlg.querySelectorAll('input[type="range"]')] as HTMLInputElement[];
    await act(async () => { typeIn(start, "2"); });
    await act(async () => { typeIn(end, "12"); });
    await act(async () => btn(dlg, "Save trim").click());
    expect(e.getState().project.storyboard!.versions.w1.trim).toEqual({ inTicks: s(2), outTicks: s(12) });
    expect(el.textContent).toContain("2–12 s of 30 s");
  });
});
