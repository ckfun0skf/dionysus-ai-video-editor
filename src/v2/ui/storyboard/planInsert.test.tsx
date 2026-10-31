// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, story, storyInsert } from "../../domain";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let phone = false, clip = "";
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { clip = t; } }, configurable: true });
});
afterEach(() => { document.body.innerHTML = ""; phone = false; clip = ""; });

const doc = (() => { const r = story.validateStoryboard(LANTERN_KEEPER); if (!r.ok) throw new Error("bad"); return r.doc; })();
const btn = (t: string | RegExp) => [...document.querySelectorAll("button")].find((b) => {
  const s = b.textContent?.trim() ?? "", a = b.getAttribute("aria-label") ?? "";
  return typeof t === "string" ? s === t || a === t : t.test(s) || t.test(a);
}) as HTMLButtonElement;
const type = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const area = (label: RegExp) => [...document.querySelectorAll("label")].find((l) => label.test(l.firstChild?.textContent ?? ""))!.querySelector("textarea") as HTMLTextAreaElement;
const click = (b: HTMLElement) => act(async () => b.click());
let engine: Engine;
const ids = () => engine.getState().project.storyboard!.order;
async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
}

describe.each([["desktop", false], ["phone", true]])("Insert shot after → Plan with AI (%s)", (_n, isPhone) => {
  it("describes, copies the prompt, previews and inserts in one undo step", async () => {
    phone = isPhone;
    await mount();
    await click(btn("Shot 2 actions"));
    await click(btn("Insert shot after"));
    expect(btn("Blank shot")).toBeTruthy();
    await click(btn("Plan with AI"));
    if (isPhone) expect(document.querySelector(".v2-sheet-backdrop, .v2-sheet")).toBeTruthy();

    // Describe: prefilled with the shot's description; Continue is disabled while empty.
    const d = area(/^Briefly describe the last shot/);
    expect(d.value).toBe(doc.shots[1].description);
    await act(async () => type(d, "  "));
    expect(btn("Continue").disabled).toBe(true);
    await act(async () => type(area(/^Briefly describe the last shot/), "The keeper lights the lamp and looks out to sea."));
    expect(btn("Continue").disabled).toBe(false);
    await click(btn("Continue"));

    // Prompt + Copy.
    const p = (document.querySelector('textarea[aria-label="Planning prompt"]') as HTMLTextAreaElement).value;
    expect(p).toContain("The keeper lights the lamp and looks out to sea.");
    expect(p).toContain('"schema":"3.1-insert","insertAfter":"s2"');
    await click(btn("Copy prompt"));
    expect(clip).toBe(p);
    await click(btn("Paste answer"));

    // Paste: errors stay on this step.
    await act(async () => type(area(/^Paste the AI/), JSON.stringify({ ...storyInsert.EXAMPLE_INSERT, insertAfter: "s1" })));
    await click(btn("Check"));
    expect(document.querySelector('[aria-label="Errors"]')?.textContent).toMatch(/Expected "s2"/);
    await act(async () => type(area(/^Paste the AI/), "```json\n" + JSON.stringify(storyInsert.EXAMPLE_INSERT) + "\n```"));
    await click(btn("Check"));

    // Preview: new vs reused.
    const shots = document.querySelector('[aria-label="Shots to insert"]')!.textContent!;
    expect(shots).toMatch(/Shot 3 · Close on the lantern/); expect(shots).toMatch(/Clip s2b-clip\s*Needs generation/); expect(shots).toMatch(/Clip s2-clip\s*Reused/);
    const assets = document.querySelector('[aria-label="Assets and clips"]')!.textContent!;
    expect(assets).toMatch(/s2b-clip · video\s*Needs generation/); expect(assets).toMatch(/keeper · character\s*Reused/);
    expect(document.querySelector('[aria-label="Warnings"]')?.textContent).toMatch(/camera/);

    const before = [...ids()];
    await click(btn("Insert 2 shots"));
    expect(ids()).toEqual(["s1", "s2", "s2b", "s2c", "s3"]);
    expect(document.querySelector('[aria-label^="Shot 5:"]')?.getAttribute("aria-label")).toMatch(/Beam across the storm/);
    await act(async () => engine.undo());
    expect(ids()).toEqual(before);
  });
});

describe("Insert shot after → Blank shot", () => {
  it("still opens the new-shot editor", async () => {
    await mount();
    await click(btn("Shot 1 actions"));
    await click(btn("Insert shot after"));
    await click(btn("Blank shot"));
    expect(document.querySelector('[aria-label^="New shot"], [aria-label*="shot 2"]')).toBeTruthy();
  });
});

describe("P22: pre-existing board issues do not block Plan with AI", () => {
  it("shows them in a collapsed non-blocking section and inserts", async () => {
    phone = true;
    const messy = structuredClone(doc);
    messy.assets.push({ ...messy.assets.find((a) => a.id === "keeper")!, id: "news-2", name: "News 2", prompt: "" });
    messy.shots.push({ id: "s4", title: "Blank", description: "", durationSec: 2, prompt: "", assets: [], qa: [] });
    const el = document.createElement("div"); document.body.appendChild(el);
    engine = new Engine(createProject("t"));
    engine.dispatch(cmd.createStoryboard(messy));
    await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
    await click(btn("Shot 4 actions"));
    await click(btn("Insert shot after"));
    await click(btn("Plan with AI"));
    await act(async () => type(area(/^Briefly describe the last shot/), "An empty room."));
    await click(btn("Continue"));
    await click(btn("Paste answer"));
    const ans = { schema: "3.1-insert", insertAfter: "s4", shots: [{ id: "s5", title: "Reaction", description: "x", durationSec: 2, clip: "s2-clip", inSec: 0 }], newAssets: [] };
    await act(async () => type(area(/^Paste the AI/), JSON.stringify(ans)));
    await click(btn("Check"));
    expect(document.querySelector('[aria-label="Errors"]')).toBeNull();
    const ex = document.querySelector('details[aria-label="Existing storyboard issues"]') as HTMLDetailsElement;
    expect(ex).toBeTruthy(); expect(ex.open).toBe(false);
    expect(ex.textContent).toMatch(/Existing storyboard issues \(not blocking\)/);
    expect(ex.textContent).toMatch(/news-2/);
    expect(ex.textContent).not.toMatch(/"s4"\.clip/);
    expect(btn("Insert 1 shot").disabled).toBe(false);
    await click(btn("Insert 1 shot"));
    expect(ids()).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(engine.getState().project.storyboard!.shots["s4"].needsPrompt).toBeFalsy();
  });
});
