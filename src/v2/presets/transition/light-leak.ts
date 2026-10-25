import { defineTransition } from "../define";
import { bell, clamp01, n, s } from "../_lib/math";

/** "#rrggbb" + alpha → rgba() (a gradient's clear stop must keep the hue, or it fades through grey). */
const rgba = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()), v = m ? parseInt(m[1], 16) : 0xff8a3d;
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${clamp01(a)})`;
};

/**
 * Light leak (V2-SB-130, a single-file preset): a warm flare sweeps across the frame and washes out the cut. The
 * pictures switch at the midpoint under the flare; the flare is painted with "screen" by a `paint` hook on whichever
 * side is showing, so it looks the same in preview, on iOS Safari and in export (no ctx.filter).
 */
export default defineTransition({
  id: "light-leak",
  name: "Light leak",
  category: "Light",
  description: "A warm film light leak flares across the frame and hides the cut; nostalgic, dreamy, memories.",
  params: [
    { key: "color", label: "Colour", description: "Colour of the leak (#rrggbb).", type: "color", default: "#ff8a3d" },
    { key: "strength", label: "Strength", description: "Brightness of the leak at its peak, 0 (none) to 1 (full).", type: "number", min: 0, max: 1, step: 0.05, default: 0.9 },
    { key: "dir", label: "Direction", description: "Sweep direction: 1 left to right, -1 right to left.", type: "number", min: -1, max: 1, step: 2, default: 1 },
  ],
  ai: { use: "memories, travel and lifestyle montages, warm golden-hour edits", avoid: "fast action cuts or cold, clinical looks", example: { color: "#ff9a50", strength: 0.8 } },
  type: "light-leak",
  frame: (f, p) => ({ ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: {}, tIn: {} }),
  paint: ({ ctx, w, h, p, params, side }) => {
    if ((side === "out") !== (p < 0.5)) return;
    const a = clamp01(n(params.strength, 0.9)) * bell(p);
    if (a <= 0) return;
    const col = s(params.color, "#ff8a3d"), dir = n(params.dir, 1) < 0 ? -1 : 1;
    const x = w * (0.5 + dir * (p - 0.5) * 1.6), y = h * 0.4, r = Math.max(w, h);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(col, a * 0.35);
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.9);
    g.addColorStop(0, rgba(col, a)); g.addColorStop(0.5, rgba(col, a * 0.5)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const c = ctx.createRadialGradient(x, y, 0, x, y, r * 0.35);
    c.addColorStop(0, `rgba(255,244,220,${clamp01(a * 0.9)})`); c.addColorStop(1, "rgba(255,244,220,0)");
    ctx.fillStyle = c; ctx.fillRect(0, 0, w, h);
  },
  preview: { icon: "☀" },
  order: 35,
});
