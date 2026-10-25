// @vitest-environment jsdom
/** V2-SB-136: the States section on an asset, adding a state, and a state's detail and editor. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, story } from "../../domain";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const btn = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => { const s = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""; return typeof t === "string" ? s === t || b.textContent?.trim() === t : t.test(s) || t.test(b.textContent ?? ""); }) as HTMLButtonElement;
const click = (b: Element) => act(async () => (b as HTMLElement).click());
const tid = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const r = story.validateStoryboard(LANTERN_KEEPER);
  if (!r.ok) throw new Error("bad");
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(r.doc));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  return { engine, sb: () => engine.getState().project.storyboard! };
}

describe("asset states UI (V2-SB-136)", () => {
  it("adds a state from the asset's States section and opens it; the state links back to its base", async () => {
    const { engine, sb } = await mount();
    await click(btn(/^The keeper:/));
    expect(tid("asset-states")).toBeNull();
    await click(tid("state-add")!);
    const input = tid("state-name") as HTMLInputElement;
    expect((tid("state-create") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => setValue(input, "Soaked"));
    await click(tid("state-create")!);
    expect(sb().slots["keeper@soaked"]).toMatchObject({ stateOf: "keeper", name: "The keeper · Soaked", type: "character" });
    // The new state is open: it says what it is and links to the base.
    expect(tid("state-of")!.textContent).toContain("State “Soaked” of “The keeper”");
    await click(btn("Open “The keeper”"));
    expect(tid("asset-states")!.textContent).toContain("Soaked");
    expect(tid("asset-states")!.textContent).toContain("keeper@soaked");
    // One undo step removes it.
    await act(async () => engine.undo());
    expect(sb().slots["keeper@soaked"]).toBeUndefined();
  });

  it("a state's editor keeps the base's type and the base in Made from; the base can't be deleted while it has states", async () => {
    const { engine } = await mount();
    await act(async () => engine.dispatch(cmd.addAssetState("keeper", "Old")));
    await click(btn(/^The keeper · Old:/));
    await click(btn("Edit"));
    expect(tid("state-editor-note")).toBeTruthy();
    expect((document.querySelector(".v2-sb-slot-editor select") as HTMLSelectElement).disabled).toBe(true);
    await click(btn("Cancel"));
    await click(btn("Open “The keeper”"));
    await click(btn("Edit"));
    expect(btn("Delete asset").disabled).toBe(true);
    expect(document.body.textContent).toContain("It has a state (Old). Delete it first.");
  });

  it("offers no States section on audio or video assets", async () => {
    const { engine } = await mount();
    await act(async () => engine.dispatch(cmd.addSlot("bed", { name: "Bed", type: "audio" })));
    await click(btn(/^Bed:/));
    expect(tid("state-add")).toBeNull();
  });
});
