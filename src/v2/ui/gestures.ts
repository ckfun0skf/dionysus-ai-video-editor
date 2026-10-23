/** Touch gesture helpers for the timeline (V2-065). */
export const MIN_PPS = 4;
export const MAX_PPS = 400;
export const LONG_PRESS_MS = 350;
/** Movement (px) that cancels a pending long-press (it becomes a scroll). */
export const LONG_PRESS_SLOP = 8;

export const clampPps = (pps: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps));

/** New zoom after a pinch from distance `d0` to `d1` starting at `pps0`. */
export function pinchZoom(pps0: number, d0: number, d1: number): number {
  if (d0 <= 0 || d1 <= 0) return pps0;
  return clampPps(pps0 * (d1 / d0));
}

export const touchDistance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/** Short vibration where supported (Android Chrome); silently ignored elsewhere. */
export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

type Pt = { x: number; y: number };
/** Two-finger pinch/twist: scale by the finger-distance ratio, rotate by the change in finger angle (degrees). */
export function pinchPatch(t0: { scale: number; rotation: number }, a0: Pt, b0: Pt, a1: Pt, b1: Pt) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const ang = (p: Pt, q: Pt) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  let rot = t0.rotation + ang(a1, b1) - ang(a0, b0);
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  return { scale: Math.max(0.05, Math.min(20, (t0.scale * d1) / d0)), rotation: rot };
}
