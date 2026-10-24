/**
 * Effect layers (V2-101). Effect clips apply `videoEffect` presets to the main-track render only:
 * main frame → effect clips in layer order (bottom layer first) → overlays/text drawn on top. Preview and
 * export share this path (Player.draw).
 */
import type { Composition } from "../domain/model";
import { applyPreset, identityFrame, type PresetFrame } from "../registry";

/** Composite effect frame at time t, or undefined when no visible effect clip is active. Pure. */
export function effectFrameAt(comp: Composition, t: number): PresetFrame | undefined {
  let f: PresetFrame | undefined;
  for (let i = comp.tracks.length - 1; i >= 0; i -= 1) {
    const tr = comp.tracks[i];
    if (tr.kind !== "effect" || tr.hidden) continue;
    for (const p of tr.placements) {
      if (!p.effect || t < p.startTicks || t >= p.startTicks + p.durationTicks) continue;
      const prog = p.durationTicks > 1 ? (t - p.startTicks) / (p.durationTicks - 1) : 1;
      f = applyPreset("videoEffect", p.effect.preset, prog, f ?? identityFrame(), p.effect.params);
    }
  }
  return f;
}

export const isIdentity = (f: PresetFrame) => f.alpha === 1 && !f.dx && !f.dy && f.scale === 1 && !f.blur && !f.gray && !f.vignette;

type Scratch = { canvas: HTMLCanvasElement | OffscreenCanvas };
const scratch: Scratch = { canvas: undefined as unknown as HTMLCanvasElement };
function scratchCanvas(w: number, h: number) {
  if (!scratch.canvas) scratch.canvas = typeof document !== "undefined" ? document.createElement("canvas") : new OffscreenCanvas(w, h);
  const c = scratch.canvas;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Apply effect frame `f` in place to what is on `ctx` (the main-track frame). */
export function applyEffectFrame(ctx: CanvasRenderingContext2D, w: number, h: number, f: PresetFrame) {
  if (isIdentity(f)) return;
  const s = scratchCanvas(w, h);
  const g = s.getContext("2d") as CanvasRenderingContext2D | null;
  if (!g) return;
  g.globalCompositeOperation = "copy"; g.drawImage(ctx.canvas, 0, 0); g.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha));
  const filters = [f.blur ? `blur(${(f.blur * h).toFixed(2)}px)` : "", f.gray ? `grayscale(${Math.min(1, f.gray)})` : ""].filter(Boolean).join(" ");
  if (filters) ctx.filter = filters;
  ctx.translate(w / 2 + f.dx * w, h / 2 + f.dy * h); ctx.scale(f.scale, f.scale);
  ctx.drawImage(s, -w / 2, -h / 2, w, h);
  ctx.restore();
  if (f.vignette) {
    ctx.save();
    const r = Math.hypot(w, h) / 2;
    const gr = ctx.createRadialGradient(w / 2, h / 2, r * (1 - f.vignette * 0.6) * 0.6, w / 2, h / 2, r);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${Math.min(1, f.vignette).toFixed(3)})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
