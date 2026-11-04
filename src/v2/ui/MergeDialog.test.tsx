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

  it("P33 dialog: two lanes, red hatching on overlaps, ✓ disabled until clear; Keep trims the other; drag snaps; ✕ / Escape cancel", async () => {
    const comp: Composition = {
      id: "r", durationTicks: 0, tracks: [
        { id: "top", name: "Text 2", kind: "text", placements: [{ id: "a", clipType: "text", startTicks: 0, durationTicks: 240000, text: { text: "Hello" } } as never] },
        { id: "low", name: "Text 1", kind: "text", placements: [
          { id: "b", clipType: "text", startTicks: 120000, durationTicks: 240000, text: { text: "World" } } as never,
          { id: "c", clipType: "text", startTicks: 60000, durationTicks: 60000, text: { text: "Again" } } as never] },
      ],
    } as never;
    const plan = mergeLayer.planMergeUp(comp, "low");
    const apply = vi.fn(), cancel = vi.fn();
    const el = await render(<MergeDialog plan={plan} onApply={apply} onCancel={cancel} />);
    const upper = el.querySelector('[data-lane="upper"]')!, incoming = el.querySelector('[data-lane="incoming"]')!;
    expect([...upper.querySelectorAll("[data-clip]")].map((c) => c.getAttribute("data-clip"))).toEqual(["a"]);
    expect([...incoming.querySelectorAll("[data-clip]")].map((c) => c.getAttribute("data-clip"))).toEqual(["c", "b"]);
    expect(el.textContent).toContain("Upper · Text 2");
    expect(upper.querySelectorAll(".v2-merge-hatch").length).toBe(2);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    const ok = () => el.querySelector<HTMLButtonElement>('[aria-label="Apply merge"]')!;
    expect(ok().disabled).toBe(true);
    // Keep "Hello" whole: World and Again are trimmed away under it -> one overlap pair gone each.
    await click(el.querySelector('.v2-merge-row [data-keep="a"]'));
    expect(el.querySelectorAll(".v2-merge-hatch").length).toBe(0);
    expect(ok().disabled).toBe(false);
    await click(ok());
    const lay = apply.mock.calls[0][0] as mergeLayer.MergeLayout;
    expect(lay.upper.map((p) => [p.id, p.startTicks])).toEqual([["a", 0]]);
    expect(lay.incoming.map((p) => [p.startTicks, p.durationTicks])).toEqual([[240000, 120000]]);
    // Reset, then drag World right with the pointer: it snaps its start to Hello's end (2.0s).
    await click(el.querySelector('[aria-label="Reset"]'));
    expect(ok().disabled).toBe(true);
    const w = () => el.querySelector<HTMLElement>('[data-clip="b"]')!;
    const pps = parseFloat(w().style.width) / 2; // World is 2s long
    const ptr = (type: string, x: number) => act(async () => { w().dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x }), { pointerId: 1 })); });
    await ptr("pointerdown", 100); await ptr("pointermove", 100 + pps * 0.97); await ptr("pointerup", 100 + pps * 0.97);
    expect(parseFloat(w().style.left)).toBeCloseTo(pps * 2, 0);
    await click(el.querySelector('.v2-merge-row [data-keep="a"]')); // Again still overlaps Hello
    expect(ok().disabled).toBe(false);
    await click(el.querySelector('[aria-label="Cancel merge"]'));
    await act(async () => { dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("P33 touch targets: clips, keep buttons, zoom and header are 44px+", () => {
    const css = readFileSync(resolve(__dirname, "v2.css"), "utf8");
    for (const sel of [".v2-merge-clip", ".v2-merge-lane", ".v2-merge-hatch"]) expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*height: 44px`));
    for (const sel of [".v2-merge-keep", ".v2-merge-tools .v2-icon", ".v2-merge-head .v2-icon"]) expect(css).toMatch(new RegExp(`${sel.replace(/\./g, "\\.")} \\{[^}]*min-height: 44px`));
    expect(css).toMatch(/repeating-linear-gradient\(45deg, rgba\(239,68,68/);
  });


});
