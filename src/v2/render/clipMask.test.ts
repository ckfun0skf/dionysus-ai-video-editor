import { describe, expect, it } from "vitest";
import { defaultMask, type ClipMask } from "../domain/mask";
import { boxBlur, bufferToSource, multiplyMask, paintClip } from "./clipMask";
import { placeRect } from "./frame";
import { sourceToCanvas } from "../domain/mask";
import type { Placement } from "../domain/model";
import { mockCtx, stubOffscreen } from "../presets/__testutils__/mockCanvas";

const fill = (w: number, h: number, a = 255) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = a; }
  return d;
};
const at = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];
const placed = { w: 40, h: 40, sx: 0, sy: 0, sw: 40, sh: 40 };

describe("P49 mask raster", () => {
  const rect = { ...defaultMask("rect"), x: 0.5, y: 0.5, w: 0.5, h: 0.5 };

  it("blurs alpha without canvas.filter and keeps a hard centre", () => {
    const src = new Uint8Array(49);
    src[3 * 7 + 3] = 255;
    const soft = boxBlur(src, 7, 7, 1, 1);
    expect(soft[3 * 7 + 3]).toBeGreaterThan(soft[0]);
    expect(soft[3 * 7 + 3]).toBeLessThan(255);
    expect(src[3 * 7 + 3]).toBe(255);
  });

  it("masks a rect: centre stays, the corner is clear, invert swaps them, expand grows", () => {
    const hard = fill(40, 40);
    multiplyMask(hard, 40, 40, rect, 40, 40, placed, 0);
    expect(at(hard, 40, 20, 20)).toBe(255);
    expect(at(hard, 40, 1, 1)).toBe(0);
    const inv = fill(40, 40);
    multiplyMask(inv, 40, 40, { ...rect, invert: true }, 40, 40, placed, 0);
    expect(at(inv, 40, 20, 20)).toBe(0);
    expect(at(inv, 40, 1, 1)).toBe(255);
    const grown = fill(40, 40);
    multiplyMask(grown, 40, 40, { ...rect, expand: 0.2 }, 40, 40, placed, 0);
    expect(at(grown, 40, 2, 20)).toBe(255);
    expect(at(hard, 40, 2, 20)).toBe(0);
  });

  it("feathers the edge and does not leak into a second layer", () => {
    const a = fill(40, 40), b = fill(40, 40);
    const before = at(b, 40, 1, 1);
    multiplyMask(a, 40, 40, { ...rect, feather: 0.15 }, 40, 40, placed, 0);
    const edge = at(a, 40, 8, 20);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(at(a, 40, 20, 20)).toBe(255);
    expect(at(b, 40, 1, 1)).toBe(before);
  });

  it("ellipse, linear split, band and a bezier path all cover the centre only", () => {
    const shapes: ClipMask[] = [
      defaultMask("ellipse"),
      defaultMask("linear"),
      defaultMask("band"),
      { shape: "path", closed: true, nodes: [{ id: "a", x: 0.2, y: 0.2, out: { x: 0.1, y: 0 } }, { id: "b", x: 0.8, y: 0.25 }, { id: "c", x: 0.75, y: 0.8 }, { id: "d", x: 0.25, y: 0.75 }] },
    ];
    for (const mask of shapes) {
      const d = fill(40, 40);
      multiplyMask(d, 40, 40, mask, 40, 40, placed, 0);
      const inside = mask.shape === "linear" ? at(d, 40, 20, 8) : at(d, 40, 20, 20);
      expect(inside, mask.shape).toBeGreaterThan(200);
      expect(at(d, 40, 1, 39), mask.shape).toBe(0);
    }
  });

  it("maps source points through crop, rotation and letterbox", () => {
    const p = { id: "c", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "image" as const, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0.25, t: 0, r: 0, b: 0 } } };
    const r = placeRect(p, 100, 100, 200, 100, 0);
    expect(r.cx).toBeGreaterThan(100);
    const left = sourceToCanvas(0.25, 0.5, 100, 100, r);
    expect(left.x).toBeCloseTo(r.cx - r.w / 2, 3);
    const outside = sourceToCanvas(0, 0.5, 100, 100, r);
    expect(outside.x).toBeLessThan(left.x);
    const turned = placeRect({ ...p, transform: { ...p.transform!, crop: { l: 0, t: 0, r: 0, b: 0 }, rotation: 90 } }, 100, 100, 200, 100, 0);
    const top = sourceToCanvas(0.5, 0, 100, 100, turned);
    expect(Math.hypot(top.x - turned.cx, top.y - turned.cy)).toBeGreaterThan(10);
  });

  it("a padded buffer pixel outside the crop is not the crop's corner", () => {
    const p = bufferToSource(0, 20, 40, 40, { w: 40, h: 40, sx: 10, sy: 0, sw: 20, sh: 40, pad: 4 });
    expect(p.nx).toBeLessThan(10 / 40);
  });

  it("paintClip clips a hard mask and rasters a feathered one on the shared path", () => {
    const made = stubOffscreen();
    const { ctx, calls } = mockCtx(80, 80);
    const placement = { id: "c", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "image" as const } satisfies Placement;
    const r = { cx: 40, cy: 40, w: 40, h: 40, rot: 0, alpha: 1, sx: 0, sy: 0, sw: 40, sh: 40 };
    paintClip(ctx, placement, rect, 40, 40, r, 0, 0, () => undefined);
    expect(calls).toContain("clip");
    const feathered = mockCtx(80, 80);
    paintClip(feathered.ctx, placement, { ...rect, feather: 0.1 }, 40, 40, r, 0, 0, () => undefined);
    expect(made.some((m) => m.calls.includes("putImageData"))).toBe(true);
    expect(feathered.calls).toContain("drawImage");
    expect(feathered.calls.join(" ")).not.toContain("filter");
  });
});
