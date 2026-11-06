/**
 * P39: decode a video clip's frames in the browser (one hidden <video>, seek per sample) and run the host-side region
 * tracker over small grey copies. Only the solved boxes leave this module.
 */
import { clipRange, tracking, TICKS_PER_SECOND, type Box, type MotionTrack, type NamedTrack, type Placement, type Project, type TrackSample } from "../domain";
import { grey, trackFrames, type Grey } from "../render";
import { drawVideoFrame } from "./frameGrab";

/** Analysis frames are at most this wide (aspect kept): enough detail for a classic tracker, fast on a phone. */
export const ANALYSIS_W = 320;
/** At most this many analysed frames per clip (longer clips are sampled every n-th frame). */
export const MAX_SAMPLES = 600;

/** Frame-aligned source ticks across the clip's source span, at most MAX_SAMPLES. */
export function trackTicks(project: Project, p: Placement, range?: { from: number; to: number }): number[] {
  const span = clipRange.sourceSpan(project, p);
  const inTicks = Math.max(span.inTicks, range?.from ?? -Infinity), outTicks = Math.min(span.outTicks, range?.to ?? Infinity);
  const ft = TICKS_PER_SECOND / project.settings.fps, n = Math.max(1, Math.ceil((outTicks - inTicks) / ft));
  const stride = Math.max(1, Math.ceil(n / MAX_SAMPLES)), out: number[] = [];
  for (let f = 0; f < n; f += stride) out.push(Math.round(inTicks + f * ft));
  return out;
}
export const nearestIndex = (ticks: number[], s: number) => ticks.reduce((b, t, i) => (Math.abs(t - s) < Math.abs(ticks[b] - s) ? i : b), 0);

export type TrackAnalyse = (ticks: number[], start: number, box: Box, onProgress: (done: number, partial: TrackSample[]) => void, signal: { cancelled: boolean }) => Promise<MotionTrack>;

/** The default analyser for one clip's media blob. */
export function makeTrackAnalyse(blob: () => Promise<Blob | undefined>): TrackAnalyse {
  return async (ticks, start, box, onProgress, signal) => {
    const b = await blob();
    if (!b) throw new Error("The video file for this clip is not on this device");
    const url = URL.createObjectURL(b), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    try {
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("Can't decode this video")); });
      const srcW = v.videoWidth || 16, srcH = v.videoHeight || 9, w = Math.min(ANALYSIS_W, srcW), h = Math.max(8, Math.round((w * srcH) / srcW));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) throw new Error("Canvas is not available");
      const frame = async (i: number): Promise<Grey> => {
        await new Promise<void>((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); v.currentTime = ticks[i] / TICKS_PER_SECOND + 0.001; setTimeout(done, 1500); });
        await drawVideoFrame(g, v, w, h);
        return grey(g.getImageData(0, 0, w, h).data, w, h);
      };
      const partial: TrackSample[] = [];
      const toSample = (i: number, s: { box: { x: number; y: number; w: number; h: number }; conf: number; scale: number; lost?: boolean }): TrackSample => ({ s: ticks[i], x: (s.box.x + s.box.w / 2) / w, y: (s.box.y + s.box.h / 2) / h, w: s.box.w / w, h: s.box.h / h, scale: Math.round(s.scale * 1000) / 1000, conf: Math.round(s.conf * 100) / 100, ...(s.lost ? { lost: true } : {}) });
      const steps = await trackFrames(ticks.length, start, { x: box.x * w, y: box.y * h, w: box.w * w, h: box.h * h }, frame, (i, s, done) => { partial[i] = toSample(i, s); onProgress(done, partial); }, signal);
      return { srcW, srcH, samples: steps.map((s, i) => (s ? toSample(i, s) : undefined)).filter((s): s is TrackSample => !!s) };
    } finally { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); }
  };
}

/**
 * P40: set tracker `tr`'s range to [inS, outS). Shrinking drops samples outside; extending analyses only the new part,
 * seeded from the nearest good box at the old edge (no seed = nothing to grow from: that part stays empty).
 */
export async function rangeTrack(analyse: TrackAnalyse, project: Project, p: Placement, tr: NamedTrack, inS: number, outS: number, onProgress?: (done: number, total: number) => void, signal = { cancelled: false }): Promise<NamedTrack> {
  const missing = tracking.missingRanges(tr, inS, outS);
  let next = tracking.withRange(tr, inS, outS);
  const parts = missing.map((m) => ({ m, ticks: trackTicks(project, p, { from: m.from, to: m.to }) })).filter((x) => x.ticks.length);
  const total = parts.reduce((s, x) => s + x.ticks.length, 0);
  let base = 0;
  for (const { m, ticks } of parts) {
    const before = m.seed.s <= m.from;
    const all = before ? [m.seed.s, ...ticks] : [...ticks, m.seed.s], start = before ? 0 : all.length - 1;
    const box: Box = { x: m.seed.x - m.seed.w / 2, y: m.seed.y - m.seed.h / 2, w: m.seed.w, h: m.seed.h };
    const res = await analyse(all, start, box, (d) => onProgress?.(base + d, total), signal);
    base += ticks.length;
    const fresh = res.samples.filter((s) => s.s !== m.seed.s).map((s) => ({ ...s, scale: Math.round(s.scale * m.seed.scale * 1000) / 1000 }));
    next = { ...next, samples: [...next.samples, ...fresh].sort((a, b) => a.s - b.s) };
  }
  return next;
}
