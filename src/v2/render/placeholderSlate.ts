/**
 * P73 (Phase 1 step 1.8, decision 9 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): the shared slate the host draws for clip
 * states and types no plugin draws. `clipRendererFor` returns PLACEHOLDER_RENDERER for a placeholder of any type before
 * any plugin lookup; the unknown-type fallback (clipTypes/unknown/render.ts) uses the same slate.
 */
import type { ClipDrawHost, ClipRenderer } from "./clipRenderers";
import { clipTypeOf } from "../clipTypes";

/** The P35 slate: dark card, dashed frame, `label` and a small upper-case `state` line ("NOT GENERATED"). */
export function drawSlate(ctx: CanvasRenderingContext2D, w: number, h: number, label: string, state: string): void {
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#111214"; ctx.fillRect(0, 0, w, h);
  const u = Math.max(1, Math.round(Math.min(w, h) / 360));
  ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 2 * u; ctx.setLineDash([8 * u, 6 * u]);
  ctx.strokeRect(w * 0.06, h * 0.08, w * 0.88, h * 0.84);
  ctx.setLineDash([]);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const big = Math.round(Math.min(w / 24, h / 12));
  ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.font = `600 ${big}px system-ui, sans-serif`;
  const max = w * 0.8;
  let text = label;
  while (text.length > 4 && ctx.measureText(text).width > max) text = `${text.slice(0, -2)}…`;
  ctx.fillText(text, w / 2, h / 2 - big * 0.4);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `500 ${Math.round(big * 0.55)}px system-ui, sans-serif`;
  ctx.fillText(state, w / 2, h / 2 + big * 0.75);
  ctx.restore();
}

/** The placeholder slate (shot label, "NOT GENERATED"). */
export const drawPlaceholderSlate = (ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void => drawSlate(ctx, w, h, label, "NOT GENERATED");

/** Export draws a plain black frame for a slate (the export dialog warns first). */
export function drawBlackFrame(h: Pick<ClipDrawHost, "g" | "width" | "height">): void {
  const { g, width, height } = h;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, width, height); g.restore();
}

/**
 * A placeholder of any type: the slate in preview, a black frame in export. Placeholders of a type that is not drawn
 * (audio, effect) draw nothing; the timeline card and the export warning still show them.
 */
export const PLACEHOLDER_RENDERER: ClipRenderer = {
  id: "placeholder",
  draw(h) {
    if (!clipTypeOf(h.placement).caps.visual) return;
    if (h.offline) drawBlackFrame(h);
    else drawPlaceholderSlate(h.g, h.width, h.height, h.placement.placeholder!.label);
  },
};
