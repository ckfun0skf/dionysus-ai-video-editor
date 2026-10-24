// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { V2App } from "../V2App";
import { ITEM_MIME } from "./dnd";
import { LAYOUT_KEY } from "./layout";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});
beforeEach(() => { localStorage.clear(); });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

async function boot() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el); roots.push(root);
  await act(async () => { root.render(<V2App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const q = <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as T;
  const btn = (label: string, root: ParentNode = el) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
  const click = (b: HTMLElement) => act(async () => { b.click(); });
  return { el, q, btn, click };
}

describe("V2-106 desktop shell", () => {
  it("lays out asset browser, preview, inspector and timeline", async () => {
    const { q, el } = await boot();
    expect(q(".v2-dshell")).toBeTruthy();
    expect(Array.from(el.querySelectorAll(".v2-abtab")).map((t) => t.textContent)).toEqual(["Media", "Audio", "Text", "Stickers", "Effects", "Templates"]);
    expect(q('[aria-label="Inspector"]').textContent).toContain("Project");
    expect(el.querySelectorAll('[role="separator"]').length).toBe(3);
    expect(q(".v2-dropzone").textContent).toContain("Drop media here");
  });

  it("project settings: aspect, fps and background are undoable and resize the preview canvas", async () => {
    const { q, btn, click } = await boot();
    const canvas = () => q<HTMLCanvasElement>(".v2-preview canvas");
    expect([canvas().width, canvas().height]).toEqual([1280, 720]);
    await click(btn("9:16", q('[aria-label="Aspect ratio"]')));
    expect([canvas().width, canvas().height]).toEqual([720, 1280]);
    expect(q(".v2-ratio").textContent).toBe("1080×1920");
    await click(btn("60", q('[aria-label="Frame rate"]')));
    expect(btn("60", q('[aria-label="Frame rate"]')).getAttribute("aria-checked")).toBe("true");
    await click(q('[aria-label="Background #ffffff"]'));
    expect(q('[aria-label="Background #ffffff"]').getAttribute("aria-checked")).toBe("true");
    for (let i = 0; i < 3; i += 1) await click(q('[aria-label="Undo"]'));
    expect([canvas().width, canvas().height]).toEqual([1280, 720]);
  });

  it("text tab only adds text; the inspector shows the text editor", async () => {
    const { q, btn, click, el } = await boot();
    await click(q('.v2-abtabs [title="Text"]'));
    expect(q(".v2-abbody").textContent).toContain("style it in the inspector");
    await click(q('[aria-label="Add Title text"]') ?? btn("Default text"));
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(1);
    const tabs = Array.from(el.querySelectorAll(".v2-inspect-tabs [role=tab]")).map((t) => t.textContent);
    expect(tabs).toEqual(["Text", "Transform"]);
    await click(btn("Done", q(".v2-inspect")));
    expect(q('[aria-label="Inspector"]').textContent).toContain("Project");
  });

  it("drops browser items (text, effect) onto the timeline", async () => {
    const { q, el } = await boot();
    const drop = (item: object) => act(async () => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.assign(ev, { clientX: 200, clientY: 10, dataTransfer: { getData: (t: string) => (t === ITEM_MIME ? JSON.stringify(item) : ""), files: [], types: [ITEM_MIME] } });
      q(".v2-dshell .v2-scroll").dispatchEvent(ev);
    });
    await drop({ kind: "text" });
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(1);
    await drop({ kind: "effect", id: "blur" });
    expect(el.querySelectorAll(".v2-clip").length).toBe(2);
  });

  it("splitters resize with the keyboard and persist; panels can be hidden", async () => {
    const { q, click } = await boot();
    const sep = q('[role="separator"][aria-label="Resize inspector"]');
    const before = Number(sep.getAttribute("aria-valuenow"));
    await act(async () => { sep.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(Number(q('[aria-label="Resize inspector"]').getAttribute("aria-valuenow"))).toBe(before - 8);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).right).toBe(before - 8);
    await click(q('[aria-label="Hide inspector"]'));
    expect(q(".v2-inspect")).toBeNull();
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).rightOpen).toBe(false);
    await click(q('[aria-label="Show inspector"]'));
    expect(q(".v2-inspect")).toBeTruthy();
  });

  it("? opens the shortcuts sheet; Esc closes it", async () => {
    const { q } = await boot();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })); });
    const dlg = q('[role="dialog"][aria-label="Keyboard shortcuts"]');
    expect(dlg.textContent).toContain("Shuttle");
    await act(async () => { dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q('[aria-label="Keyboard shortcuts"][role="dialog"]')).toBeNull();
  });

  it("right-click menus: clip actions and empty-track actions", async () => {
    const { q, el, click } = await boot();
    const rclick = (t: Element) => act(async () => { t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); });
    await rclick(q(".v2-dshell .v2-lane[data-track-id]"));
    const items = () => Array.from(el.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent);
    expect(items().join("|")).toContain("Add text hereT");
    await click(Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.includes("Add text here"))!);
    expect(q('[role="menu"]')).toBeNull();
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(1);
    await rclick(q(".v2-clip.clip-text"));
    expect(q('[role="menu"]').getAttribute("aria-label")).toBe("Clip actions");
    expect(items().join("|")).toMatch(/Split at playhead.*Copy.*Duplicate.*Delete/);
    await act(async () => { q('[role="menu"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(q('[role="menu"]')).toBeNull();
    await rclick(q(".v2-clip.clip-text"));
    await click(Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.startsWith("Delete"))!);
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(0);
  });

  it("V2-110: Ctrl/Cmd+B and +K split at the playhead, Cmd+X cuts, ↑/↓ jump edit points, R toasts ripple", async () => {
    const { q, el, click } = await boot();
    await click(q('.v2-abtabs [title="Text"]'));
    await click(q('[aria-label="Add Plain text"]'));
    const clips = () => el.querySelectorAll(".v2-clip.clip-text").length;
    const toast = () => q(".v2-toast")?.textContent ?? "";
    const key = (key: string, o: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...o })); });
    expect(clips()).toBe(1);
    await key("ArrowRight", { shiftKey: true }); // playhead 1 s, inside the clip
    await key("b", { ctrlKey: true });
    expect(clips()).toBe(2);
    await click(q('[aria-label="Undo"]'));
    expect(clips()).toBe(1);
    await key("k", { metaKey: true });
    expect(clips()).toBe(2);
    await click(q('[aria-label="Undo"]'));
    // ↑ jumps back to the clip start (0): splitting there is refused with a hint, not a silent no-op.
    await key("ArrowUp");
    await key("b", { ctrlKey: true });
    expect(clips()).toBe(1);
    expect(toast()).toMatch(/No clip under the playhead/);
    // ↓ jumps to the next edit point (the clip end): still nothing to split.
    await key("ArrowDown");
    await key("b", { ctrlKey: true });
    expect(clips()).toBe(1);
    // R toggles ripple with a visible on/off toast; it is ignored while typing.
    await key("r");
    expect(toast()).toMatch(/^Ripple on/);
    await key("r");
    expect(toast()).toBe("Ripple off");
    const input = document.createElement("input"); el.appendChild(input);
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true })); });
    expect(toast()).toBe("Ripple off");
    expect(clips()).toBe(1);
    // Cmd/Ctrl+X: copy then delete (undoable); the clip can be pasted back.
    await act(async () => { q<HTMLElement>(".v2-clip.clip-text").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await key("x", { ctrlKey: true });
    expect(clips()).toBe(0);
    expect(toast()).toMatch(/^Cut 1 clip/);
    await key("v", { ctrlKey: true });
    expect(clips()).toBe(1);
  });

  it("Alt+arrow nudges the selected clip by a frame (undoable); +/- zoom", async () => {
    const { q, click } = await boot();
    await click(q('.v2-abtabs [title="Text"]'));
    await click(q('[aria-label="Add Plain text"]'));
    const left = () => parseFloat(q<HTMLElement>(".v2-clip.clip-text").style.left);
    const l0 = left();
    const key = (key: string, o: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...o })); });
    await key("ArrowRight", { altKey: true, shiftKey: true });
    expect(left()).toBeGreaterThan(l0);
    await click(q('[aria-label="Undo"]'));
    expect(left()).toBe(l0);
    const zoom = () => Number(q<HTMLInputElement>('[aria-label="Timeline zoom"]').value);
    const z0 = zoom();
    await key("=");
    expect(zoom()).toBeGreaterThan(z0);
    await key("-"); await key("-");
    expect(zoom()).toBeLessThan(z0);
  });

  it("styled tooltip on hover; the title attribute comes back on leave", async () => {
    const { q } = await boot();
    const b = q('[aria-label="Keyboard shortcuts"]');
    await act(async () => { b.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); await new Promise((r) => setTimeout(r, 500)); });
    expect(q('[role="tooltip"]').textContent).toBe("Keyboard shortcuts (?)");
    expect(b.hasAttribute("title")).toBe(false);
    await act(async () => { b.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })); });
    expect(q('[role="tooltip"]')).toBeNull();
    expect(b.getAttribute("title")).toBe("Keyboard shortcuts (?)");
  });
});
