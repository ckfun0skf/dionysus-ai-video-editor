// V2-112 — Google Maps–style snapping drag, shared by every resize grabber (mobile).
// Sizes are in px and grow when the finger moves UP (sheet height, timeline height).
import { useCallback, useEffect, useRef } from "react";

export const FLICK = 0.5; // px/ms — faster than this always moves ≥ 1 snap in that direction
export const PROJECT_MS = 200; // projected end = pos + v * 200ms
export const SAMPLE_MS = 100; // velocity uses the last 100ms of samples
export const DISMISS = -1;

/** Pick the snap index for a release at `pos` with velocity `v` (px/ms, + = growing):
 *  flick (> 0.5 px/ms) → the next snap in that direction; otherwise the snap nearest pos + v·200ms. */
export function pickSnap(points: number[], pos: number, v: number, opts: { dismissible?: boolean; flick?: number; project?: number } = {}): number {
  const { dismissible = false, flick = FLICK, project = PROJECT_MS } = opts;
  const n = points.length;
  const proj = pos + v * project;
  let best = 0;
  for (let i = 1; i < n; i++) if (Math.abs(points[i] - proj) < Math.abs(points[best] - proj)) best = i;
  if (Math.abs(v) > flick) {
    // A flick moves exactly one snap in its direction (predictable, like Maps' sheet).
    const eps = 4;
    if (v > 0) { const up = points.findIndex((p) => p > pos + eps); return up < 0 ? n - 1 : up; }
    for (let i = n - 1; i >= 0; i--) if (points[i] < pos - eps) return i;
    return dismissible ? DISMISS : 0;
  }
  if (dismissible && proj < points[0] * 0.5) return DISMISS;
  return best;
}

/** Rubber-band resistance past [min, max]: free inside, ever-stiffer outside (max overshoot ≈ 80px). */
export function rubberBand(x: number, min: number, max: number, limit = 80): number {
  if (x > max) { const o = x - max; return max + limit * (1 - Math.exp(-o / (limit * 1.6))); }
  if (x < min) { const o = min - x; return min - limit * (1 - Math.exp(-o / (limit * 1.6))); }
  return x;
}

/** Velocity (px/ms) over the last SAMPLE_MS of [t, pos] samples. */
export function velocityOf(samples: Array<[number, number]>, now = samples.length ? samples[samples.length - 1][0] : 0): number {
  const recent = samples.filter(([t]) => now - t <= SAMPLE_MS);
  if (recent.length < 2) return 0;
  const [t0, p0] = recent[0], [t1, p1] = recent[recent.length - 1];
  return t1 > t0 ? (p1 - p0) / (t1 - t0) : 0;
}

/** Critically damped spring position at t ms (settles in ≈300ms). */
export function springAt(from: number, to: number, v0: number, t: number, omega = 0.022): number {
  const x0 = from - to;
  return to + (x0 + (v0 + omega * x0) * t) * Math.exp(-omega * t);
}

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface SnapDragOptions {
  /** Ascending snap sizes in px, read at drag start (viewport may change). */
  points: () => number[];
  /** Current size in px. */
  size: () => number;
  /** Write the size straight to the DOM — no React render per frame. */
  apply: (px: number) => void;
  /** Called once the spring settles: snap index, or DISMISS. */
  onSettle: (index: number, px: number) => void;
  dismissible?: boolean;
}

/** Shared drag engine: begin/move/end feed it finger Y; release springs to the picked snap. */
export function useSnapDrag(opts: SnapDragOptions) {
  const o = useRef(opts); o.current = opts;
  const st = useRef<{ y0: number; s0: number; samples: Array<[number, number]>; last: number } | null>(null);
  const raf = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stop = () => { cancelAnimationFrame(raf.current); raf.current = 0; };
  const animateTo = useCallback((index: number, v0 = 0) => {
    stop();
    const pts = o.current.points();
    const from = o.current.size();
    const to = index === DISMISS ? 0 : pts[Math.max(0, Math.min(pts.length - 1, index))];
    const done = () => { o.current.apply(to); o.current.onSettle(index, to); };
    if (reducedMotion() || Math.abs(from - to) < 1 || typeof requestAnimationFrame !== "function") { done(); return; }
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = now - t0;
      const x = springAt(from, to, v0, t);
      if (t > 600 || (Math.abs(x - to) < 0.5 && t > 60)) { raf.current = 0; done(); return; }
      o.current.apply(index === DISMISS ? Math.max(0, x) : x);
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  }, []);

  const begin = useCallback((y: number, t = performance.now()) => {
    stop();
    st.current = { y0: y, s0: o.current.size(), samples: [[t, o.current.size()]], last: o.current.size() };
  }, []);
  const move = useCallback((y: number, t = performance.now()) => {
    const s = st.current; if (!s) return;
    const pts = o.current.points();
    const raw = s.s0 + (s.y0 - y);
    s.samples.push([t, raw]); if (s.samples.length > 20) s.samples.shift();
    s.last = o.current.dismissible ? Math.min(raw, rubberBand(raw, 0, pts[pts.length - 1])) : rubberBand(raw, pts[0], pts[pts.length - 1]);
    pending.current = Math.max(0, s.last);
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (pending.current != null) o.current.apply(pending.current); pending.current = null; });
  }, []);
  const end = useCallback((t = performance.now()) => {
    const s = st.current; if (!s) return; st.current = null;
    if (pending.current != null) { o.current.apply(pending.current); pending.current = null; }
    const v = velocityOf(s.samples, t);
    const pts = o.current.points();
    const index = pickSnap(pts, s.last, v, { dismissible: o.current.dismissible });
    try { if (index !== DISMISS) navigator.vibrate?.(5); } catch { /* not supported */ }
    animateTo(index, index === DISMISS ? v : v);
  }, [animateTo]);
  const dragging = () => st.current != null;
  return { begin, move, end, animateTo, dragging };
}
