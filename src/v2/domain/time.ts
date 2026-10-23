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
