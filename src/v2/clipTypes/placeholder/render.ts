import type { ClipRenderer } from "../../render/clipRenderers";

/** P35: a dark slate with the shot label in preview; export draws a plain black frame (and warns first). */
const placeholder: ClipRenderer = {
  id: "placeholder",
  draw(h) {
    const { g, width, height } = h;
    if (h.offline) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, width, height); g.restore(); }
    else drawPlaceholderSlate(g, width, height, h.placement.placeholder!.label);
  },
};
export default placeholder;

/** The P35 slate: dark card, dashed frame, the shot label and "NOT GENERATED". */
export function drawPlaceholderSlate(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
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
  ctx.fillText("NOT GENERATED", w / 2, h / 2 + big * 0.75);
  ctx.restore();
}
