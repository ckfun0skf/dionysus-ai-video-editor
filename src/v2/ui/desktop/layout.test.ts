import { describe, expect, it } from "vitest";
import { ASPECTS, aspectOf, clampSizes, DEFAULT_SIZES, LAYOUT_KEY, LIMITS, loadSizes, MIN_CENTER, previewCanvasSize, saveSizes } from "./layout";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe("desktop layout", () => {
  it("clamps every panel to its limits", () => {
    const s = clampSizes({ left: 10, right: 9999, timeline: 5, leftOpen: true, rightOpen: true });
    expect(s.left).toBe(LIMITS.left[0]);
    expect(s.right).toBe(LIMITS.right[1]);
    expect(s.timeline).toBe(LIMITS.timeline[0]);
  });
  it("keeps the preview usable on a small window: shrinks the inspector first", () => {
    const s = clampSizes({ ...DEFAULT_SIZES, left: 500, right: 500 }, 1280, 800);
    expect(s.left + s.right + MIN_CENTER).toBeLessThanOrEqual(1280);
    expect(s).toMatchObject({ left: 500, right: 420 });
    expect(clampSizes({ ...DEFAULT_SIZES, left: 560, right: 560 }, 1000, 800)).toMatchObject({ right: LIMITS.right[0], left: 1000 - MIN_CENTER - LIMITS.right[0] });
    const closed = clampSizes({ ...DEFAULT_SIZES, left: 500, right: 500, rightOpen: false }, 1280, 800);
    expect(closed.left).toBe(500);
    expect(clampSizes({ ...DEFAULT_SIZES, timeline: 640 }, 1440, 600).timeline).toBeLessThanOrEqual(600 - 48 - 220);
  });
  it("persists and restores sizes, ignoring junk", () => {
    const st = mem();
    expect(loadSizes(st)).toEqual(DEFAULT_SIZES);
    saveSizes({ left: 400, right: 300, timeline: 260, leftOpen: false, rightOpen: true }, st);
    expect(loadSizes(st)).toEqual({ left: 400, right: 300, timeline: 260, leftOpen: false, rightOpen: true });
    st.setItem(LAYOUT_KEY, "{not json");
    expect(loadSizes(st)).toEqual(DEFAULT_SIZES);
    st.setItem(LAYOUT_KEY, JSON.stringify({ left: "wide", timeline: 1e9 }));
    expect(loadSizes(st)).toMatchObject({ left: DEFAULT_SIZES.left, timeline: LIMITS.timeline[1] });
    expect(() => saveSizes(DEFAULT_SIZES, { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });
  it("preview canvas follows the project aspect", () => {
    expect(previewCanvasSize({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });
    expect(previewCanvasSize({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 });
    expect(previewCanvasSize({ width: 1080, height: 1080 })).toEqual({ width: 1280, height: 1280 });
    for (const a of ASPECTS) expect(aspectOf(a)).toBe(a.id);
    expect(aspectOf({ width: 1000, height: 333 })).toBeUndefined();
  });
});
