import { defineVideoEffect } from "../define";
import { n, s } from "../_lib/math";

/**
 * Glow / bloom (V2-FX-MOD proof preset, added as this single file). Bright areas bleed soft light: the picture is
 * shrunk, its highlights isolated by multiplying it with itself, blurred by a two-step downscale/upscale and added
 * back with "lighter". No ctx.filter, so it looks the same on iOS Safari, in preview and in export.
 */
export default defineVideoEffect({
  id: "glow",
  name: "Glow",
  category: "Light",
  description: "Soft bloom: bright areas bleed a gentle halo of light; dreamy, warm or magical scenes.",
  params: [
    { key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05, default: 0.6, description: "Opacity of the added light, 0 (off) to 1 (full)." },
    { key: "radius", label: "Radius", type: "number", min: 0.01, max: 0.2, step: 0.01, default: 0.05, description: "Halo size as a fraction of the frame height." },
    { key: "threshold", label: "Threshold", type: "number", min: 0, max: 1, step: 0.25, default: 0.5, description: "Which areas glow, 0 (the whole picture, soft haze) to 1 (only the brightest highlights)." },
    { key: "color", label: "Tint", type: "color", default: "#ffffff", description: "Colour of the light (#rrggbb); white keeps the picture's own colours." },
  ],
  ai: { use: "dream sequences, memories, candle or sunset light, magic moments", avoid: "dark scenes with no highlights (little visible effect)", example: { strength: 0.5, radius: 0.08 } },
  draw: ({ ctx, w, h, params, scratch }) => {
    const strength = Math.max(0, Math.min(1, n(params.strength, 0.6)));
    if (strength <= 0) return;
    const k = Math.max(4, Math.min(64, (n(params.radius, 0.05) * h) / 1.5));
    const aw = Math.max(1, Math.ceil((w * 2) / k)), ah = Math.max(1, Math.ceil((h * 2) / k));
    const bw = Math.max(1, Math.ceil(w / k)), bh = Math.max(1, Math.ceil(h / k));
    const a = scratch(aw, ah, 0), copy = scratch(aw, ah, 1);
    if (!a || !copy) return;
    a.imageSmoothingEnabled = true;
    a.drawImage(ctx.canvas, 0, 0, aw, ah);
    // Highlights: x → x^(2^passes) per channel keeps bright pixels and darkens the rest.
    for (let i = Math.round(Math.max(0, Math.min(1, n(params.threshold, 0.5))) * 4); i > 0; i -= 1) {
      copy.globalCompositeOperation = "copy"; copy.drawImage(a.canvas, 0, 0);
      a.globalCompositeOperation = "multiply"; a.drawImage(copy.canvas, 0, 0); a.globalCompositeOperation = "source-over";
    }
    const tint = s(params.color, "#ffffff");
    if (tint.toLowerCase() !== "#ffffff") { a.globalCompositeOperation = "multiply"; a.fillStyle = tint; a.fillRect(0, 0, aw, ah); a.globalCompositeOperation = "source-over"; }
    // Blur: shrink once more, then grow back in two smooth steps.
    const b = scratch(bw, bh, 2);
    if (!b) return;
    b.imageSmoothingEnabled = true;
    b.drawImage(a.canvas, 0, 0, bw, bh);
    copy.globalCompositeOperation = "copy"; copy.imageSmoothingEnabled = true; copy.drawImage(b.canvas, 0, 0, aw, ah);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = strength;
    ctx.drawImage(copy.canvas, 0, 0, w, h);
  },
});
