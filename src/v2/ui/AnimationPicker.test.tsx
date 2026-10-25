// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Engine, cmd } from "../engine";
import { createProject, findPlacement } from "../domain/model";
import { textAnimAt } from "../domain/text";
import { listPresets } from "../registry";
import { AnimationPicker } from "./AnimationPicker";
import { tileProgress } from "./PresetTile";
import { animBadges } from "./Timeline";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

describe("AnimationPicker", () => {
  it("lists In/Out/Loop tiles from the registry; picks and duration are undoable", async () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "a"));
    const get = () => { const p = e.getState().project; return findPlacement(p.compositions[p.rootCompositionId], "a")!.placement; };
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); const picked = vi.fn();
    const render = () => act(async () => { root.render(<AnimationPicker engine={e} placement={get()} onPicked={picked} />); });
    await render();
    const tiles = () => [...el.querySelectorAll(".v2-ptile")].map((b) => b.getAttribute("aria-label"));
    expect(tiles()).toEqual(["None", ...listPresets("textAnimIn").map((d) => d.name)]);
    await act(async () => { (el.querySelector('[aria-label="Pop"]') as HTMLButtonElement).click(); });
    expect(get().text!.animIn).toBe("pop"); expect(picked).toHaveBeenCalledTimes(1);
    await render();
    const tab = (n: string) => [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent!.startsWith(n)) as HTMLButtonElement;
    expect(tab("In").textContent).toContain("•");
    await act(async () => { tab("Loop").click(); });
    expect(tiles()).toEqual(["None", ...listPresets("textAnimLoop").map((d) => d.name)]);
    expect(el.querySelector('[aria-label="Animation duration"]')).toBeNull();
    await act(async () => { (el.querySelector('[aria-label="Blink"]') as HTMLButtonElement).click(); });
    expect(get().text!.loop).toBe("blink");
    await act(async () => { tab("Out").click(); });
    const slider = el.querySelector('[aria-label="Animation duration"]') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(slider, "1"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(get().text!.animTicks).toBe(120_000);
    e.undo(); e.undo(); e.undo();
    expect(get().text!.animIn ?? "none").toBe("none");
    root.unmount();
  });
  it("shows the picked preset's params (from its ParamSpec); edits are per clip and reset on a new pick (V2-SB-130)", async () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "a"));
    const get = () => { const p = e.getState().project; return findPlacement(p.compositions[p.rootCompositionId], "a")!.placement; };
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    const render = () => act(async () => { root.render(<AnimationPicker engine={e} placement={get()} />); });
    await render();
    expect(el.querySelector('[aria-label="In Slide up Distance"]')).toBeNull();
    await act(async () => { (el.querySelector('[aria-label="Slide up"]') as HTMLButtonElement).click(); });
    await render();
    const slider = el.querySelector('[aria-label="In Slide up Distance"]') as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.08);
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(slider, "0.3"); slider.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(get().text!.animInParams).toEqual({ distance: 0.3 });
    const far = textAnimAt(get().text!, 0, 240_000), near = textAnimAt({ ...get().text!, animInParams: undefined }, 0, 240_000);
    expect(far).not.toEqual(near);
    await render();
    await act(async () => { (el.querySelector('[aria-label="Pop"]') as HTMLButtonElement).click(); });
    expect(get().text!.animIn).toBe("pop");
    expect(get().text!.animInParams).toBeUndefined();
    e.undo(); e.undo();
    expect(get().text!.animInParams).toBeUndefined();
    root.unmount();
  });
  it("tile progress plays in forward, out backward, loops full cycle", () => {
    expect(tileProgress("textAnimIn", 0)).toBe(0); expect(tileProgress("textAnimIn", 0.9)).toBe(1);
    expect(tileProgress("textAnimOut", 0)).toBe(1); expect(tileProgress("textAnimOut", 0.9)).toBe(0);
    expect(tileProgress("textAnimLoop", 0.5)).toBe(0.5);
  });
  it("timeline badges reflect applied animations", () => {
    expect(animBadges({ text: { animIn: "fade", animOut: "none", loop: "pulse" } } as never)).toEqual(["in", "loop"]);
    expect(animBadges({} as never)).toEqual([]);
  });
});
