/** Test helpers for preset smoke renders (not a preset module; the loader glob skips __*__ folders). */
import { vi } from "vitest";

/** A 2D-context stand-in: every method is a recorded no-op, properties are settable, gradients and text metrics exist. */
export function mockCtx(w = 64, h = 36) {
  const calls: string[] = [];
  const t: Record<string, unknown> = { canvas: { width: w, height: h }, globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none" };
  const ctx: unknown = new Proxy(t, {
    get(o, k: string) {
      if (k in o) return o[k];
      if (k === "createRadialGradient" || k === "createLinearGradient" || k === "createPattern") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "getImageData") return (_x: number, _y: number, iw: number, ih: number) => ({ width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) });
      if (k === "then") return undefined;
      return (...a: unknown[]) => { calls.push(String(k)); for (const v of a) if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${k}: non-finite argument`); };
    },
    set(o, k: string, v) { if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${k} = ${v}`); o[k] = v; return true; },
  });
  return { ctx: ctx as CanvasRenderingContext2D, calls };
}

/** Make `paintScratch` find a canvas in the node test environment. */
export function stubOffscreen() {
  const made: ReturnType<typeof mockCtx>[] = [];
  vi.stubGlobal("OffscreenCanvas", class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { const m = mockCtx(this.width, this.height); made.push(m); (m.ctx as unknown as { canvas: unknown }).canvas = this; return m.ctx; } });
  return made;
}
