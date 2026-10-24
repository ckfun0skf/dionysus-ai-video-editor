// @vitest-environment jsdom
/**
 * V2-105: on a real 412px Android phone the text layer row in the mobile left column clipped its first control
 * (the captions "Edit subtitles" icon): .v2-layer-side is right-anchored in a 144px overflow:hidden column, so a
 * 5th button silently slid off the left edge. jsdom has no layout engine, so this test lays the row out from the
 * real CSS (button min-width, gap, right inset) and the real rendered buttons, at 390 and 412 px viewports.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { V2App } from "./V2App";
import { SIDE_W } from "./Timeline";

const css = readFileSync(resolve(process.cwd(), "src/v2/ui/v2.css"), "utf8");
const rule = (sel: string) => { const i = css.indexOf(`${sel} {`); if (i < 0) throw new Error(`missing CSS rule ${sel}`); return css.slice(i, css.indexOf("}", i)); };
const px = (block: string, prop: string) => { const m = block.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*(\\d+)px`)); if (!m) throw new Error(`${prop} not in ${block}`); return Number(m![1]); };
const BTN = px(rule(".v2-layer-ctl .v2-icon"), "min-width");
const CTL_GAP = px(rule(".v2-layer-ctl"), "gap");
const SIDE_RIGHT = px(rule(".v2-layer-side"), "right");

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
});
afterEach(() => { document.body.innerHTML = ""; });

const SRT = "1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n";
async function mount(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<V2App />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const tool = (name: string) => [...el.querySelectorAll(".v2-toolbar .v2-tool")].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
  const importSrt = async () => {
    const input = el.querySelector('input[aria-label="Import SRT file"]') as HTMLInputElement;
    const file = new File([SRT], "s.srt"); Object.defineProperty(file, "text", { value: async () => SRT });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); });
  };
  return { el, tool, importSrt };
}

describe("V2-105 mobile layer row + Edit subtitles entry points", () => {
  for (const width of [390, 412]) {
    it(`${width}px: every layer control sits inside the left column, ≥32px, nothing clipped`, async () => {
      const { el, tool, importSrt } = await mount(width);
      await act(async () => { tool("Text")!.click(); });
      await importSrt();
      await act(async () => { tool("Add text")!.click(); });
      const side = el.querySelector('[data-testid="side-col"]') as HTMLElement;
      // Column itself is on screen.
      const colLeft = parseFloat(side.style.left);
      expect(colLeft).toBeGreaterThanOrEqual(0);
      expect(colLeft + SIDE_W).toBeLessThanOrEqual(width);
      const rows = [...side.querySelectorAll<HTMLElement>(".v2-layer-side")];
      expect(rows.length).toBeGreaterThanOrEqual(2); // text layers incl. the imported subtitles layer
      for (const row of rows) {
        const btns = [...row.querySelectorAll("button")];
        expect(btns.length).toBeGreaterThan(0);
        // Right-anchored row: lay buttons out from the column's right edge leftwards.
        let right = SIDE_W - SIDE_RIGHT;
        for (const b of btns.reverse()) {
          const box = { left: right - BTN, right };
          expect(BTN).toBeGreaterThanOrEqual(32);
          expect(box.left, `${b.getAttribute("aria-label")} @${width}px`).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(SIDE_W);
          right = box.left - CTL_GAP;
        }
      }
      // The captions icon is not in the narrow column any more (it lives in the toolbars instead).
      expect(side.querySelector(".v2-edit-subs")).toBeNull();
    });
  }

  it("Text toolbar: Edit subtitles sits between Import SRT and Export SRT; one layer opens directly, several show a picker", async () => {
    const { el, tool, importSrt } = await mount(412);
    await act(async () => { tool("Text")!.click(); });
    const labels = () => [...el.querySelectorAll(".v2-toolbar .v2-tool span")].map((x) => x.textContent);
    expect(labels()).toEqual(["Add text", "Stickers", "Import SRT", "Edit subtitles", "Export SRT", "Templates"]);
    await act(async () => { tool("Edit subtitles")!.click(); });
    expect(el.querySelector(".v2-toast")?.textContent).toMatch(/No subtitles yet/);
    await importSrt();
    await act(async () => { tool("Edit subtitles")!.click(); });
    expect(el.querySelectorAll(".v2-cue").length).toBe(2);
    await act(async () => { (el.querySelector('[aria-label="Close Edit subtitles"]') as HTMLButtonElement | null)?.click(); });
    await importSrt();
    await act(async () => { tool("Edit subtitles")!.click(); });
    const pick = el.querySelector('[aria-label="Choose a text layer"]')!;
    expect(pick).toBeTruthy();
    const opts = pick.querySelectorAll(".v2-subs-pick-row");
    expect(opts.length).toBe(2);
    await act(async () => { (opts[1] as HTMLButtonElement).click(); });
    expect(el.querySelector('[aria-label="Choose a text layer"]')).toBeNull();
    expect(el.querySelectorAll(".v2-cue").length).toBe(2);
  });

  it("selected text clip toolbar has Subtitles, which opens the list at that clip", async () => {
    const { el, tool, importSrt } = await mount(390);
    await act(async () => { tool("Text")!.click(); });
    await importSrt();
    const clips = el.querySelectorAll<HTMLElement>(".v2-clip.clip-text");
    const second = clips[clips.length - 1];
    const id = second.dataset.placementId!;
    await act(async () => { second.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    const labels = [...el.querySelectorAll(".v2-toolbar .v2-tool span")].map((x) => x.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Split", "Delete", "Edit text", "Animation", "Subtitles", "Adjust"]));
    await act(async () => { tool("Subtitles")!.click(); });
    const row = el.querySelector(`.v2-cue[data-cue="${id}"]`)!;
    expect(row.classList.contains("is-target")).toBe(true);
    expect(el.querySelectorAll(".v2-cue").length).toBe(2);
  });
});

describe("V2-109 touch targets", () => {
  it("a coarse-pointer block gives icons, gizmo, transitions and header controls a 44px hit area", () => {
    const css = readFileSync(resolve(__dirname, "v2.css"), "utf8");
    const block = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(block).toMatch(/\.v2-icon[^{]*\{ min-width: 44px; min-height: 44px; \}/);
    expect(block).toMatch(/\.v2-res, \.v2-app \.v2-export \{ min-height: 44px; \}/);
    expect(block).toContain(".v2-giz::after { inset: -10px; }");
    // 4 controls × 44px fit the mobile column.
    expect(4 * 44 + 2).toBeLessThanOrEqual(SIDE_W);
    // Contrast: the white "+" tile keeps dark ink (beats `.v2-app button { color: inherit }`).
    expect(css).toMatch(/\.v2-app \.v2-main-add \{[^}]*color: #111/);
  });
});
