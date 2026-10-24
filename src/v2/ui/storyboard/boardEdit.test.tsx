// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, EXAMPLE_STORYBOARD, story } from "../../domain";
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

const doc = (() => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return r.doc; })();
const btn = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => {
  const s = b.textContent?.trim() ?? "", a = b.getAttribute("aria-label") ?? "";
  return typeof t === "string" ? s === t || a === t : t.test(s) || t.test(a);
}) as HTMLButtonElement;
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const field = (label: string) => [...document.querySelectorAll("label")].find((l) => l.firstChild?.textContent === label)!.querySelector("input, textarea") as HTMLInputElement;
const titles = (e: Engine) => e.getState().project.storyboard!.order.map((id) => e.getState().project.storyboard!.shots[id].title);
let engine: Engine;
async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  return el;
}
const click = (b: HTMLElement) => act(async () => b.click());

describe("board editing (V2-CUT-02)", () => {
  it("edits a shot from the ⋯ menu in one undo step", async () => {
    await mount();
    const before = titles(engine);
    await click(btn("Shot 1 actions"));
    await click(btn(/^Edit shot/));
    await act(async () => { type(field("Title"), "Harbour at dawn"); type(field("Length (s)"), "7"); });
    await click(btn("Save"));
    const s = engine.getState().project.storyboard!.shots[engine.getState().project.storyboard!.order[0]];
    expect(s.title).toBe("Harbour at dawn");
    expect(s.durationSec).toBe(7);
    expect(document.querySelector('[aria-label="Shot 1: Harbour at dawn"]')).toBeTruthy();
    await act(async () => engine.undo());
    expect(titles(engine)).toEqual(before);
  });

  it("adds a shot only on save", async () => {
    await mount();
    const n = titles(engine).length;
    await click(btn("Add shot"));
    await click(btn("Cancel"));
    expect(titles(engine)).toHaveLength(n);
    await click(btn("Add shot"));
    await act(async () => type(field("Title"), "Epilogue"));
    await click(btn("Save"));
    expect(titles(engine)).toHaveLength(n + 1);
    expect(titles(engine).at(-1)).toBe("Epilogue");
    expect(document.querySelector(".v2-sb-note")!.textContent).toContain(`Added shot ${n + 1}`);
  });

  it("moves with Alt+Arrow and from the menu, and undoes", async () => {
    await mount();
    const [a, b2, c] = titles(engine);
    const main = document.querySelector(".v2-sb-shot-main") as HTMLButtonElement;
    await act(async () => main.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })));
    expect(titles(engine)).toEqual([b2, a, c]);
    expect(document.querySelector(".v2-sb-note")!.textContent).toMatch(/Moved .* to shot 2.*keep their place/);
    await click(btn("Shot 2 actions"));
    expect(btn(/^Move down/).disabled).toBe(false);
    await click(btn(/^Move down/));
    expect(titles(engine)).toEqual([b2, c, a]);
    await act(async () => engine.undo()); await act(async () => engine.undo());
    expect(titles(engine)).toEqual([a, b2, c]);
  });

  it("deletes after confirming and offers Undo", async () => {
    await mount();
    const [a, b2, c] = titles(engine);
    const main = document.querySelectorAll(".v2-sb-shot-main")[1] as HTMLButtonElement;
    await act(async () => main.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
    expect(document.body.textContent).toContain(`Delete shot 2 “${b2}”?`);
    await click(btn("Delete"));
    expect(titles(engine)).toEqual([a, c]);
    await click(btn("Undo"));
    expect(titles(engine)).toEqual([a, b2, c]);
  });

  it("sets a transition on a connection", async () => {
    await mount();
    const sb = () => engine.getState().project.storyboard!;
    const [s1, s2] = sb().order;
    await click(btn(/to shot 2\. Edit connection/));
    await click(btn(/Dip to black/));
    const c = sb().connections.find((x) => x.from === s1 && x.to === s2)!;
    expect(c.transition?.preset).toContain("dip");
    await click(btn("1 s"));
    expect(sb().connections.find((x) => x.from === s1 && x.to === s2)!.transition?.params?.durationSec).toBe(1);
    await click(btn("None"));
    expect(sb().connections.find((x) => x.from === s1 && x.to === s2)?.transition).toBeUndefined();
    await act(async () => engine.undo());
    expect(sb().connections.find((x) => x.from === s1 && x.to === s2)!.transition?.params?.durationSec).toBe(1);
  });

  it("uses an action sheet on phones", async () => {
    phone = true;
    await mount();
    await click(btn("Shot 1 actions"));
    const sheet = document.querySelector(".v2-sb-actsheet")!;
    expect(sheet).toBeTruthy();
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Edit shot", "Duplicate", "Insert shot after", "Move up", "Move down", "Delete shot…", "Cancel"]);
    const n = titles(engine).length;
    await click(btn("Duplicate"));
    expect(titles(engine)).toHaveLength(n + 1);
    expect(titles(engine)[1]).toMatch(/\(copy\)$/);
  });
});
