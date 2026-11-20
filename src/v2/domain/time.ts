/** Integer timebase: 120,000 ticks per second (divisible by common frame rates). */
export const TICKS_PER_SECOND = 120_000;
export const secondsToTicks = (s: number): number => Math.round(s * TICKS_PER_SECOND);
export const ticksToSeconds = (t: number): number => t / TICKS_PER_SECOND;
export function formatTimecode(ticks: number, fps = 30): string {
  const totalFrames = Math.floor((ticks / TICKS_PER_SECOND) * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(f)}`;
}

/**
 * P90: what a user types to go to a time: "00:01:15" (min:sec:frames, like formatTimecode), "1:02.5" (min:sec),
 * "2.5" or "2.5s" (seconds) or "45f" (frames). Snapped to the frame start so the preview shows exactly the frame
 * export renders. Undefined when it can't be read.
 */
export function parseTimecode(text: string, fps = 30): number | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return undefined;
  let sec: number | undefined;
  const fr = /^(\d+)f$/.exec(t);
  if (fr) sec = Number(fr[1]) / fps;
  else if (/^\d+:\d{1,2}:\d{1,2}$/.test(t)) { const [m, s, f] = t.split(":").map(Number); if (s < 60 && f < fps) sec = m * 60 + s + f / fps; }
  else if (/^\d+:\d{1,2}(\.\d+)?$/.test(t)) { const [m, s] = t.split(":").map(Number); if (s < 60) sec = m * 60 + s; }
  else if (/^\d+(\.\d+)?s?$/.test(t)) sec = parseFloat(t);
  if (sec === undefined || !Number.isFinite(sec)) return undefined;
  const frame = Math.round(sec * fps + 1e-9);
  return Math.round((frame * TICKS_PER_SECOND) / fps);
}
