// @vitest-environment jsdom
/** P17-CLIP-SOURCE: the shot editor's Clip source (New clip / Reuse clip), the clip picker and own-to-shared clips. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, story } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  URL.createObjectURL = (() => "blob:test") as never;
  URL.revokeObjectURL = (() => {}) as never;
  HTMLMediaElement.prototype.pause = () => {};
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

const DOC = {
  format: "dionysus.storyboard/1", schemaVersion: "3.1", meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "s1-clip", name: "Clip · Desk", type: "video", prompt: "The man at the desk looks down.", auto: true },
    { id: "wide", name: "Wide climb", type: "video", prompt: "Wide shot of the climb." },
    { id: "s4-clip", name: "Clip · Objects", type: "video", prompt: "He picks them up.", auto: true, references: [{ frameOf: "s1", role: "start", frameDesc: "The desk, middle of shot 1." }] },
  ],
  shots: [
    { id: "s1", title: "Desk", description: "", durationSec: 4, clip: "s1-clip" },
    { id: "s2", title: "Climb", description: "", durationSec: 3, clip: "wide", inSec: 3 },
    { id: "s3", title: "Climb, later", description: "", durationSec: 3, clip: "wide", inSec: 6 },
    { id: "s4", title: "Objects", description: "", durationSec: 4, clip: "s4-clip" },
  ],
  connections: [],
};

async function mount() {
  const r = story.validateStoryboard(DOC);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const storage = createMemoryStorage();
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(r.doc));
  const el = document.createElement("div"); document.body.appendChild(el);
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
  return { el, engine, storage, p: () => engine.getState().project };
}
const card = (el: Element, id: string) => el.querySelector(`[data-shot="${id}"]`)!;
const open = async (el: Element, id: string) => { await act(async () => (card(el, id).querySelector(".v2-sb-shot-main") as HTMLButtonElement).click()); await wait(); };
const dialog = () => document.querySelector('[role="dialog"]')!;

const btn = (re: RegExp, root: ParentNode = document) => [...root.querySelectorAll("button")].find((b) => re.test(b.textContent?.trim() ?? "")) as HTMLButtonElement;
const save = () => act(async () => btn(/^(Save|Add shot)$/, document.querySelector("form.v2-sb-form")!).click());
const editShot = async (el: Element, id: string) => { await open(el, id); await act(async () => btn(/^Edit/, dialog()).click()); await wait(); };
const pickClip = (label: string) => act(async () => ([...document.querySelectorAll('[data-testid="clip-picker"] button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement).click());

describe("P17 clip source in the shot editor", () => {
  it("Add shot → Reuse clip: the picker lists clips with their first shot and state; no prompt is needed", async () => {
    const { el, p } = await mount();
    await act(async () => btn(/^\+?\s*Add shot$/, el).click()); await wait();
    await act(async () => btn(/Reuse clip/).click());
    const items = [...document.querySelectorAll('[data-testid="clip-picker"] [role="option"]')].map((x) => x.textContent);
    expect(items[0]).toContain("Clip A");
    expect(items[0]).toContain("First used in Shot 1");
    expect(items.find((t) => t?.includes("Clip B"))).toContain("Not generated");
    expect(document.querySelector("textarea[placeholder='What the AI video should show']")).toBeNull();
    await pickClip("Clip B");
    expect(document.querySelector('[data-testid="clip-trim"]')).toBeTruthy();
    await save();
    const b = p().storyboard!, id = b.order.at(-1)!;
    expect(b.shots[id].clipSlot).toBe("wide");
    expect(b.shots[id].prompt).toBe("");
    expect(board.shotClips(p())[id].label).toBe("Clip B");
  });

  it("reusing another shot's own clip makes it shareable first", async () => {
    const { el, p } = await mount();
    await act(async () => btn(/^\+?\s*Add shot$/, el).click()); await wait();
    await act(async () => btn(/Reuse clip/).click());
    await pickClip("Clip A");
    await save();
    const b = p().storyboard!, id = b.order.at(-1)!;
    expect(b.shots.s1.clipSlot).toBeTruthy();
    expect(b.shots[id].clipSlot).toBe(b.shots.s1.clipSlot);
    expect(b.slots[b.shots.s1.clipSlot!].prompt).toBe("The man at the desk looks down.");
    expect(board.shotClips(p())[id].label).toBe("Clip A");
  });

  it("switching an own-clip shot to Reuse clip asks first, then drops its own prompt", async () => {
    const { el, p } = await mount();
    await editShot(el, "s1");
    await act(async () => btn(/Reuse clip/).click());
    await pickClip("Clip B");
    await save();
    expect(document.querySelector('[data-testid="reuse-confirm"]')).toBeTruthy();
    expect(p().storyboard!.shots.s1.clipSlot).toBeUndefined();
    await act(async () => btn(/^Reuse clip$/, document.querySelector('[data-testid="reuse-confirm"]')!).click());
    const s1 = p().storyboard!.shots.s1;
    expect(s1.clipSlot).toBe("wide");
    expect(s1.prompt).toBe("");
  });

  it("a reuse shot can go back to New clip; the prompt is required only then", async () => {
    const { el, p } = await mount();
    await editShot(el, "s3");
    await act(async () => btn(/New clip/).click());
    const ta = document.querySelector("textarea[placeholder='What the AI video should show']") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(ta, "Close on the hands."); ta.dispatchEvent(new Event("input", { bubbles: true })); });
    await save();
    const b = p().storyboard!;
    expect(b.shots.s3.clipSlot).toBeUndefined();
    expect(b.shots.s3.prompt).toBe("Close on the hands.");
    expect(b.slots.wide).toBeTruthy(); // still used by Shot 2
  });

  it("Make this shot's clip shareable turns an own clip into a shared clip", async () => {
    const { el, p } = await mount();
    const before = Object.keys(p().storyboard!.slots).length;
    await editShot(el, "s1");
    const box = document.querySelector('[data-testid="make-shareable"]') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    await act(async () => box.click());
    await save();
    const b = p().storyboard!;
    expect(Object.keys(b.slots).length).toBe(before + 1);
    expect(b.slots[b.shots.s1.clipSlot!].prompt).toBe("The man at the desk looks down.");
    expect(b.shots.s1.prompt).toBe("");
  });
});
