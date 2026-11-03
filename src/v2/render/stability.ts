/**
 * P27-PREVIEW-STABILITY: helpers that keep the preview steady on timelines with many clips.
 * - The buffer gate holds the playhead while a playing source has no data yet, so sound and picture
 *   do not run ahead of the media (the cause of black frames and choppy audio after a cut).
 * - Idle eviction caps how many media elements stay loaded; browsers have a small number of decoders,
 *   and every extra element holding one makes the next clip slower to start.
 */

/** How long a source may be short of data before the player shows "Loading" and holds the playhead (ms). */
export const BUFFER_GRACE_MS = 300;
/** Media elements kept loaded that are neither on screen nor about to start. */
export const MAX_IDLE_MEDIA = 6;
/** P30-WARM-MEDIA: idle elements kept warm on desktop-class devices (phones keep MAX_IDLE_MEDIA; decoders are scarce there). */
export const MAX_IDLE_MEDIA_DESKTOP = 16;
/** Idle cap for this device: 6 on phones/tablets or under 4 GB memory, 16 on desktops. */
export function idleCap(env: { userAgent?: string; deviceMemory?: number; maxTouchPoints?: number } | undefined = typeof navigator !== "undefined" ? (navigator as never) : undefined): number {
  if (!env) return MAX_IDLE_MEDIA;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(env.userAgent ?? "") || (/Macintosh/.test(env.userAgent ?? "") && (env.maxTouchPoints ?? 0) > 1);
  if (mobile || (env.deviceMemory !== undefined && env.deviceMemory < 4)) return MAX_IDLE_MEDIA;
  return MAX_IDLE_MEDIA_DESKTOP;
}

export class BufferGate {
  private since?: number;
  buffering = false;
  constructor(private graceMs = BUFFER_GRACE_MS) {}
  /** Feed the stall state at time `nowMs`; returns true while the playhead should be held. */
  update(nowMs: number, stalled: boolean): boolean {
    if (!stalled) { this.since = undefined; this.buffering = false; return false; }
    this.since ??= nowMs;
    this.buffering = nowMs - this.since >= this.graceMs;
    return this.buffering;
  }
  reset() { this.since = undefined; this.buffering = false; }
}

/** Ids to release: idle entries (not in `keep`) beyond `max`, least recently used first. */
export function idleEvictions(lastUsed: ReadonlyMap<string, number>, keep: ReadonlySet<string>, max = MAX_IDLE_MEDIA): string[] {
  const idle = [...lastUsed].filter(([id]) => !keep.has(id)).sort((a, b) => a[1] - b[1]);
  return idle.slice(0, Math.max(0, idle.length - max)).map(([id]) => id);
}

/**
 * P30-STALL-HYSTERESIS: true when a playing media element is short of data. A source enters the stalled state only when
 * it cannot show the current frame (readyState < HAVE_CURRENT_DATA, or seeking); once stalled it must reach
 * HAVE_FUTURE_DATA to leave it. Brief dips to HAVE_CURRENT_DATA during normal playback therefore never stall.
 */
export function mediaStalled(el: { readyState: number; seeking: boolean; error?: unknown }, wasStalled = false): boolean {
  if (el.error) return false;
  return el.seeking || el.readyState < (wasStalled ? 3 : 2);
}

/** P29-CLIP-LOADING: how far a clip's media has loaded. `progress` is undefined when the browser reports no buffered ranges. */
export interface ClipLoad { progress?: number }

/** Share of `duration` covered by the buffered ranges (0–1), or undefined when unknown. */
export function bufferedFraction(buffered: { length: number; start(i: number): number; end(i: number): number } | undefined, duration: number): number | undefined {
  if (!buffered || !buffered.length || !Number.isFinite(duration) || duration <= 0) return undefined;
  let sum = 0;
  for (let i = 0; i < buffered.length; i += 1) sum += Math.max(0, Math.min(duration, buffered.end(i)) - Math.max(0, buffered.start(i)));
  return Math.max(0, Math.min(1, sum / duration));
}

/** Load state of a media element, or undefined once it can play (or has failed: the clip shows its error elsewhere). */
export function clipLoadOf(el: { readyState: number; seeking: boolean; error?: unknown; buffered?: TimeRanges; duration: number }, playing: boolean): ClipLoad | undefined {
  if (el.error) return undefined;
  const ready = playing ? el.readyState >= 3 && !el.seeking : el.readyState >= 2;
  return ready ? undefined : { progress: bufferedFraction(el.buffered, el.duration) };
}

/** Stable text form of a load map, to notify listeners only on change (progress in 5% steps). */
export function loadSignature(m: ReadonlyMap<string, ClipLoad>): string {
  return [...m].map(([id, l]) => `${id}:${l.progress === undefined ? "?" : Math.round(l.progress * 20)}`).sort().join(",");
}
