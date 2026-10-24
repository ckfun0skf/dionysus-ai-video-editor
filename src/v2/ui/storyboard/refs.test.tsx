// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let phone = false;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; phone = false; });

const doc = (() => {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1",
    meta: { title: "T", aspect: "16:9" },
    assets: [
      { id: "photo", name: "Photo", type: "image", prompt: "A photo" },
      { id: "card", name: "Card", type: "html", prompt: "<h1>Hi</h1>" },
    ],
    shots: [
      { id: "a", title: "One", description: "", durationSec: 4, prompt: "Walk", assets: ["photo"], qa: [] },
      { id: "b", title: "Two", description: "", durationSec: 4, prompt: "Look", assets: ["photo"], qa: [] },
      { id: "c", title: "Card", description: "", durationSec: 3, prompt: "", assets: [], qa: [], render: "html", clip: "card" },
    ],
    connections: [],
  });
  if (!r.ok) throw new Error("bad");
  return r.doc;
})();
const img: MediaRef = { blobKey: "b", mime: "image/png", width: 16, height: 9 };
const btn = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => {
  const s = b.textContent?.trim() ?? "", a = b.getAttribute("aria-label") ?? "";
  return typeof t === "string" ? s === t || a === t : t.test(s) || t.test(a);
}) as HTMLButtonElement;
const setValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string, ev = "input") => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
  el.dispatchEvent(new Event(ev, { bubbles: true }));
};
const pick = (label: string, v: string) => act(async () => setValue(document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement, v, "change"));
const field = (label: string) => [...document.querySelectorAll("label")].find((l) => l.firstChild?.textContent === label)!.querySelector("input, textarea") as HTMLInputElement;
const click = (b: HTMLElement) => act(async () => b.click());
let engine: Engine;
const sb = () => engine.getState().project.storyboard!;
async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  engine.dispatch(cmd.addStoryVersion({ slot: "photo" }, img));
  engine.dispatch(cmd.addStoryVersion({ slot: "photo" }, img));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  return el;
}
const openShot = (id: string) => click(document.querySelector(`[data-shot="${id}"] .v2-sb-shot-main`) as HTMLElement);

