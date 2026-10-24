import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPreset, getPreset, HOOKS, identityFrame } from "../../registry";
import { applyEffectFrame } from "../../render/effects";
import { clearPaintScratch } from "../../render/paintScratch";
import { mockCtx, stubOffscreen } from "../__testutils__/mockCanvas";

afterEach(() => { vi.unstubAllGlobals(); clearPaintScratch(); });

describe("the glow proof preset (added as one file)", () => {
  it("is registered, listed and documented with no other file touched", () => {
    const d = getPreset("videoEffect", "glow")!;
    expect(d).toBeDefined();
    expect(d.params.map((p) => p.key)).toEqual(["strength", "radius", "threshold", "color"]);
    expect(HOOKS[d.type]?.draw).toBeTypeOf("function");
    expect(d.ai?.use).toBeTruthy();
  });
  it("adds light to the picture with 'lighter' and skips when strength is 0", () => {
    const made = stubOffscreen();
    const { ctx, calls } = mockCtx(160, 90);
    applyEffectFrame(ctx, 160, 90, applyPreset("videoEffect", "glow", 0.5, identityFrame()));
    expect(calls).toContain("drawImage");
    expect(made.length).toBeGreaterThan(0);
    const off = mockCtx(160, 90);
    applyEffectFrame(off.ctx, 160, 90, applyPreset("videoEffect", "glow", 0.5, identityFrame(), { strength: 0 }));
    expect(off.calls).not.toContain("drawImage");
  });
  it("is skipped safely where no scratch canvas exists", () => {
    const { ctx, calls } = mockCtx(160, 90);
    applyEffectFrame(ctx, 160, 90, applyPreset("videoEffect", "glow", 0.5, identityFrame()));
    expect(calls).not.toContain("drawImage");
  });
});
