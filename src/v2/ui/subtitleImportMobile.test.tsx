// @vitest-environment jsdom
/**
 * P50: Text > Import SRT on the mobile layout, with the Media sheet closed, must show the paste
 * dialog. The Media browser stays mounted inside [hidden]; the dialog and the file input must not.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { V2App } from "./V2App";

const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,000\nWorld\n";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});

const roots: Root[] = [];
afterEach(async () => {
  await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
  document.body.innerHTML = "";
});

function matchMedia(matches: boolean) {
  window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

async function mount(mobile: boolean) {
  matchMedia(mobile);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => { root.render(<V2App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const tool = (name: string) => [...el.querySelectorAll(".v2-toolbar .v2-tool")].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
  return { el, tool };
}

function hiddenAncestor(node: Element | null) {
  return node?.parentElement?.closest("[hidden]") ?? null;
}

describe("P50 mobile subtitle import", () => {
  it("Text > Import SRT with the Media sheet closed shows the paste dialog outside [hidden], and confirming imports a layer", async () => {
    const { el, tool } = await mount(true);
    expect(el.querySelector(".v2-sheet")).toBeNull();
    expect(el.querySelector("[hidden] .v2-browser")).toBeTruthy();

    await act(async () => { tool("Text")!.click(); });
    const labels = [...el.querySelectorAll(".v2-toolbar .v2-tool span")].map((x) => x.textContent);
    expect(labels).toEqual(["Add", "Stickers", "Import SRT", "Subtitles", "Export SRT", "Template"]);
    const icon = (name: string) => tool(name)!.querySelector("svg")!.getAttribute("data-icon");
    expect(icon("Import SRT")).toBe("srt-in");
    expect(icon("Export SRT")).toBe("srt-out");
    expect(icon("Import SRT")).not.toBe(icon("Export SRT"));
    const video = el.querySelector(".v2-export")!;
    expect(video.getAttribute("aria-label")).toBe("Export MP4");
    expect(video.querySelector("svg")!.getAttribute("data-icon")).toBe("film");
    expect(video.querySelector("svg")!.getAttribute("data-icon")).not.toBe(icon("Import SRT"));

    await act(async () => { tool("Import SRT")!.click(); });
    const dialog = el.querySelector('[role="dialog"][aria-label="Import SRT"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.closest("[hidden]")).toBeNull();
    expect(el.querySelector(".v2-sheet")).toBeNull();
    const inputs = el.querySelectorAll('input[aria-label="Import SRT file"]');
    expect(inputs).toHaveLength(1);
    expect(hiddenAncestor(inputs[0])).toBeNull();
    expect(hiddenAncestor(dialog)).toBeNull();

    const ta = dialog.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(dialog.querySelector("label")!.textContent).toMatch(/Paste SRT or VTT/);
    expect(dialog.textContent).toMatch(/Clipboard permission is not required/);
    expect((dialog.querySelector('[aria-label="Import pasted subtitles"]') as HTMLButtonElement).disabled).toBe(true);
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Import") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { set.call(ta, SRT); ta.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(dialog.textContent).toContain("2 subtitles found");
    expect(confirm.disabled).toBe(false);
    const before = el.querySelectorAll(".v2-clip.clip-text").length;
    await act(async () => { confirm.click(); });
    expect(el.querySelector('[role="dialog"][aria-label="Import SRT"]')).toBeNull();
    expect(el.querySelectorAll(".v2-clip.clip-text").length).toBe(before + 2);
    expect(el.querySelector(".v2-toast")?.textContent).toMatch(/Imported 2 subtitles/);
  });

  it("desktop keeps a single Import SRT dialog and a distinct Export MP4 icon", async () => {
    const { el } = await mount(false);
    expect(el.querySelectorAll('input[aria-label="Import SRT file"]')).toHaveLength(1);
    await act(async () => { (el.querySelector('.v2-abtabs [title="Text"]') as HTMLButtonElement).click(); });
    const importBtn = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Import SRT"))!;
    expect(importBtn.querySelector("svg")!.getAttribute("data-icon")).toBe("srt-in");
    await act(async () => { importBtn.click(); });
    const dialog = el.querySelector('[role="dialog"][aria-label="Import SRT"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.closest("[hidden]")).toBeNull();
    expect(dialog.querySelector("textarea")).toBeTruthy();
    const exp = el.querySelector(".v2-export-d")!;
    expect(exp.textContent).toContain("Export MP4");
    expect(exp.querySelector("svg")!.getAttribute("data-icon")).toBe("film");
    expect(exp.querySelector("svg")!.getAttribute("data-icon")).not.toBe("srt-in");
    expect(el.querySelectorAll('[role="dialog"][aria-label="Import SRT"]')).toHaveLength(1);
  });
});
