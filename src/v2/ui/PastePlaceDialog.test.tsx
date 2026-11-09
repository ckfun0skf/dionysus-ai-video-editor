// @vitest-environment jsdom
/** P51: the paste dialog offers both placements, and Cancel applies nothing. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PastePlaceDialog } from "./PastePlaceDialog";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });
const btn = (el: ParentNode, name: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;

function mount(canAfter: boolean) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  roots.push(r);
  act(() => { r.render(<PastePlaceDialog canAfter={canAfter} onChoose={onChoose} onCancel={onCancel} />); });
  return { el, onChoose, onCancel };
}

describe("Paste placement dialog", () => {
  it("offers both places, and Cancel (button, Escape, backdrop) applies nothing", () => {
    const { el, onChoose, onCancel } = mount(true);
    const dialog = el.querySelector('[data-testid="paste-place"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Paste clip");
    expect(btn(el, "Insert after current clip").disabled).toBe(false);
    expect(btn(el, "At the end of the current chain")).toBeTruthy();
    act(() => { btn(el, "Cancel").click(); });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
    act(() => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
    act(() => { (el.querySelector(".v2-confirm-backdrop") as HTMLElement).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("each placement is a choice, and insert-after is disabled when there is no current clip", () => {
    const first = mount(true);
    act(() => { btn(first.el, "Insert after current clip").click(); });
    expect(first.onChoose).toHaveBeenCalledWith("after");
    expect(first.onCancel).not.toHaveBeenCalled();
    const second = mount(true);
    act(() => { btn(second.el, "At the end of the current chain").click(); });
    expect(second.onChoose).toHaveBeenCalledWith("end");
    const none = mount(false);
    const after = btn(none.el, "Insert after current clip");
    expect(after.disabled).toBe(true);
    act(() => { after.click(); });
    expect(none.onChoose).not.toHaveBeenCalled();
    act(() => { btn(none.el, "At the end of the current chain").click(); });
    expect(none.onChoose).toHaveBeenCalledWith("end");
  });
});
