// @vitest-environment jsdom
/** P32: the layer "Merge up" button and the overlap dialog (✕ cancels, ✓ applies the per-clip choices). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeLayer, type Composition } from "../domain";
import { LayerControls } from "./Timeline";
import { MergeDialog } from "./MergeDialog";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; });
const render = async (node: React.ReactNode) => { const el = document.createElement("div"); document.body.appendChild(el); await act(async () => { createRoot(el).render(node); }); return el; };
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };

describe("P32 merge up UI", () => {
  it("LayerControls: merge is a monochrome line icon, disabled with nothing above, absent on main", async () => {
    const t = { id: "t1", name: "Video 2", kind: "video", placements: [] } as never;
    const on = vi.fn();
    let el = await render(<LayerControls t={t} isMain={false} onToggle={() => {}} onDelete={() => {}} onMergeUp={on} mergeInto="Video 3" />);
    const b = el.querySelector<HTMLButtonElement>(".v2-merge-up")!;
    expect(b.getAttribute("aria-label")).toBe("Merge Video 2 up into Video 3");
    expect(b.disabled).toBe(false);
    const svg = b.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    await click(b); expect(on).toHaveBeenCalledOnce();
    el = await render(<LayerControls t={t} isMain={false} onToggle={() => {}} onDelete={() => {}} onMergeUp={on} />);
    expect(el.querySelector<HTMLButtonElement>(".v2-merge-up")!.disabled).toBe(true);
    el = await render(<LayerControls t={t} isMain onToggle={() => {}} onDelete={() => {}} onMergeUp={on} />);
    expect(el.querySelector(".v2-merge-up")).toBeNull();
  });

  it("P34 dialog: opens on the first overlap with ‹ n of N ›; dim / yellow / green; selection-only Trim this / Trim others; trim handles; draft preview", async () => {
    const comp: Composition = {
      id: "r", durationTicks: 0, tracks: [
        { id: "top", name: "Text 2", kind: "text", placements: [{ id: "a", clipType: "text", startTicks: 0, durationTicks: 240000, sourceInTicks: 0, source: { assetId: "", versionId: "" }, text: { text: "Hello" } } as never] },
        { id: "low", name: "Text 1", kind: "text", placements: [
          { id: "b", clipType: "text", startTicks: 120000, durationTicks: 240000, sourceInTicks: 0, source: { assetId: "", versionId: "" }, text: { text: "World" } } as never,
          { id: "c", clipType: "text", startTicks: 60000, durationTicks: 60000, sourceInTicks: 0, source: { assetId: "", versionId: "" }, text: { text: "Again" } } as never,
          { id: "d", clipType: "text", startTicks: 600000, durationTicks: 60000, sourceInTicks: 0, source: { assetId: "", versionId: "" }, text: { text: "Free" } } as never] },
      ],
    } as never;
    const project = { assets: {}, compositions: { r: comp }, rootCompositionId: "r" } as never;
    const plan = mergeLayer.planMergeUp(comp, "low");
    const apply = vi.fn(), cancel = vi.fn(), seek = vi.fn(), draft = vi.fn(), play = vi.fn();
    const el = await render(<MergeDialog plan={plan} comp={comp} project={project} time={0} playing={false} onSeek={seek} onPlay={play} onDraft={draft} onApply={apply} onCancel={cancel} />);
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    const state = (id: string) => q(`[data-clip="${id}"]`).getAttribute("data-state");
    expect(q(".v2-merge-count").textContent).toMatch(/^1 of 2/);
    expect(seek).toHaveBeenLastCalledWith(90000); // centre of the first overlap (Again under Hello, 0.5–1.0s)
    expect(el.querySelector('[aria-label="Zoom in"]')).toBeNull();
    expect(el.querySelector("[data-keep]")).toBeNull();
    expect(["a", "b", "c", "d"].map(state)).toEqual(["conflict", "conflict", "conflict", "dim"]);
    expect(q(".v2-merge-clip").classList.contains("v2-clip")).toBe(true);
    expect(draft.mock.calls.at(-1)![0].tracks.map((t: { id: string }) => t.id)).toEqual(["top"]);
    expect(el.querySelector(".v2-merge-actions")).toBeNull();
    const ok = () => q('[aria-label="Apply merge"]') as HTMLButtonElement;
    expect(ok().disabled).toBe(true);
    const ptr = (node: () => HTMLElement, type: string, x: number) => act(async () => { node().dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x }), { pointerId: 1 })); });
    const tap = async (id: string) => { const n = () => q(`[data-clip="${id}"]`); await ptr(n, "pointerdown", 10); await ptr(n, "pointerup", 10); };
    await tap("d"); // a dimmed clip offers no trim actions
    expect(el.querySelector(".v2-merge-actions")).toBeNull();
    await tap("b");
    expect(q('[data-clip="b"]').querySelectorAll(".v2-handle").length).toBe(2);
    await click(q('[data-act="trim-this"]')); // World now starts after Hello
    expect(state("b")).toBe("resolved");
    expect(state("c")).toBe("conflict");
    expect(ok().disabled).toBe(true);
    await click(q('[aria-label="Next overlap"]'));
    expect(q(".v2-merge-count").textContent).toMatch(/^2 of 2.*Resolved/);
    await tap("a");
    await click(q('[data-act="trim-others"]')); // Again is cut away under Hello
    expect(el.querySelector('[data-clip="c"]')).toBeNull();
    expect(state("a")).toBe("resolved");
    expect(ok().disabled).toBe(false);
    await click(ok());
    const lay = apply.mock.calls[0][0] as mergeLayer.MergeLayout;
    expect(lay.incoming.map((p) => [p.id, p.startTicks, p.durationTicks])).toEqual([["b", 240000, 120000], ["d", 600000, 60000]]);
    // Reset, select World and drag its start handle right to Hello's end: snaps to 2.0s, resolving it by trimming.
    await click(q('[aria-label="Reset"]'));
    const pps = parseFloat(q('[data-clip="b"]').style.width) / 2;
    await tap("b");
    const h = () => q('[data-clip="b"] .v2-handle.left');
    await ptr(h, "pointerdown", 100); await ptr(h, "pointermove", 100 + pps * 0.97); await ptr(h, "pointerup", 100 + pps * 0.97);
    expect(parseFloat(q('[data-clip="b"]').style.left)).toBeCloseTo(pps * 2, 0);
    expect(parseFloat(q('[data-clip="b"]').style.width)).toBeCloseTo(pps, 0);
    await click(q('[aria-label="Play preview"]'));
    expect(play).toHaveBeenCalledWith(true);
    await click(q('[aria-label="Cancel merge"]'));
    await act(async () => { dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("P34 touch targets and states: 44px clips, nav, actions; yellow / green / dim; red hatching", () => {
    const css = readFileSync(resolve(__dirname, "v2.css"), "utf8");
    for (const sel of [".v2-merge .v2-merge-lane .v2-clip.v2-merge-clip", ".v2-merge-hatch"]) expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*height: 44px`));
    for (const sel of [".v2-merge-act", ".v2-merge-head .v2-icon, .v2-merge-nav .v2-icon"]) expect(css).toMatch(new RegExp(`${sel.replace(/\./g, "\\.")} \\{[^}]*min-height: 44px`));
    expect(css).toMatch(/\.v2-merge \.v2-clip\.v2-merge-clip\.is-conflict \{ border-color: #facc15/);
    expect(css).toMatch(/\.v2-merge \.v2-clip\.v2-merge-clip\.is-resolved \{ border-color: #4ade80/);
    expect(css).toMatch(/\.v2-merge \.v2-clip\.v2-merge-clip\.is-dim \{ opacity/);
    expect(css).toMatch(/repeating-linear-gradient\(45deg, rgba\(239,68,68/);
    expect(css).not.toMatch(/v2-merge-keep|v2-merge-tools/);
  });


});
