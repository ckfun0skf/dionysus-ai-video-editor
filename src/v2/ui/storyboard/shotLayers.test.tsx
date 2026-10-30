// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board as sb, story } from "../../domain";
import { EXAMPLE_STORYBOARD } from "../../domain/storyPrompt";
import { BackgroundEditor, LayersEditor } from "./ShotLayers";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; });
const btn = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
const board = () => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return sb.storyboardFromDoc(r.doc); };

describe("P2B: Add layer", () => {
  it("offers Text / Overlay / Code and adds an editable layer", () => {
    const b = board();
    let layers: story.StoryLayer[] = [];
    const el = document.createElement("div"); document.body.append(el);
    const root = createRoot(el);
    const render = () => root.render(<LayersEditor b={b} layers={layers} effects={[]} dur={3} onLayers={(l) => { layers = l; render(); }} onEffects={() => {}} effectName={(x) => x} />);
    act(render);
    act(() => btn("+ Add layer")?.click() ?? [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Add layer"))!.click());
    for (const t of ["Text", "Overlay", "Code", "Cancel"]) expect([...document.querySelectorAll(".v2-sb-addlayer button")].some((x) => x.textContent?.includes(t))).toBe(true);
    act(() => ([...document.querySelectorAll(".v2-sb-addlayer button")].find((x) => x.textContent?.includes("Text")) as HTMLButtonElement).click());
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ type: "text", startSec: 0, endSec: 3 });
    expect(document.querySelector('textarea[aria-label="Layer 1 text"]')).not.toBeNull();
    act(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Add layer"))!.click());
    act(() => ([...document.querySelectorAll(".v2-sb-addlayer button")].find((x) => x.textContent?.includes("Code")) as HTMLButtonElement).click());
    expect(layers[1]).toMatchObject({ type: "html", asset: "text-card" });
    act(() => root.unmount());
  });
  it("edits a gradient background", () => {
    let bg: story.StoryBackground = "#000000";
    const el = document.createElement("div"); document.body.append(el);
    const root = createRoot(el);
    const render = () => root.render(<BackgroundEditor value={bg} onChange={(v) => { bg = v; render(); }} />);
    act(render);
    act(() => ([...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Linear")) as HTMLButtonElement).click());
    expect(bg).toMatchObject({ type: "linear", stops: [{ color: "#000000" }, { color: "#1a2a4a" }] });
    expect(document.querySelector('[data-testid="bg-preview"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
