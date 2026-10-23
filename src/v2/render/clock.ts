/**
 * Playback clocks (MODULE_DESIGN §9): AudioContext.currentTime is the master clock so audio never drifts;
 * media elements are slaved to it. Falls back to performance.now() where Web Audio is unavailable
 * (or the context is still suspended, e.g. before a user gesture on iOS).
 */
export interface Clock {
  /** Monotonic seconds. */
  now(): number;
  /** Called on play (inside the user gesture) so audio contexts can resume. */
  start?(): void;
  readonly kind: "audio" | "wall";
}

export const wallClock = (perf: { now(): number } = performance): Clock => ({ kind: "wall", now: () => perf.now() / 1000 });

type Ctx = Pick<AudioContext, "currentTime" | "state" | "resume">;

export class AudioClock implements Clock {
  readonly kind = "audio" as const;
  private fallback: Clock;
  /** Offset so switching between wall and audio time never jumps. */
  private offset = 0;
  private usingAudio = false;
  constructor(readonly ctx: Ctx, fallback: Clock = wallClock()) { this.fallback = fallback; }
  start() { if (this.ctx.state !== "running") void this.ctx.resume().catch(() => undefined); }
  now(): number {
    const running = this.ctx.state === "running";
    if (running !== this.usingAudio) {
      const t = this.usingAudio ? this.ctx.currentTime + this.offset : this.fallback.now() + this.offset;
      this.usingAudio = running;
      this.offset = t - (running ? this.ctx.currentTime : this.fallback.now());
    }
    return (running ? this.ctx.currentTime : this.fallback.now()) + this.offset;
  }
}

/** Default: AudioContext master when available, wall clock otherwise. */
export function createClock(): { clock: Clock; ctx?: AudioContext } {
  const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return { clock: wallClock() };
  try { const ctx = new AC({ latencyHint: "interactive" }); return { clock: new AudioClock(ctx), ctx }; } catch { return { clock: wallClock() }; }
}

/**
 * Drift correction for a slaved media element. Returns the action to take:
 * hard seek when far off, playbackRate nudge (±5%) when slightly off, otherwise rate 1.
 */
export function correctDrift(elementTime: number, target: number): { seek?: number; rate: number } {
  const drift = elementTime - target;
  if (Math.abs(drift) > 0.25) return { seek: target, rate: 1 };
  if (Math.abs(drift) > 0.03) return { rate: drift > 0 ? 0.95 : 1.05 };
  return { rate: 1 };
}
