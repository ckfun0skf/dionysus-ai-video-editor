/**
 * P3A-23: in-browser frame matching for a join. Frames are drawn small (32×18 luminance for scoring, ~96 px thumbnails
 * for display), so a 2 s + 2 s window at ~10 samples/s is ~40 seeks and ~400 tiny comparisons — fine on a phone.
 */
import { TICKS_PER_SECOND } from "../domain";
import { drawVideoFrame } from "./frameGrab";

export const SCORE_W = 32, SCORE_H = 18;
export interface Frame { ticks: number; luma: Float32Array; thumb?: string }
export interface MatchCandidate { aTicks: number; bTicks: number; score: number; aThumb?: string; bThumb?: string }

/** RGBA → luminance (Rec. 601), one value per pixel in 0..255. */
export function lumaOf(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return out;
}

/** Mean SSIM over non-overlapping 4×4 windows (standard constants for 8-bit data). 1 = identical. */
export function ssim(a: Float32Array, b: Float32Array, w = SCORE_W, h = SCORE_H, win = 4): number {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let sum = 0, n = 0;
  for (let y = 0; y + win <= h; y += win) for (let x = 0; x + win <= w; x += win) {
    let ma = 0, mb = 0;
    for (let j = 0; j < win; j += 1) for (let i = 0; i < win; i += 1) { const k = (y + j) * w + x + i; ma += a[k]; mb += b[k]; }
    const N = win * win; ma /= N; mb /= N;
    let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < win; j += 1) for (let i = 0; i < win; i += 1) { const k = (y + j) * w + x + i; const da = a[k] - ma, db = b[k] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= N - 1; vb /= N - 1; cov /= N - 1;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n += 1;
  }
  return n ? sum / n : 0;
}

/** Mean absolute difference, 0..255. */
export function mad(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return a.length ? s / a.length : 255;
}

/** Similarity 0..1: half structure (SSIM), half brightness/colour level (1 − MAD). */
export const similarity = (a: Float32Array, b: Float32Array) => 0.5 * Math.max(0, ssim(a, b)) + 0.5 * (1 - mad(a, b) / 255);

/**
 * Best frame pairs, highest score first. Candidates closer than `minGap` ticks on both sides to a better one are
 * skipped so the list shows genuinely different cut points.
 */
export function topMatches(a: Frame[], b: Frame[], k = 4, minGap = TICKS_PER_SECOND / 4): MatchCandidate[] {
  const all: MatchCandidate[] = [];
  for (const fa of a) for (const fb of b) all.push({ aTicks: fa.ticks, bTicks: fb.ticks, score: similarity(fa.luma, fb.luma), aThumb: fa.thumb, bThumb: fb.thumb });
  all.sort((x, y) => y.score - x.score || y.aTicks - x.aTicks || x.bTicks - y.bTicks);
  const out: MatchCandidate[] = [];
  for (const c of all) {
    if (out.some((o) => Math.abs(o.aTicks - c.aTicks) < minGap && Math.abs(o.bTicks - c.bTicks) < minGap)) continue;
    out.push(c);
    if (out.length >= k) break;
  }
  return out;
}

/** Frame-aligned sample times (ticks) in [from, to), about `perSec` per second, always including the last frame. */
export function sampleTicks(from: number, to: number, fps: number, perSec = 10): number[] {
  const ft = TICKS_PER_SECOND / fps, step = Math.max(1, Math.round(fps / perSec));
  const first = Math.ceil(from / ft - 1e-6), last = Math.ceil(to / ft - 1e-6) - 1;
  const out: number[] = [];
  for (let f = last; f >= first; f -= step) out.unshift(Math.round(f * ft));
  return out;
}

/** Seek one hidden <video> through `ticks` and capture each frame small. Calls `onProgress(done, total)`. */
export async function grabFrames(blob: Blob, ticks: number[], fps: number, onProgress?: (done: number) => void, signal?: { cancelled: boolean }): Promise<Frame[]> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  const score = document.createElement("canvas"); score.width = SCORE_W; score.height = SCORE_H;
  const thumb = document.createElement("canvas"); thumb.width = 96; thumb.height = 54;
  const gs = score.getContext("2d", { willReadFrequently: true }), gt = thumb.getContext("2d");
  try {
    if (!gs || !gt) throw new Error("Canvas is not available");
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("Can't decode this video")); });
    const out: Frame[] = [];
    for (const t of ticks) {
      if (signal?.cancelled) break;
      await new Promise<void>((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); v.currentTime = (t + TICKS_PER_SECOND / fps / 2) / TICKS_PER_SECOND; setTimeout(done, 1500); });
      await drawVideoFrame(gs, v, SCORE_W, SCORE_H);
      gt.drawImage(v, 0, 0, 96, 54);
      out.push({ ticks: t, luma: lumaOf(gs.getImageData(0, 0, SCORE_W, SCORE_H).data, SCORE_W, SCORE_H), thumb: thumb.toDataURL("image/jpeg", 0.7) });
      onProgress?.(out.length);
    }
    return out;
  } finally { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }
}