describe("per-shot references (V2-CUT-05)", () => {
  it("pins a reference version for one shot and undoes it in one step", async () => {
    await mount();
    await openShot("a");
    const sel = document.querySelector('select[aria-label="Version of Photo for this shot"]') as HTMLSelectElement;
    expect(sel.options[0].textContent).toBe("Follow asset (v2)");
    const v1 = sel.options[1].value;
    await pick("Version of Photo for this shot", v1);
    expect(sb().shots.a.refOverrides).toEqual({ photo: v1 });
    expect(sb().shots.b.refOverrides).toBeUndefined();
    expect(document.querySelector(".v2-sb-refs + .v2-sb-swapnote")?.textContent).toContain("keeps v1 of “Photo”");
    expect(document.querySelector(".v2-sb-refs")?.textContent).toContain("Pinned v1 for this shot");
    // The board chip shows the pin for shot a only.
    expect(document.querySelector('[data-shot="a"] .v2-sb-slot.pinned')).toBeTruthy();
    expect(document.querySelector('[data-shot="b"] .v2-sb-slot.pinned')).toBeNull();
    await pick("Version of Photo for this shot", "");
    expect(sb().shots.a.refOverrides).toBeUndefined();
    await act(async () => engine.undo());
    expect(sb().shots.a.refOverrides).toEqual({ photo: v1 });
  });

  it("adds a new asset as a reference from the shot editor in one undo step", async () => {
    await mount();
    await openShot("b");
    await click(btn("Edit references"));
    await pick("Add a reference asset", "__new");
    await act(async () => setValue(field("Name"), "Keeper's coat"));
    await click(document.querySelector(".v2-sb-newref .primary") as HTMLElement);
    await click(btn("Save"));
    expect(sb().slots["keeper-s-coat"]?.name).toBe("Keeper's coat");
    expect(sb().shots.b.slotIds).toEqual(["photo", "keeper-s-coat"]);
    await act(async () => engine.undo());
    expect(sb().slots["keeper-s-coat"]).toBeUndefined();
    expect(sb().shots.b.slotIds).toEqual(["photo"]);
  });

  it("removing a pinned reference drops its pin", async () => {
    await mount();
    const v1 = engine.getState().project.assets[sb().slots.photo.assetId!].versions[0].id;
    engine.dispatch(cmd.setRefOverride("a", "photo", v1));
    await openShot("a");
    await click(btn("Edit references"));
    expect(document.querySelector(".v2-sb-editlist")?.textContent).toContain("pinned v1");
    await click(btn("Remove reference Photo"));
    await click(btn("Save"));
    expect(sb().shots.a.slotIds).toEqual([]);
    expect(sb().shots.a.refOverrides).toBeUndefined();
  });

  it("edits, adds and deletes asset slots with Undo", async () => {
    await mount();
    await click(btn(/^Photo:/));
    await click(btn("Edit"));
    await act(async () => setValue(field("Name"), "Harbour photo"));
    await click(btn("Save"));
    expect(sb().slots.photo.name).toBe("Harbour photo");

    await click(btn("Add asset"));
    await act(async () => setValue(field("Name"), "Lantern"));
    await click(btn("Save"));
    expect(sb().slots.lantern?.type).toBe("image");

    await click(btn("Edit"));
    await click(btn("Delete asset"));
    expect(document.querySelector(".v2-confirm")).toBeTruthy();
    await click(btn("Delete"));
    expect(sb().slots.lantern).toBeUndefined();
    await click(btn("Undo"));
    expect(sb().slots.lantern).toBeTruthy();
  });

  it("blocks deleting a shot's clip asset and says why", async () => {
    await mount();
    await click(btn(/^Card:/));
    await click(btn("Edit"));
    expect(btn("Delete asset").disabled).toBe(true);
    expect(document.body.textContent).toContain("It is the clip of shot 3");
    expect((document.querySelector(".v2-sb-slot-editor select") as HTMLSelectElement).disabled).toBe(true);
  });

  it("shows the version picker in the phone sheet", async () => {
    phone = true;
    await mount();
    await openShot("a");
    expect(document.querySelector('.v2-sheet select[aria-label="Version of Photo for this shot"], .v2-sb-sheet select[aria-label="Version of Photo for this shot"]')).toBeTruthy();
  });
});

describe("attach order and References block (V2-SB-120)", () => {
  it("lists the images to attach with roles and pinned versions, copies the prompt with the block, and saves an image", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const store = createMemoryStorage().blobs;
    await store.put("b", new Blob(["png"], { type: "image/png" }));
    engine = new Engine(createProject("t"));
    engine.dispatch(cmd.createStoryboard(doc));
    engine.dispatch(cmd.addStoryVersion({ slot: "photo" }, img));
    engine.dispatch(cmd.addStoryVersion({ slot: "photo" }, img));
    const v1 = engine.getState().project.assets[sb().slots.photo.assetId!].versions[0].id;
    engine.dispatch(cmd.setRefOverride("a", "photo", v1));
    await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={store} onClose={() => {}} />));
    await openShot("a");
    const list = document.querySelector('[data-testid="attach-order"]')!;
    expect(list.querySelector("h5")?.textContent).toBe("Attach in this order");
    expect(list.querySelector("li")?.textContent).toContain("Image 1 · Photo");
    expect(list.querySelector("li")?.textContent).toContain("Details only · pinned v1");

    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copied = t; } } });
    await click(document.querySelector('[data-testid="copy-clip-prompt"]') as HTMLElement);
    expect(copied).toMatch(/^References:\nImage 1 \(Photo\): reference only, not a frame: materials[\s\S]*No image is the start frame[\s\S]*\n\nWalk$/);

    const urls: string[] = [];
    URL.createObjectURL = (() => { urls.push("blob:x"); return "blob:x"; }) as never;
    URL.revokeObjectURL = (() => {}) as never;
    let downloaded = "";
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloaded = this.download; };
    try {
      await click(btn("Save image 1: Photo"));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    } finally { HTMLAnchorElement.prototype.click = orig; }
    expect(downloaded).toBe("shot1-image1-Photo.png");
    expect(document.querySelector('[data-testid="attach-order"] [role="status"]')?.textContent).toBe("Image 1 downloaded");
  });
});
