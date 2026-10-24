// @vitest-environment jsdom
/** V2-111: UX review P2 polish — sheet ✓, scope chip, scroll fades, ruler label overlap, menu clamp, tile font fit, timeline default. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";
import { V2App } from "./V2App";
import { fadeEdges } from "./useEdgeFade";
import { tickUnderLabel } from "./Timeline";
import { tileFontPx } from "./PresetTile";
import { ATTACH_ACCEPT } from "./HtmlEditor";
import { clampMenu } from "./desktop/ContextMenu";
import { defaultTimeline, loadSizes, LAYOUT_KEY } from "./desktop/layout";

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

describe("V2-111 helpers", () => {
  it("fadeEdges marks the edges that hide content", () => {
    expect(fadeEdges(0, 300, 300)).toBe("");
    expect(fadeEdges(0, 300, 600)).toBe("r");
    expect(fadeEdges(150, 300, 600)).toBe("lr");
    expect(fadeEdges(300, 300, 600)).toBe("l");
    expect(fadeEdges(0.5, 300, 300.5)).toBe("");
  });
  it("ruler labels under the fixed time readout are hidden, ones clear of it are not", () => {
    expect(tickUnderLabel(20, 104)).toBe(true);
    expect(tickUnderLabel(-20, 104)).toBe(true);
    expect(tickUnderLabel(-40, 104)).toBe(false);
    expect(tickUnderLabel(120, 104)).toBe(false);
  });
  it("context menu stays inside the window on both axes", () => {
    expect(clampMenu(1400, 700, 200, 300, 1440, 900)).toEqual({ left: 1236, top: 596 });
    expect(clampMenu(-10, -10, 200, 300, 1440, 900)).toEqual({ left: 4, top: 4 });
    expect(clampMenu(100, 100, 200, 300, 1440, 900)).toEqual({ left: 100, top: 100 });
  });
  it("preset tile samples shrink to fit the tile, never below 8px", () => {
    expect(tileFontPx(20, 40, 100)).toBe(20);
    expect(tileFontPx(20, 160, 100)).toBe(10);
    expect(tileFontPx(20, 1000, 100)).toBe(8);
  });
  it("first-run timeline height scales with the window; saved sizes win", () => {
    expect(defaultTimeline()).toBe(300);
    expect(defaultTimeline(600)).toBe(300);
    expect(defaultTimeline(900)).toBe(360);
    expect(defaultTimeline(1400)).toBe(420);
    expect(loadSizes({ getItem: () => null }, 900).timeline).toBe(360);
    expect(loadSizes({ getItem: (k) => (k === LAYOUT_KEY ? JSON.stringify({ left: 300, right: 320, timeline: 250 }) : null) }, 900).timeline).toBe(250);
  });
  it("Attach accepts web assets as well as media", () => {
    for (const t of ["image/*", "video/*", ".svg", ".json", ".css", ".js", ".woff2", ".glb"]) expect(ATTACH_ACCEPT.split(",")).toContain(t);
  });
});

describe("V2-111 sheets", () => {
  it("every sheet has a header with a ✓ Done at the top right that closes it", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const onClose = vi.fn();
    await act(async () => createRoot(el).render(<Sheet label="Adjust" onClose={onClose} extra={<i id="x" />}><p>body</p></Sheet>));
    const head = el.querySelector(".v2-sheet-head")!;
    expect(head.querySelector(".v2-sheet-title")?.textContent).toBe("Adjust");
    expect(head.querySelector("#x")).toBeTruthy();
    const done = head.lastElementChild as HTMLButtonElement;
    expect(done.getAttribute("aria-label")).toBe("Done");
    done.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("head={false} leaves the header to the content", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<Sheet label="Media" head={false} onClose={() => {}}><p>body</p></Sheet>));
    expect(el.querySelector(".v2-sheet-head")).toBeNull();
  });
});

const SRT = "1\n00:00:00,000 --> 00:00:01,000\nA\n\n2\n00:00:02,000 --> 00:00:03,000\nB\n";
describe("V2-111 mobile scope chip", () => {
  it("shows only while a text clip is selected, in the sheet header, as Apply to: This clip | All in layer", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<V2App />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const tool = (name: string) => [...el.querySelectorAll(".v2-toolbar .v2-tool")].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
    await act(async () => { tool("Text")!.click(); });
    const input = el.querySelector('input[aria-label="Import SRT file"]') as HTMLInputElement;
    const file = new File([SRT], "s.srt"); Object.defineProperty(file, "text", { value: async () => SRT });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); });
    expect(el.querySelector(".v2-scope-chip")).toBeNull();
    const clip = el.querySelector<HTMLElement>(".v2-clip.clip-text")!;
    await act(async () => { clip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); window.dispatchEvent(new MouseEvent("pointerup")); });
    expect(el.querySelector(".v2-scope-chip"), "no chip floating over the mobile preview").toBeNull();
    await act(async () => { tool("Adjust")!.click(); });
    const chip = el.querySelector(".v2-sheet-head .v2-scope-chip")!;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe("Apply to:This clipAll in layer");
    expect(el.querySelectorAll(".v2-scope-chip").length).toBe(1);
  });
});
