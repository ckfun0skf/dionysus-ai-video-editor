import { defineVideoEffect } from "../define";
import { clamp01, hash, n } from "../_lib/math";

/**
 * Glitch (P20): digital signal breakup. RGB channel split, horizontal slice displacement, scanlines with noise
 * flicker and random jitter bursts. Every random choice is a hash of (seed, progress step), so a frame looks the
 * same in preview, on scrub and in export. Pixel sizes are given for a 1080p frame and scaled to the canvas height.
 * No ctx.filter and no getImageData, so it is fast and identical on iOS Safari, Android Chrome and desktop.
 */
const rnd = (seed: number, a: number, b = 0) => hash(seed * 7919 + a * 104729 + b * 1299709);

/** Burst state at progress p: whether a burst is on, and a step counter that changes the pattern while it lasts. Pure. */
export function glitchState(p: number, params: { intensity?: number; frequency?: number; seed?: number }) {
  const intensity = clamp01(n(params.intensity, 0.6)), freq = Math.max(0.5, n(params.frequency, 8)), seed = Math.round(n(params.seed, 1));
  const x = clamp01(p) * freq, slot = Math.floor(x), local = x - slot;
  const burst = rnd(seed, slot) < 0.35 + 0.55 * intensity && local < 0.2 + 0.4 * intensity;
  const step = Math.floor(x * 12);
  return { intensity, seed, burst, step };
}

export default defineVideoEffect({
  id: "glitch",
  name: "Glitch",
  category: "Stylize",
  description: "Digital glitch: RGB channel split, displaced horizontal slices, scanlines and noise flicker in random bursts.",
  params: [
    { key: "intensity", label: "Intensity", type: "number", min: 0, max: 1, step: 0.05, default: 0.6, description: "Overall strength, 0 (off) to 1 (heavy breakup)." },
    { key: "frequency", label: "Frequency", type: "number", min: 1, max: 40, step: 1, default: 8, description: "Burst chances over the whole effect range (a count, not per second); higher = more frequent glitches." },
    { key: "rgbShift", label: "RGB shift", type: "number", min: 0, max: 60, step: 1, default: 12, description: "Largest red/cyan channel offset in pixels at 1080p (scaled to the frame)." },
    { key: "slices", label: "Slices", type: "number", min: 0, max: 24, step: 1, default: 8, description: "Most horizontal bands displaced during a burst (a count, 0 to 24)." },
    { key: "seed", label: "Seed", type: "number", min: 1, max: 999, step: 1, default: 1, description: "Pattern variant, 1 to 999; the same seed always glitches the same way." },
  ],
  ai: { use: "tech, gaming, cyberpunk, hacking, horror jump moments, music beats, transitions between scenes", avoid: "calm or emotional scenes; long ranges at high intensity are tiring to watch", example: { intensity: 0.7, frequency: 10, rgbShift: 16, slices: 10, seed: 3 } },
  draw: ({ ctx, w, h, p, params, scratch }) => {
    const st = glitchState(p, params);
    if (st.intensity <= 0) return;
    const { intensity, seed, burst, step } = st;
    const px = h / 1080;
    const r = (a: number, b = 0) => rnd(seed, step * 31 + a, b);
    const maxShift = Math.max(0, n(params.rgbShift, 12)) * px;
    const shift = (burst ? maxShift * (0.5 + 0.5 * r(1)) : maxShift * 0.15) * intensity * (r(2) < 0.5 ? -1 : 1);
    const orig = scratch(w, h, 0);
    if (!orig) return;
    orig.drawImage(ctx.canvas, 0, 0, w, h);
    // RGB split: red-only and cyan-only copies (alpha kept), added back side by side.
    if (Math.abs(shift) >= 0.5) {
      const red = scratch(w, h, 1), cyan = scratch(w, h, 2);
      if (red && cyan) {
        for (const [c, col] of [[red, "#ff0000"], [cyan, "#00ffff"]] as const) {
          c.drawImage(orig.canvas, 0, 0);
          c.globalCompositeOperation = "multiply"; c.fillStyle = col; c.fillRect(0, 0, w, h);
          c.globalCompositeOperation = "destination-in"; c.drawImage(orig.canvas, 0, 0);
          c.globalCompositeOperation = "source-over";
        }
        const dy = burst ? (r(3) - 0.5) * 4 * px * intensity : 0;
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(red.canvas, shift, dy);
        ctx.drawImage(cyan.canvas, -shift, -dy);
        ctx.globalCompositeOperation = "source-over";
        orig.globalCompositeOperation = "copy"; orig.drawImage(ctx.canvas, 0, 0); orig.globalCompositeOperation = "source-over";
      }
    }
    if (burst) {
      // Jitter: the whole picture jumps sideways for this step.
      const jx = (r(4) - 0.5) * 30 * px * intensity;
      // Slice displacement: bands of the picture slide left/right.
      const count = Math.round(Math.max(0, n(params.slices, 8)) * (0.4 + 0.6 * r(5)) * intensity);
      if (Math.abs(jx) >= 0.5) { ctx.clearRect(0, 0, w, h); ctx.drawImage(orig.canvas, jx, 0); orig.globalCompositeOperation = "copy"; orig.drawImage(ctx.canvas, 0, 0); orig.globalCompositeOperation = "source-over"; }
      for (let i = 0; i < count; i += 1) {
        const y = Math.floor(r(10, i) * h), sh = Math.max(2 * px, r(11, i) * h * 0.08), dx = (r(12, i) - 0.5) * 2 * Math.max(maxShift * 4, 40 * px) * intensity;
        ctx.clearRect(0, y, w, sh);
        ctx.drawImage(orig.canvas, 0, y, w, sh, dx, y, w, sh);
      }
      // Noise flicker: a few bright speckle rows.
      ctx.globalCompositeOperation = "source-atop";
      for (let i = 0; i < 6 * intensity; i += 1) {
        ctx.fillStyle = `rgba(255,255,255,${(0.08 + 0.25 * r(20, i)) * intensity})`;
        ctx.fillRect(r(21, i) * w * 0.7, r(22, i) * h, w * (0.1 + 0.5 * r(23, i)), Math.max(1, 2 * px));
      }
    }
    // Scanlines (flicker a little from step to step).
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgba(0,0,0,${((burst ? 0.22 : 0.1) + 0.06 * r(30)) * intensity})`;
    const gap = Math.max(2, Math.round(3 * px));
    for (let y = 0; y < h; y += gap) ctx.fillRect(0, y, w, Math.max(1, Math.round(px)));
  },
});
