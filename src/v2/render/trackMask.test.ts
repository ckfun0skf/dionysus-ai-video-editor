import { describe, expect, it } from "vitest";
import { maskRect } from "./trackMask";
import type { NamedTrack } from "../domain/tracking";

const tr = (mask?: "inside" | "outside", lost = false): NamedTrack => ({ id: "mt1", name: "Track 1", inS: 0, outS: 10, srcW: 200, srcH: 100, mask, samples: [{ s: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.4, scale: 1, conf: lost ? 0.1 : 1, ...(lost ? { lost: true } : {}) }] });
const r = { cx: 0, cy: 0, w: 400, h: 200, rot: 0, alpha: 1, sx: 0, sy: 0, sw: 200, sh: 100 };

describe("P39/P40 traveling mask", () => {
  it("maps the tracked box into the clip's local draw space", () => {
    expect(maskRect(tr("inside"), 200, 100, r, 0)).toEqual({ x: -40, y: -40, w: 80, h: 80, inside: true });
    expect((maskRect(tr("outside"), 200, 100, r, 0) as { inside: boolean }).inside).toBe(false);
  });
  it("does nothing without a mask; hides an inside mask when lost or out of range, never invents a box", () => {
    expect(maskRect(tr(), 200, 100, r, 0)).toBeUndefined();
    expect(maskRect(tr("inside", true), 200, 100, r, 0)).toEqual({ hide: true });
    expect(maskRect(tr("inside"), 200, 100, r, 20)).toEqual({ hide: true });
    expect(maskRect(tr("outside", true), 200, 100, r, 0)).toBeUndefined();
  });
});
