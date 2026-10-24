// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, EXAMPLE_STORYBOARD, story, storySteps } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let phone = false;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: phone && /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; phone = false; });
const btn = (el: Element, t: string) => [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === t || b.textContent?.trim() === t) as HTMLButtonElement;
const doc = (() => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return r.doc; })();

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  await act(async () => btn(el, "Production steps").click());
  const p = () => engine.getState().project;
  const keys = () => board.productionSteps(p()).map((s) => s.key);
  const rows = () => [...el.querySelectorAll<HTMLElement>("[data-step]")].map((r) => r.dataset.step);
  const row = (k: string) => el.querySelector<HTMLElement>(`[data-step="${k}"] .v2-prod-step`)!;
  const note = () => el.querySelector(".v2-sb-note")?.textContent ?? "";
  return { el, engine, p, keys, rows, row, note };
}
const altKey = (t: HTMLElement, key: string) => act(async () => { t.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true })); });

describe("production steps: reorder within dependency order (V2-CUT-07)", () => {
  it("Alt+↑/↓ moves a step, stops at dependencies with a note, and Undo restores the order", async () => {
    const { el, p, keys, rows, row, note } = await mount();
    const start = keys();
    expect(rows()).toEqual(start);
    expect(el.querySelector(".v2-prod-order")!.textContent).toContain("Suggested order");
    // A step that can move down by one.
    const j = start.findIndex((_, i) => storySteps.stepMoveRange(p().storyboard!, start, i).max > i);
    const k = start[j];
    await altKey(row(k), "ArrowDown");
    expect(keys().indexOf(k)).toBe(j + 1);
    expect(rows()).toEqual(keys());
    expect(note()).toContain(`to step ${j + 2}`);
    expect(p().storyboard!.stepOrder).toEqual(keys());
    expect(el.querySelector(".v2-prod-order")!.textContent).toContain("Your order");
    // One undo step.
    await act(async () => btn(el, "Undo").click());
    expect(keys()).toEqual(start);
    expect(p().storyboard!.stepOrder).toBeUndefined();
    // A shot can't go above the assets it needs.
    const shot = start.findIndex((x) => x.startsWith("shot:") && (storySteps.stepDeps(p().storyboard!).get(x) ?? []).length > 0);
    for (let i = 0; i < shot + 1; i += 1) await altKey(row(start[shot]), "ArrowUp");
    const after = keys().indexOf(start[shot]);
    const need = storySteps.stepDeps(p().storyboard!).get(start[shot])!.map((d) => keys().indexOf(d));
    expect(after).toBe(Math.max(...need) + 1);
    expect(note()).toMatch(/can’t move up: it needs .+ first/);
    expect(document.activeElement).toBe(row(start[shot]));
  });

  it("right-click menu: as late as possible, and Reset order", async () => {
    const { el, keys, row, note, p } = await mount();
    const start = keys();
    const k = start[0];
    const r = row(k);
    await act(async () => { r.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 })); });
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Step 1 actions");
    const late = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("as late as possible"))!;
    await act(async () => late.click());
    const max = storySteps.stepMoveRange(p().storyboard!, start, 0).max;
    expect(keys().indexOf(k)).toBe(max);
    expect(note()).toContain(`to step ${max + 1}`);
    await act(async () => btn(el, "Reset order").click());
    expect(keys()).toEqual(start);
    expect(note()).toContain("suggested order");
  });

  it("phone: the list says how to move steps and the press-and-hold menu is not the browser's", async () => {
    phone = true;
    const { el, row, keys } = await mount();
    expect(el.querySelector(".v2-prod-order")!.textContent).toContain("long-press a step to move it");
    expect(el.querySelector(".v2-prod-grip")).toBeNull();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => { row(keys()[0]).dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
