// @vitest-environment jsdom
/**
 * P70 inspector / toolbar / menu parity (clip type plugins Phase 1 step 1.5): for every clip type of the UI parity
 * fixture, select the clip and record (desktop) the inspector with each of its tabs open and the clip context menu,
 * and (mobile) the clip toolbar and the Adjust / Audio / Colour sheets it opens. The markup is hashed against a golden
 * recorded on the pre-P70 code. `UPDATE_INSPECTOR_GOLDEN=1` re-records it (only for an intended change, say so in the
 * PR); `INSPECTOR_PARITY_DUMP=<dir>` writes the markup per clip and view for diffing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { V2App } from "./V2App";
import { createMemoryStorage } from "../persistence";
import { timelineParityProject } from "../__fixtures__/timelineParity";

const GOLDEN = join(__dirname, "__golden__", "inspectorParity.json");
/** One clip of every type and variant (and the shapes whose tools differ): selected one at a time. */
const CLIPS = ["m-red", "m-ph", "m-img", "m-vid", "m-html", "o-blue", "o-vid", "o-glb", "o-freeze", "o-unknown", "a-music", "t-hello", "t-type", "e-blur", "e-vig"];

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
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  document.body.innerHTML = "";
});

/** Stable markup: generated ids (caption words, tracks, React useId) numbered in order of appearance. */
function norm(html: string): string {
  const ids = new Map<string, string>();
  const id = (m: string) => { if (!ids.has(m)) ids.set(m, `id${ids.size}`); return ids.get(m)!; };
  return html.replace(/\b[a-z]{2,5}_[0-9a-f]{8}[0-9a-z]*\b/g, id).replace(/[:«]r[0-9a-z]+[:»]/g, id);
}
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function mount(mobile: boolean) {
  window.matchMedia = ((q: string) => ({ matches: mobile, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  const storage = createMemoryStorage();
  const p = timelineParityProject();
  await storage.projects.save(p);
  storage.lastProjectId.set(p.id);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el); roots.push(root);
  await act(async () => { root.render(<V2App openStorage={async () => storage} />); });
  await settle();
  return el;
}
async function select(el: HTMLElement, id: string) {
  const c = el.querySelector<HTMLElement>(`[data-placement-id="${id}"]`);
  if (!c) throw new Error(`clip ${id} not on screen`);
  if (c.tagName === "BUTTON") await act(async () => { c.click(); });
  else await act(async () => { c.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
  await settle();
}
const button = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
/** Mobile edits follow the playhead: tap the clip (enters its group), then scroll the timeline so the playhead is on it. */
async function selectMobile(el: HTMLElement, id: string) {
  await select(el, id);
  const c = el.querySelector<HTMLElement>(`[data-placement-id="${id}"]`)!;
  const x = parseFloat(c.style.left) + Math.min(4, parseFloat(c.style.width) / 2);
  const sc = el.querySelector<HTMLElement>(".v2-scroll")!;
  Object.defineProperty(sc, "scrollLeft", { configurable: true, get: () => x, set: () => undefined });
  await act(async () => { sc.dispatchEvent(new Event("scroll")); });
  await settle();
}

describe("P70 inspector, toolbar and menu parity", () => {
  it("desktop: inspector (every tab) and clip context menu for every clip type", async () => {
    const out: Record<string, string> = {};
    const dump = process.env.INSPECTOR_PARITY_DUMP;
    if (dump) mkdirSync(dump, { recursive: true });
    const record = (key: string, html: string) => { const n = norm(html); out[key] = fnv(n); if (dump) writeFileSync(join(dump, `${key}.html`), n.replace(/></g, ">\n<")); };
    for (const id of CLIPS) {
      const el = await mount(false);
      await select(el, id);
      const insp = () => button(el, ".v2-inspect")!;
      expect(insp(), id).toBeTruthy();
      record(`desktop-${id}`, insp().outerHTML);
      const tabEls = () => Array.from(insp().querySelectorAll<HTMLElement>(".v2-inspect-tabs > [role=tab]"));
      const tabs = tabEls().map((t) => t.textContent ?? "");
      for (const label of tabs) {
        await act(async () => { tabEls().find((t) => t.textContent === label)!.click(); });
        await settle();
        record(`desktop-${id}-tab-${label.replace(/\W+/g, "_")}`, insp().outerHTML);
      }
      const clip = el.querySelector<HTMLElement>(`[data-placement-id="${id}"]`)!;
      await act(async () => { clip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
      await settle();
      const menu = document.querySelector<HTMLElement>('[aria-label="Clip actions"]');
      expect(menu, `${id} menu`).toBeTruthy();
      record(`desktop-${id}-menu`, menu!.outerHTML);
      await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
      document.body.innerHTML = "";
    }
    // Every type shows something of its own.
    expect(Object.keys(out).length).toBeGreaterThan(CLIPS.length * 3);
    check("desktop", out);
  }, 120_000);

  it("mobile: clip toolbar and its Adjust / Audio / Colour sheets for every clip type", async () => {
    const out: Record<string, string> = {};
    const dump = process.env.INSPECTOR_PARITY_DUMP;
    const record = (key: string, html: string) => { const n = norm(html); out[key] = fnv(n); if (dump) writeFileSync(join(dump, `${key}.html`), n.replace(/></g, ">\n<")); };
    for (const id of CLIPS) {
      for (const sheet of ["", "adjust", "audio", "colour"]) {
        const el = await mount(true);
        await selectMobile(el, id);
        const bar = button(el, '[data-testid="toolbar-scroll"]')!;
        expect(bar.querySelector('[data-tool="split"]'), `${id} selected`).toBeTruthy();
        if (!sheet) {
          // The edited clip is the one asked for (the playhead is on it).
          expect(el.querySelector(`[data-placement-id="${id}"]`)!.className, id).toContain("is-selected");
          record(`mobile-${id}`, bar.outerHTML);
        }
        else {
          const tool = bar.querySelector<HTMLElement>(`[data-tool="${sheet}"]`);
          if (tool) {
            await act(async () => { tool.click(); });
            await settle();
            const sheets = Array.from(document.querySelectorAll<HTMLElement>(".v2-sheet")).map((s) => s.outerHTML).join("\n");
            record(`mobile-${id}-sheet-${sheet}`, sheets);
          }
        }
        await act(async () => { for (const r of roots.splice(0)) r.unmount(); });
        document.body.innerHTML = "";
      }
    }
    expect(Object.keys(out).length).toBeGreaterThan(CLIPS.length * 2);
    check("mobile", out);
  }, 240_000);
});

function check(view: string, out: Record<string, string>) {
  const all = (() => { try { return JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Record<string, string>>; } catch { return {}; } })();
  if (process.env.UPDATE_INSPECTOR_GOLDEN) { all[view] = out; mkdirSync(join(__dirname, "__golden__"), { recursive: true }); writeFileSync(GOLDEN, `${JSON.stringify(all, null, 2)}\n`); }
  expect(out).toEqual(all[view]);
}
