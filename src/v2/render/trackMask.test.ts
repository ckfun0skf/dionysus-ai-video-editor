import { describe, expect, it } from "vitest";
import { maskRect } from "./trackMask";
import type { Placement } from "../domain/model";

const p = (mask?: "inside" | "outside"): Placement => ({ id: "v", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "b" }, clipType: "video", motionTrack: { srcW: 200, srcH: 100, mask, samples: [{ s: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.4, scale: 1, conf: 1 }] } });
const r = { cx: 0, cy: 0, w: 400, h: 200, rot: 0, alpha: 1, sx: 0, sy: 0, sw: 200, sh: 100 };

describe("P39 traveling mask", () => {
  it("maps the tracked box into the clip's local draw space", () => {
    expect(maskRect(p("inside"), 200, 100, r, 0)).toEqual({ x: -40, y: -40, w: 80, h: 80, inside: true });
    expect(maskRect(p("outside"), 200, 100, r, 0)!.inside).toBe(false);
  });
  it("does nothing without a mask", () => { expect(maskRect(p(), 200, 100, r, 0)).toBeUndefined(); });
});
