// @vitest-environment jsdom
/** P32: the layer "Merge up" button and the overlap dialog (✕ cancels, ✓ applies the per-clip choices). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeLayer, type Composition } from "../domain";
import { LayerControls } from "./Timeline";
import { MergeDialog } from "./MergeDialog";

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

  it("dialog lists each overlap, 'All clips' sets every choice, ✓ applies them; ✕ / Escape cancel", async () => {
    const comp: Composition = {
      id: "r", durationTicks: 0, tracks: [
        { id: "top", name: "Text 2", kind: "text", placements: [{ id: "a", clipType: "text", startTicks: 0, durationTicks: 240000, text: { text: "Hello" } } as never] },
        { id: "low", name: "Text 1", kind: "text", placements: [
          { id: "b", clipType: "text", startTicks: 120000, durationTicks: 240000, text: { text: "World" } } as never,
          { id: "c", clipType: "text", startTicks: 60000, durationTicks: 60000, text: { text: "Again" } } as never] },
      ],
    } as never;
    const plan = mergeLayer.planMergeUp(comp, "low");
    expect(plan.conflicts.length).toBe(2);
    const apply = vi.fn(), cancel = vi.fn();
    const el = await render(<MergeDialog comp={comp} plan={plan} onApply={apply} onCancel={cancel} />);
    expect(el.querySelectorAll(".v2-merge-list .v2-merge-row").length).toBe(2);
    expect(el.textContent).toContain("World");
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    const row = (id: string) => el.querySelector(`[data-incoming="${id}"]`)!;
    expect(row("b").querySelector('[aria-checked="true"]')!.textContent).toBe("Move it later");
    const all = el.querySelector(".v2-merge-all")!;
    await click([...all.querySelectorAll("button")].find((b) => b.textContent === "Trim existing")!);
    await click([...row("c").querySelectorAll("button")].find((b) => b.textContent === "Push later")!);
    await click(el.querySelector('[aria-label="Apply merge"]'));
    expect(apply).toHaveBeenCalledWith({ b: "trimExisting", c: "pushLater" });
    await click(el.querySelector('[aria-label="Cancel merge"]'));
    await act(async () => { dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

});
