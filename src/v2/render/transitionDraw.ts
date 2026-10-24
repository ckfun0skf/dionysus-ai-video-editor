/**
 * Transition look renderer (V2-TL-TRANS): draws one side of a transition (a layer) with the extra motion, blur,
 * wipe, iris, glitch and tint its preset asks for. Shared by the Player (preview and export) and the transition
 * picker's tile previews, so a tile shows exactly what the cut will look like.
 *
 * Blur avoids `ctx.filter` (unsupported on iOS Safari canvases): the layer is drawn into a downscaled scratch canvas
 * and scaled back up, which is cheap on phones and looks the same everywhere.
 */
import { hash, type TransLayer } from "../registry";
import { paintScratch } from "./paintScratch";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

let scratch: AnyCanvas | undefined;
function scratchCtx(w: number, h: number): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | undefined {
  if (!scratch) scratch = typeof document !== "undefined" ? document.createElement("canvas") : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : undefined;
  if (!scratch) return undefined;
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  const g = scratch.getContext("2d") as Ctx | null;
  if (!g) return undefined;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return g;
}

/** True when the look changes nothing (the layer can be drawn directly). */
export function isPlainLook(fx: TransLayer | undefined): boolean {
  if (!fx) return true;
  return !fx.dx && !fx.dy && (fx.scale === undefined || fx.scale === 1) && !fx.rot && !(fx.blur && fx.blur > 0) && !fx.clip
    && fx.iris === undefined && !(fx.glitch && fx.glitch > 0) && !(fx.tint && (fx.tintAlpha ?? 0) > 0) && !fx.paint;
}

/** Downscale factor for a blur radius in pixels (1 = no blur). */
export const blurFactor = (px: number) => Math.max(1, Math.min(32, px / 1.5));

/**
 * Draw a layer through `draw(g)` (which paints it in frame coordinates W×H, as if unmodified) with the look `fx`.
 * Leaves the context state as it found it.
 */
export function drawWithLook(ctx: Ctx, W: number, H: number, fx: TransLayer | undefined, draw: (g: Ctx) => void): void {
  if (isPlainLook(fx)) { draw(ctx); return; }
  const f = fx!;
  ctx.save();
  const alpha = ctx.globalAlpha;
  // Wipe / iris clip in frame space (the edge stays put while the picture moves).
  if (f.clip || f.iris !== undefined) {
    ctx.beginPath();
    if (f.clip) {
      const [l, t, r, b] = f.clip.map((v) => Math.max(0, Math.min(1, v)));
      ctx.rect(l * W, t * H, Math.max(0, W * (1 - l - r)), Math.max(0, H * (1 - t - b)));
    } else {
      const rad = Math.max(0, f.iris!) * Math.hypot(W, H) / 2;
      ctx.arc(W / 2, H / 2, rad, 0, Math.PI * 2);
    }
    ctx.clip();
  }
  const moved = (g: Ctx) => {
    const s = f.scale ?? 1;
    if (f.dx || f.dy || s !== 1 || f.rot) {
      g.translate(W / 2 + (f.dx ?? 0) * W, H / 2 + (f.dy ?? 0) * H);
      if (f.rot) g.rotate((f.rot * Math.PI) / 180);
      if (s !== 1) g.scale(s, s);
      g.translate(-W / 2, -H / 2);
    }
    draw(g);
  };
  const k = f.blur && f.blur > 0 ? blurFactor(f.blur * H) : 1;
  const glitch = f.glitch && f.glitch > 0 ? f.glitch : 0;
  const g = k > 1.2 || glitch ? scratchCtx(Math.max(1, Math.ceil(W / k)), Math.max(1, Math.ceil(H / k))) : undefined;
  if (g) {
    const sw = g.canvas.width, sh = g.canvas.height;
    g.save(); g.scale(sw / W, sh / H); moved(g); g.restore();
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    const src = g.canvas as CanvasImageSource;
    if (glitch) {
      const bands = 12, seed = f.seed ?? 0;
      for (let i = 0; i < bands; i += 1) {
        const y0 = (i * H) / bands, y1 = ((i + 1) * H) / bands;
        const off = hash(seed * 13 + i) > 0.5 ? (hash(seed * 7 + i * 3) - 0.5) * 2 * glitch * W : 0;
        ctx.drawImage(src, 0, (y0 / H) * sh, sw, ((y1 - y0) / H) * sh, off, y0, W, y1 - y0);
      }
    } else ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
  } else moved(ctx);
  if (f.tint && (f.tintAlpha ?? 0) > 0) {
    ctx.globalAlpha = Math.min(1, f.tintAlpha!);
    ctx.fillStyle = f.tint;
    ctx.fillRect(0, 0, W, H);
  }
  // Transition `paint` hook (V2-FX-MOD): draws over this side, inside its clip, at the side's opacity.
  if (f.paint) {
    ctx.save();
    ctx.globalAlpha = alpha;
    f.paint({ ctx, w: W, h: H, scratch: paintScratch });
    ctx.restore();
  }
  ctx.restore();
}
