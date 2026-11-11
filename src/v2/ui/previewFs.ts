/**
 * P59: mobile fullscreen preview gestures — single vs double tap, skip sides, auto-hide.
 * Pure helpers so tests don't need the React overlay.
 */
export const FS_TAP_DELAY_MS = 280;
export const FS_SKIP_SEC = 5;
export const FS_AUTOHIDE_MS = 3000;
export const FS_DOUBLE_SLOP_PX = 48;

export type FsTapSide = "left" | "right";
export type PendingFsTap = { at: number; x: number; y: number };

export function tapSide(x: number, width: number): FsTapSide {
  return x < width / 2 ? "left" : "right";
}

export function skipDeltaSec(side: FsTapSide): number {
  return side === "left" ? -FS_SKIP_SEC : FS_SKIP_SEC;
}

export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(duration)) return 0;
  return Math.max(0, Math.min(Math.max(0, duration), t));
}

export function accumulateSkip(prevSec: number, side: FsTapSide): number {
  return prevSec + skipDeltaSec(side);
}

export function formatSkipIndicator(deltaSec: number): string {
  if (deltaSec === 0) return "";
  const sign = deltaSec > 0 ? "+" : "−";
  return `${sign}${Math.abs(deltaSec)}s`;
}

/** A second tap inside the delay window (and slop) is a double-tap; otherwise start a new pending single. */
export function resolveFsTap(
  pending: PendingFsTap | undefined,
  now: number,
  x: number,
  y: number,
  width: number,
  delayMs = FS_TAP_DELAY_MS,
): { kind: "double"; side: FsTapSide; deltaSec: number; pending: undefined } | { kind: "wait"; pending: PendingFsTap } {
  if (pending && now - pending.at <= delayMs && Math.hypot(x - pending.x, y - pending.y) <= FS_DOUBLE_SLOP_PX) {
    const side = tapSide(x, width);
    return { kind: "double", side, deltaSec: skipDeltaSec(side), pending: undefined };
  }
  return { kind: "wait", pending: { at: now, x, y } };
}

/** Controls auto-hide while playing, but stay up while paused or while the user is scrubbing. */
export function shouldAutohide(state: { visible: boolean; playing: boolean; scrubbing: boolean }): boolean {
  return state.visible && state.playing && !state.scrubbing;
}

export function createAutohide(hide: () => void, ms = FS_AUTOHIDE_MS) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (id !== undefined) { clearTimeout(id); id = undefined; } };
  return {
    ping(state: { visible: boolean; playing: boolean; scrubbing: boolean }) {
      clear();
      if (shouldAutohide(state)) id = setTimeout(hide, ms);
    },
    clear,
  };
}
