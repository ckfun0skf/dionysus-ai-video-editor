import { describe, expect, it } from "vitest";
import { blurFactor, drawWithLook, isPlainLook } from "./transitionDraw";

/** A 2D-context stand-in that records method calls. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({ canvas: { width: 100, height: 50 } } as Record<string, unknown>, {
    get(t, k: string) { if (k in t) return t[k]; return (...a: unknown[]) => { calls.push(`${k}(${a.map((v) => (typeof v === "number" ? Math.round(v) : typeof v)).join(",")})`); }; },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("drawWithLook", () => {
  it("plain looks draw straight through without touching the context", () => {
    expect(isPlainLook(undefined)).toBe(true);
    expect(isPlainLook({ scale: 1, dx: 0, tintAlpha: 0, tint: "#fff" })).toBe(true);
    expect(isPlainLook({ dx: 0.2 })).toBe(false);
    const { ctx, calls } = recorder();
    let drawn = 0;
    drawWithLook(ctx, 100, 50, undefined, (g) => { drawn += 1; expect(g).toBe(ctx); });
    expect(drawn).toBe(1);
    expect(calls).toEqual([]);
  });
  it("moves, clips and tints in frame space, and restores the context", () => {
    const { ctx, calls } = recorder();
    drawWithLook(ctx, 100, 50, { dx: 0.5, clip: [0.25, 0, 0, 0], tint: "#000", tintAlpha: 0.5 }, () => calls.push("draw"));
    expect(calls[0]).toBe("save()");
    expect(calls).toContain("rect(25,0,75,50)");
    expect(calls).toContain("clip()");
    expect(calls).toContain("translate(100,25)");
    expect(calls.indexOf("draw")).toBeGreaterThan(calls.indexOf("translate(100,25)"));
    expect(calls).toContain("fillRect(0,0,100,50)");
    expect(calls.filter((c) => c === "save()").length).toBe(calls.filter((c) => c === "restore()").length);
  });
  it("blur maps to a bounded downscale factor", () => {
    expect(blurFactor(0)).toBe(1);
    expect(blurFactor(15)).toBe(10);
    expect(blurFactor(1e6)).toBe(32);
  });
});
