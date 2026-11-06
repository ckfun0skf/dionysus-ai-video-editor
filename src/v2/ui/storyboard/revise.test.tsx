// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, roundtrip, story } from "../../domain";
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

describe("Revise with AI (P36)", () => {
  it("header button → describe → copy prompt → paste → preview → Apply in one undo step", async () => {
    await mount();
    await click(btn("Revise with AI"));
    expect(btn("Continue").disabled).toBe(true);
    await act(async () => type(area(/What should change/), "Shot 3 is too long."));
    await click(btn("Continue"));
    await click(btn(/Copy prompt/));
    expect(clip).toContain('"schema":"3.1-revise"');
    await click(btn("Paste answer"));
    const s3 = (JSON.parse(story.storyDocJson(roundtrip.storyboardToDoc(engine.getState().project.storyboard!))).shots as Record<string, unknown>[]).find((s) => s.id === "s3")!;
    await act(async () => type(area(/Paste the AI/), JSON.stringify({ schema: "3.1-revise", shots: [{ ...s3, title: "Dawn" }] })));
    await click(btn("Check"));
    expect(document.querySelector(".v2-pi-issues")?.textContent ?? "").toBe("");
    expect(document.body.textContent).toContain("Changed shots");
    await click(btn(/Apply/));
    expect(engine.getState().project.storyboard!.shots.s3.title).toBe("Dawn");
    await act(async () => { engine.undo(); });
    expect(engine.getState().project.storyboard!.shots.s3.title).not.toBe("Dawn");
    expect(ids()).toEqual(["s1", "s2", "s3"]);
  });
});
