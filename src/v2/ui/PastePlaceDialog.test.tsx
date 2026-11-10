// @vitest-environment jsdom
/** P51/P52: the paste dialog offers placements and a track, and Cancel applies nothing. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PastePlaceDialog } from "./PastePlaceDialog";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });
const btn = (el: ParentNode, name: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement;

function mount(opts: { canAfter?: boolean; canPlayhead?: boolean; trackId?: string; tracks?: { id: string; label: string }[] } = {}) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  const onTrackChange = vi.fn();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  roots.push(r);
  act(() => {
    r.render(<PastePlaceDialog canAfter={opts.canAfter ?? true} canPlayhead={opts.canPlayhead ?? true}
      tracks={opts.tracks ?? [{ id: "main", label: "Main" }]} trackId={opts.trackId ?? "main"} onTrackChange={onTrackChange}
      newTrackLabel="New overlay track" onChoose={onChoose} onCancel={onCancel} />);
  });
  return { el, onChoose, onCancel, onTrackChange };
}

describe("Paste placement dialog", () => {
  it("offers both places plus the playhead, and Cancel (button, Escape, backdrop) applies nothing", () => {
    const { el, onChoose, onCancel } = mount();
    const dialog = el.querySelector('[data-testid="paste-place"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Paste clip");
    expect(btn(el, "Insert after current clip").disabled).toBe(false);
    expect(btn(el, "At the end of the current chain")).toBeTruthy();
    expect(btn(el, "At the playhead").disabled).toBe(false);
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

  it("each placement is a choice, insert-after is disabled when there is no current clip, and playhead is disabled when the gap is busy", () => {
    const first = mount();
    act(() => { btn(first.el, "Insert after current clip").click(); });
    expect(first.onChoose).toHaveBeenCalledWith("after");
    expect(first.onCancel).not.toHaveBeenCalled();
    const second = mount();
    act(() => { btn(second.el, "At the end of the current chain").click(); });
    expect(second.onChoose).toHaveBeenCalledWith("end");
    const play = mount();
    act(() => { btn(play.el, "At the playhead").click(); });
    expect(play.onChoose).toHaveBeenCalledWith("playhead");
    const none = mount({ canAfter: false, canPlayhead: false });
    const after = btn(none.el, "Insert after current clip");
    expect(after.disabled).toBe(true);
    act(() => { after.click(); });
    expect(none.onChoose).not.toHaveBeenCalled();
    expect(btn(none.el, "At the playhead").disabled).toBe(true);
    act(() => { btn(none.el, "At the playhead").click(); });
    expect(none.onChoose).not.toHaveBeenCalled();
    act(() => { btn(none.el, "At the end of the current chain").click(); });
    expect(none.onChoose).toHaveBeenCalledWith("end");
  });

  it("lets the user pick a track, including a new one", () => {
    const { el, onTrackChange } = mount({ tracks: [{ id: "main", label: "Main" }, { id: "ov", label: "Overlay 1" }] });
    const select = el.querySelector('select[aria-label="Paste onto track"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["main", "ov", "new"]);
    expect([...select.options].map((o) => o.textContent)).toEqual(["Main", "Overlay 1", "New overlay track"]);
    act(() => { select.value = "ov"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onTrackChange).toHaveBeenCalledWith("ov");
  });
});
