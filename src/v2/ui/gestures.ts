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
