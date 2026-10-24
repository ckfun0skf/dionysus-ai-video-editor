// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
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
afterEach(() => { document.body.innerHTML = ""; });

async function boot() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<V2App />); });
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
});
