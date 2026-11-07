// @vitest-environment jsdom
/** P49: Mask sheet — cancel restores nothing, ✓ is one undo, freeform close and safe delete. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, findPlacement, type Asset } from "../domain";
import { cmd, Engine } from "../engine";
import { MaskSheet } from "./MaskSheet";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  if (typeof PointerEvent === "undefined") {
    class PE extends MouseEvent { pointerId = 1; }
    (globalThis as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PE as unknown as typeof MouseEvent;
  }
});

const asset: Asset = { id: "im", kind: "image", name: "sign.png", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "", media: { blobKey: "b", mime: "image/png", width: 400, height: 300 }, provenance: { source: "import", inputs: [] } }] };

function mount() {
  const e = new Engine(createProject("m"));
  e.dispatch([cmd.importAsset(asset), cmd.addAssetToTimeline("im", 0, undefined, "c1")]);
  const pl = () => findPlacement(e.getState().project.compositions[e.getState().project.rootCompositionId], "c1")!.placement;
  const onClose = vi.fn(), onDone = vi.fn(), onPreview = vi.fn();
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  act(() => { root.render(<MaskSheet engine={e} project={e.getState().project} placement={pl()} time={0} loadBlob={async () => new Blob()} onPreview={onPreview} onClose={onClose} onDone={onDone} />); });
  const stage = el.querySelector(".v2-track-stage") as HTMLDivElement;
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 150, right: 200, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
  const ptr = (type: string, x: number, y: number) => act(() => { stage.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 })); });
  const btn = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  return { e, el, pl, ptr, btn, onClose, onDone, onPreview, root };
}

describe("MaskSheet", () => {
  it("cancel does not change the clip; apply is one undo", () => {
    const t = mount();
    expect(t.onPreview).toHaveBeenCalled();
    act(() => { (t.el.querySelector('[aria-label="Feather"]') as HTMLInputElement).value = "0.2"; t.el.querySelector('[aria-label="Feather"]')!.dispatchEvent(new Event("input", { bubbles: true })); t.el.querySelector('[aria-label="Feather"]')!.dispatchEvent(new Event("change", { bubbles: true })); });
    act(() => { t.btn("Cancel").click(); });
    expect(t.onClose).toHaveBeenCalled();
    expect(t.pl().mask).toBeUndefined();
    act(() => { t.btn("Apply mask").click(); });
    expect(t.pl().mask?.shape).toBe("rect");
    expect(t.e.undo()).toBe(true);
    expect(t.pl().mask).toBeUndefined();
  });

  it("freeform places points, closes, and will not delete the shape down to a line", () => {
    const t = mount();
    act(() => { ([...t.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Freeform") as HTMLButtonElement).click(); });
    for (const [x, y] of [[40, 30], [140, 40], [100, 110]] as const) { t.ptr("pointerdown", x, y); t.ptr("pointerup", x, y); }
    expect(t.btn("Close path").disabled).toBe(false);
    act(() => { t.btn("Close path").click(); });
    const point = t.el.querySelector('[aria-label="Point 1"]') as HTMLButtonElement;
    expect(point.className).toContain("v2-track-pt");
    act(() => { point.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 30, pointerId: 1 })); });
    act(() => { t.btn("Delete point").click(); });
    expect(t.el.textContent).toMatch(/at least 3/);
    expect(t.pl().mask).toBeUndefined();
  });

  it("touch targets are at least 44px in the stylesheet", () => {
    const css = readFileSync(resolve(__dirname, "v2.css"), "utf8");
    expect(css).toMatch(/\.v2-mask \.v2-btn \{ min-height: 44px/);
    expect(css).toMatch(/\.v2-track-pt \{[^}]*width: 44px/);
    expect(css).toMatch(/\.v2-subimport-head \.v2-icon-btn \{[^}]*min-width: 44px/);
  });
});
