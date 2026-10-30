// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, ops, story, type MediaRef } from "../../domain";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { secondsToTicks as s } from "../../domain/time";
import { StoryboardView } from "./StoryboardView";

let phone = false;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: phone && q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; phone = false; });

const doc = (() => { const r = story.validateStoryboard(LANTERN_KEEPER); if (!r.ok) throw new Error("bad"); return r.doc; })();
const media = (sec: number): MediaRef => ({ blobKey: `b${sec}`, mime: "video/mp4", durationTicks: s(sec) });
const btn = (el: Element, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;
const setText = (ta: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, v);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

function setup(withBoard = true) {
  const e = new Engine(createProject("t"));
  if (withBoard) { e.dispatch(cmd.createStoryboard(doc)); e.dispatch(cmd.addStoryVersion({ shot: "s1" }, media(5), { versionId: "a1" })); }
  return e;
}
async function mountBoard(e: Engine, onView?: (id: string) => void) {
  const el = document.createElement("div"); document.body.appendChild(el);
  await act(async () => createRoot(el).render(<StoryboardView engine={e} blobs={createMemoryStorage().blobs} onClose={() => {}} onView={onView} />));
  return el;
}

describe("storyboard review P2 (second batch)", () => {
  it("R13: the Send note offers View, which hands over the first new clip", async () => {
    const e = setup();
    const onView = vi.fn();
    const el = await mountBoard(e, onView);
    await act(async () => btn(el, "Send to timeline").click());
    const note = el.querySelector(".v2-sb-note")!;
    expect(note.textContent).toMatch(/Added 1 clip/);
    await act(async () => btn(note, "View").click());
    const p = e.getState().project;
    const placed = ops.mainTrack(p.compositions[p.rootCompositionId])!.placements;
    expect(onView).toHaveBeenCalledWith(placed[0].id);
  });

  it("R12/P2A: desktop header has labelled AI prompt, Export and Import buttons", async () => {
    const el = await mountBoard(setup());
    expect(btn(el, "AI prompt").textContent).toContain("AI prompt");
    expect(btn(el, "Export JSON").textContent).toContain("Export");
    await act(async () => btn(el, "Import revised JSON").click());
    expect(el.querySelector('[aria-label="Storyboard JSON"]')).not.toBeNull();
  });

  it("R11: on phones Send is the labelled primary and the rest sits in a '⋯' menu", async () => {
    phone = true;
    const el = await mountBoard(setup());
    const send = btn(el, "Send to timeline");
    expect(send.classList.contains("primary")).toBe(true);
    expect(send.textContent!.trim()).toBe("Send");
    expect(btn(el, "AI prompt")).toBeUndefined();
    await act(async () => btn(el, "More storyboard actions").click());
    const items = [...el.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent!.trim());
    expect(items).toEqual(["AI prompt", "Export JSON", "Import revised JSON…"]);
    await act(async () => (el.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click());
    expect(el.querySelector('[aria-label="Storyboard JSON export"]')).not.toBeNull();
  });

  it("P2A: re-import previews adds, changes and removals and keeps uploads", async () => {
    const e = setup();
    const el = await mountBoard(e);
    await act(async () => btn(el, "Import revised JSON").click());
    const next = structuredClone(LANTERN_KEEPER) as unknown as { shots: { id: string; title: string }[]; connections?: unknown[] };
    next.shots[0].title = "Renamed";
    const gone = next.shots.pop()!; next.connections = [];
    next.shots.push({ ...structuredClone(gone), id: "s9", title: "Brand new" });
    await act(async () => setText(el.querySelector('[aria-label="Storyboard JSON"]') as HTMLTextAreaElement, JSON.stringify(next)));
    expect(el.querySelector('[data-testid="merge-added"]')!.textContent).toContain("Brand new");
    expect(el.querySelector('[data-testid="merge-changed"]')!.textContent).toContain("Renamed");
    expect(el.querySelector('[data-testid="merge-removed"]')!.textContent).toContain(gone.title);
    await act(async () => (el.querySelector('[data-testid="merge-apply"]') as HTMLButtonElement).click());
    expect(el.textContent).toContain("Remove from the storyboard?");
    await act(async () => btn(el.querySelector('[role="alertdialog"]')!, "Apply changes").click());
    const sb = e.getState().project.storyboard!;
    expect(sb.order).toEqual(["s1", "s2", "s9"]);
    expect(sb.shots.s1.title).toBe("Renamed");
    expect(sb.versions.a1).toBeDefined();
  });

  it("P2A: export offers download and copy of round-trippable JSON", async () => {
    const e = setup();
    const el = await mountBoard(e);
    await act(async () => btn(el, "Export JSON").click());
    const text = (el.querySelector('[aria-label="Storyboard JSON export"]') as HTMLTextAreaElement).value;
    const r = story.validateStoryboard(JSON.parse(text));
    expect(r.ok).toBe(true);
    expect(el.querySelector('[data-testid="export-download"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="export-copy"]')).not.toBeNull();
  });

  it("P2A: a second Send offers Update or Replace (with confirm)", async () => {
    const e = setup();
    const el = await mountBoard(e);
    await act(async () => btn(el, "Send to timeline").click());
    await act(async () => btn(el, "Send to timeline").click());
    expect(el.querySelector('[data-testid="send-update"]')!.textContent).toMatch(/up to date/);
    await act(async () => (el.querySelector('[data-testid="send-replace"]') as HTMLButtonElement).click());
    expect(el.textContent).toContain("Replace the timeline?");
    await act(async () => btn(el, "Replace timeline").click());
    const p = e.getState().project;
    expect(ops.mainTrack(p.compositions[p.rootCompositionId])!.placements).toHaveLength(1);
  });

  it("R10: phone production keeps text states and the nav says the state", async () => {
    phone = true;
    const el = await mountBoard(setup());
    await act(async () => btn(el, "Production steps").click());
    const states = [...el.querySelectorAll(".v2-prod-state-m")].map((x) => x.textContent);
    expect(states.length).toBeGreaterThan(1);
    expect(states.every((t) => t && t.length > 0)).toBe(true);
    await act(async () => (el.querySelector(".v2-prod-step") as HTMLButtonElement).click());
    expect(el.querySelector(".v2-prod-count")!.textContent).toMatch(/^1\/\d+ · \S/);
  });

  it("R14: Load example fills a valid storyboard; problems select their JSON", async () => {
    const el = await mountBoard(setup(false));
    await act(async () => btn(el, "2 · Import JSON")?.click() ?? [...el.querySelectorAll("button")].find((b) => /Import/.test(b.textContent ?? ""))!.click());
    await act(async () => btn(el, "Load example").click());
    expect(el.querySelector('[data-testid="story-preview"]')).not.toBeNull();
    const ta = el.querySelector('[aria-label="Storyboard JSON"]') as HTMLTextAreaElement;
    const bad = structuredClone(LANTERN_KEEPER) as unknown as { shots: { durationSec: unknown }[] };
    bad.shots[1].durationSec = "five";
    const text = "Here you go:\n```json\n" + JSON.stringify(bad, null, 2) + "\n```";
    await act(async () => setText(ta, text));
    const err = [...el.querySelectorAll(".v2-sb-errlink")].find((b) => b.textContent!.includes("shots[1].durationSec")) as HTMLButtonElement;
    expect(err.textContent).toContain('Duration "five"');
    await act(async () => err.click());
    expect(text.slice(ta.selectionStart, ta.selectionEnd)).toBe('"durationSec": "five"');
  });

  it("V2-SB-112: import warnings show their path and select their JSON", async () => {
    const el = await mountBoard(setup(false));
    await act(async () => btn(el, "2 · Import JSON")?.click() ?? [...el.querySelectorAll("button")].find((b) => /Import/.test(b.textContent ?? ""))!.click());
    const ta = el.querySelector('[aria-label="Storyboard JSON"]') as HTMLTextAreaElement;
    const fx = JSON.parse(readFileSync(resolve(__dirname, "../../domain/__fixtures__/ep01_opening.storyboard.json"), "utf8"));
    fx.shots[2].layers[0].textStyle = "sparkle";
    const text = JSON.stringify(fx, null, 2);
    await act(async () => setText(ta, text));
    expect(el.querySelector('[data-testid="story-preview"]')).not.toBeNull();
    const warn = el.querySelector('[data-testid="story-warnings"] .v2-sb-errlink') as HTMLButtonElement;
    expect(warn.textContent).toContain("shots[2].layers[0].textStyle");
    expect(warn.textContent).toContain('Unknown text style "sparkle"');
    await act(async () => warn.click());
    expect(text.slice(ta.selectionStart, ta.selectionEnd)).toBe('"textStyle": "sparkle"');
  });

  it("R14: locateIssue maps paths, parents and syntax errors to the pasted text", () => {
    const json = '{\n  "meta": { "title": "x" },\n  "shots": [ { "id": "a", "durationSec": 0 } ]\n}';
    const text = "Sure!\n" + json;
    const r = (path: string, at?: number) => { const x = story.locateIssue(text, { path, message: "", at })!; return text.slice(x.start, x.end); };
    expect(r("shots[0].durationSec")).toBe('"durationSec": 0');
    expect(r("meta.title")).toBe('"title": "x"');
    expect(r("shots[0].missing")).toBe('{ "id": "a", "durationSec": 0 }');
    const broken = '{ "shots": [ }';
    const res = story.parseStoryboard(broken);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0].at).toBeTypeOf("number");
  });

  it("R15: the version in use says so on the card, not in a tooltip", () => {
    const src = readFileSync(resolve(__dirname, "StoryDetail.tsx"), "utf8");
    expect(src).not.toMatch(/title=\{on \? "In use"/);
    expect(src).toContain("v2-sb-inuse");
  });

  it("phones: the clip toolbar shows Storyboard before Split for linked clips", () => {
    const src = readFileSync(resolve(__dirname, "../V2App.tsx"), "utf8");
    expect(src.indexOf('"open-story"')).toBeGreaterThan(0);
    expect(src.indexOf('"open-story"')).toBeLessThan(src.lastIndexOf('tool("✂", "Split", split)'));
    expect(src.indexOf('"open-story"')).toBeLessThan(src.indexOf('tool("☑", "Select"'));
  });
});
