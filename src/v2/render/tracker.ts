/**
 * P39: classic region tracker (normalised cross-correlation template matching with a small scale search). It runs
 * on the host over grey frames the app decodes itself; only the solved boxes (numbers) are stored or passed to code
 * clips. Works best on high-contrast, fairly persistent features; it is not AI subject segmentation.
 */
export interface Grey { w: number; h: number; px: Float32Array }
export interface PxBox { x: number; y: number; w: number; h: number }
/** `lost`: no usable match this frame (feature left the picture or the score is below LOST); box = last good box. */
export interface Step { box: PxBox; conf: number; scale: number; lost?: boolean }
/** Below this score a frame is lost (keep in sync with domain/tracking LOST_CONF). */
export const LOST = 0.45;

/** RGBA → grey (Rec. 601). */
export function grey(rgba: ArrayLike<number>, w: number, h: number): Grey {
  const px = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) px[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return { w, h, px };
}

/** A template: the box resampled to a fixed grid (nearest), zero-mean, unit norm. */
export function patch(g: Grey, b: PxBox, n = 24): Float32Array | undefined {
  const out = new Float32Array(n * n);
  let m = 0;
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const x = Math.round(b.x + ((i + 0.5) * b.w) / n - 0.5), y = Math.round(b.y + ((j + 0.5) * b.h) / n - 0.5);
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return undefined;
    const v = g.px[y * g.w + x]; out[j * n + i] = v; m += v;
  }
  m /= n * n;
  let s = 0;
  for (let k = 0; k < out.length; k += 1) { out[k] -= m; s += out[k] * out[k]; }
  s = Math.sqrt(s) || 1;
  for (let k = 0; k < out.length; k += 1) out[k] /= s;
  return out;
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < a.length; k += 1) s += a[k] * b[k]; return s; };

/**
 * Find `tpl` (taken from the first box, size `base`) in frame `g` near `prev`. Coarse grid over position and scale
 * (0.88–1.12 × the previous scale, so a subject shrinking as the camera pulls away keeps its box), then 1 px and ±3 %
 * refines. `widen` grows the search after lost frames. A blend with the last good patch adapts to slow changes in appearance.
 */
export function step(g: Grey, tpl: Float32Array, base: PxBox, prev: Step, n = 24, widen = 1): Step {
  const cx = prev.box.x + prev.box.w / 2, cy = prev.box.y + prev.box.h / 2;
  const r = Math.max(6, Math.round(Math.max(prev.box.w, prev.box.h) * 0.6 * widen));
  let best = { score: -2, x: cx, y: cy, s: prev.scale };
  const at = (x: number, y: number, s: number) => {
    const w = base.w * s, h = base.h * s, p = patch(g, { x: x - w / 2, y: y - h / 2, w, h }, n);
    const v = p ? dot(p, tpl) : -2;
    if (v > best.score) best = { score: v, x, y, s };
  };
  const coarse = Math.max(1, Math.round(r / 6));
  for (const s of [prev.scale, prev.scale * 0.94, prev.scale * 1.06, prev.scale * 0.88, prev.scale * 1.12]) for (let dy = -r; dy <= r; dy += coarse) for (let dx = -r; dx <= r; dx += coarse) at(cx + dx, cy + dy, s);
  const c = best;
  for (let dy = -coarse; dy <= coarse; dy += 1) for (let dx = -coarse; dx <= coarse; dx += 1) at(c.x + dx, c.y + dy, c.s);
  const c2 = best;
  for (const k of [0.97, 1.03]) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) at(c2.x + dx, c2.y + dy, c2.s * k);
  if (best.score < LOST) return { box: prev.box, conf: Math.max(0, best.score), scale: prev.scale, lost: true };
  const w = base.w * best.s, h = base.h * best.s;
  return { box: { x: best.x - w / 2, y: best.y - h / 2, w, h }, conf: Math.max(0, best.score), scale: best.s };
}

/**
 * Track forward and backward from frame `start` (where the user drew `box`). `frame(i)` decodes frame i; `onFrame`
 * reports each solved frame (for progress and a live box). Returns one step per frame index 0..count-1.
 */
export async function trackFrames(count: number, start: number, box: PxBox, frame: (i: number) => Promise<Grey>, onFrame?: (i: number, s: Step, done: number) => void, signal?: { cancelled: boolean }, n = 24): Promise<Step[]> {
  const out: Step[] = new Array(count);
  const g0 = await frame(start), t0 = patch(g0, box, n);
  if (!t0) throw new Error("The box must lie inside the picture.");
  out[start] = { box, conf: 1, scale: 1 };
  let done = 1; onFrame?.(start, out[start], done);
  for (const dir of [1, -1]) {
    let tpl = t0, prev = out[start], misses = 0;
    for (let i = start + dir; i >= 0 && i < count; i += dir) {
      if (signal?.cancelled) return out;
      const g = await frame(i), s = step(g, tpl, box, prev, n, misses ? Math.min(3, 1 + misses * 0.5) : 1);
      misses = s.lost ? misses + 1 : 0;
      out[i] = s; done += 1; onFrame?.(i, s, done);
      if (s.conf > 0.8) { const p = patch(g, s.box, n); if (p) { const m = new Float32Array(n * n); let q = 0; for (let k = 0; k < m.length; k += 1) { m[k] = 0.85 * t0[k] + 0.15 * p[k]; q += m[k] * m[k]; } q = Math.sqrt(q) || 1; for (let k = 0; k < m.length; k += 1) m[k] /= q; tpl = m; } }
      if (!s.lost) prev = s;
    }
  }
  return out;
}
