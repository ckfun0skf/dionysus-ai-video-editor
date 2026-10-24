/**
 * Offscreen scratch contexts for preset canvas hooks (V2-FX-MOD: videoEffect `draw`, transition `paint`). One canvas
 * per slot, reused across frames, separate from the effect / transition scratch canvases so a hook can never clobber
 * a picture that is still being composited. Returns undefined where no canvas exists (hooks then skip their pass).
 */
import type { Ctx2D, PaintEnv } from "../registry";

const slots: (HTMLCanvasElement | OffscreenCanvas | undefined)[] = [];

export function paintScratch(w: number, h: number, slot = 0): Ctx2D | undefined {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)), i = Math.max(0, Math.min(7, Math.floor(slot)));
  let c = slots[i];
  if (!c) c = slots[i] = typeof document !== "undefined" ? document.createElement("canvas") : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : undefined;
  if (!c) return undefined;
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const g = c.getContext("2d") as Ctx2D | null;
  if (!g) return undefined;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.filter = "none";
  g.clearRect(0, 0, W, H);
  return g;
}

/** Run hook passes on `ctx` (each in its own save/restore, identity transform). */
export function runPasses(ctx: Ctx2D, w: number, h: number, passes: ((env: PaintEnv) => void)[] | undefined) {
  for (const pass of passes ?? []) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    try { pass({ ctx, w, h, scratch: paintScratch }); } finally { ctx.restore(); }
  }
}

/** Drop the cached scratch canvases (frees memory; tests use it to start clean). */
export function clearPaintScratch() { slots.length = 0; }
