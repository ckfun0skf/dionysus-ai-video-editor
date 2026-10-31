import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPreset, getPreset, HOOKS, identityFrame } from "../../registry";
import { applyEffectFrame } from "../../render/effects";
import { clearPaintScratch } from "../../render/paintScratch";
import { mockCtx, stubOffscreen } from "../__testutils__/mockCanvas";
import { glitchState } from "./glitch";

afterEach(() => { vi.unstubAllGlobals(); clearPaintScratch(); });

describe("glitch video effect (P20)", () => {
  it("is registered with documented params and a draw hook", () => {
    const d = getPreset("videoEffect", "glitch")!;
    expect(d.params.map((p) => p.key)).toEqual(["intensity", "frequency", "rgbShift", "slices", "seed"]);
    expect(HOOKS[d.type]?.draw).toBeTypeOf("function");
    expect(d.ai?.use).toBeTruthy();
  });
  it("is deterministic per time and seed; seeds and times vary the bursts", () => {
    const a = Array.from({ length: 200 }, (_, i) => glitchState(i / 199, { seed: 3 }));
    const b = Array.from({ length: 200 }, (_, i) => glitchState(i / 199, { seed: 3 }));
    expect(a).toEqual(b);
    expect(a.some((s) => s.burst)).toBe(true);
    expect(a.some((s) => !s.burst)).toBe(true);
    const c = Array.from({ length: 200 }, (_, i) => glitchState(i / 199, { seed: 4 }).burst);
    expect(c).not.toEqual(a.map((s) => s.burst));
    expect(glitchState(0.5, { intensity: 0 }).intensity).toBe(0);
  });
  it("draws channel split and slices on the picture; does nothing at intensity 0", () => {
    stubOffscreen();
    const { ctx, calls } = mockCtx(160, 90);
    let p = 0; while (!glitchState(p, {}).burst) p += 0.01;
    applyEffectFrame(ctx, 160, 90, applyPreset("videoEffect", "glitch", p, identityFrame()));
    expect(calls.filter((c) => c === "drawImage").length).toBeGreaterThan(2);
    const off = mockCtx(160, 90);
    applyEffectFrame(off.ctx, 160, 90, applyPreset("videoEffect", "glitch", p, identityFrame(), { intensity: 0 }));
    expect(off.calls).not.toContain("drawImage");
  });
});
