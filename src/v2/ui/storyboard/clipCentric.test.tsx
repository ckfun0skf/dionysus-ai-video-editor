// @vitest-environment jsdom
/** P16: clip-centric shot cards (schema 3.1), the shared-clip trim controls, the prompt warning and the Pick frame button. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, story, TICKS_PER_SECOND } from "../../domain";
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
const T = TICKS_PER_SECOND;
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

describe("P16 clip-centric shot UI", () => {
  it("shot cards show the clip and its range; a reuse waits for the first shot, then shows Generated", async () => {
    const { el, engine } = await mount();
    expect(card(el, "s1").querySelector('[data-testid="clip-line"]')!.textContent).toBe("Clip A · 0:00–0:04");
    expect(card(el, "s2").querySelector('[data-testid="clip-line"]')!.textContent).toBe("Clip B · 0:03–0:06");
    const s3 = card(el, "s3").querySelector('[data-testid="clip-line"]')!.textContent;
    expect(s3).toContain("Clip B · 0:06–0:09");
    expect(s3).toContain("Reuses Clip B (generated in Shot 2)");
    expect(s3).toContain("Waiting for Shot 2");
    await act(async () => engine.dispatch(cmd.addStoryVersion({ slot: "wide" }, { blobKey: "w", mime: "video/mp4", durationTicks: 12 * T })));
    expect(card(el, "s3").querySelector('[data-testid="clip-line"]')!.textContent).toContain("Generated");
  });

  it("a reusing shot has no generate / add button, only trim controls that move its in point", async () => {
    const { el, p } = await mount();
    await open(el, "s3");
    const d = dialog();
    expect(d.textContent).toContain("Reuses Clip B (generated in Shot 2)");
    expect([...d.querySelectorAll("button")].some((b) => /Add clip|Add new version|Generate/.test(b.textContent ?? ""))).toBe(false);
    expect(d.querySelector('[data-testid="clip-affects-note"]')!.textContent).toContain("Shot 2, Shot 3");
    const later = d.querySelector('button[aria-label="In point 0.5 s later"]') as HTMLButtonElement;
    await act(async () => later.click());
    expect(p().storyboard!.shots.s3.clipInSec).toBe(6.5);
    expect(dialog().querySelector('[data-testid="shot-clip-head"]')!.textContent).toContain("0:07–0:10");
  });

  it("the first shot of a shared clip can add it; Send plays the reuse from its in point", async () => {
    const { el, engine, p } = await mount();
    await open(el, "s2");
    expect([...dialog().querySelectorAll("button")].some((b) => b.textContent?.includes("Add clip"))).toBe(true);
    await act(async () => { engine.dispatch(cmd.addStoryVersion({ slot: "wide" }, { blobKey: "w", mime: "video/mp4", durationTicks: 12 * T })); engine.dispatch(cmd.sendStoryToTimeline()); });
    const pr = p();
    const pl = pr.compositions[pr.rootCompositionId].tracks.flatMap((t) => t.placements);
    expect(pl.map((x) => x.sourceInTicks)).toContain(6 * T);
  });

  it("editing a reuse shot hides the clip prompt, and Save keeps the link and the in point (P17 regression)", async () => {
    const { el, p } = await mount();
    await open(el, "s3");
    const edit = [...dialog().querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Edit"))!;
    await act(async () => edit.click()); await wait();
    const reuse = document.querySelector('[role="radiogroup"][aria-label="Clip source"] [aria-checked="true"]')!;
    expect(reuse.textContent).toContain("Reuse clip");
    expect([...document.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Clip prompt"))).toBe(false);
    await act(async () => (document.querySelector('[aria-label="In point later"]') as HTMLButtonElement).click());
    const done = [...document.querySelectorAll("button")].find((b) => /^(Done|Save)$/.test(b.textContent?.trim() ?? ""))!;
    expect(done.disabled).toBe(false);
    await act(async () => done.click());
    expect(p().storyboard!.shots.s3.clipSlot).toBe("wide");
    expect(p().storyboard!.shots.s3.clipInSec).toBe(6.5);
    expect(p().storyboard!.slots.wide.prompt).toBe("Wide shot of the climb.");
  });

  it("the small Pick frame button in shot detail opens the frame picker directly", async () => {
    const { el, engine } = await mount();
    await act(async () => engine.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "c", mime: "video/mp4", durationTicks: 4 * T })));
    await open(el, "s4");
    const slotId = Object.keys(engine.getState().project.storyboard!.slots).find((k) => k.includes("frameof"))!;
    expect(board.frameRefState(engine.getState().project, slotId).state).toBe("pick");
    const small = dialog().querySelector('[data-testid="ref-pick-frame"]') as HTMLButtonElement;
    expect(small.textContent).toContain("Pick frame");
    await act(async () => small.click()); await wait();
    expect(document.querySelector('[role="dialog"][aria-label="Pick frame from Shot 1"]')).toBeTruthy();
  });
});
