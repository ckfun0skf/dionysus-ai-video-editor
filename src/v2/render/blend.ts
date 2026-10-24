/**
 * Blend modes (V2-SB-128): a clip's `blend` preset id → the canvas composite operation it draws with. The same path
 * runs in preview and export, so both match.
 */
import { getPreset } from "../registry";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Composite operation of a `blend` preset id; undefined for normal, unknown or missing ids. */
export function blendOp(id: string | undefined): GlobalCompositeOperation | undefined {
  const op = getPreset("blend", id?.split("@")[0])?.data?.op;
  return typeof op === "string" && op !== "source-over" ? (op as GlobalCompositeOperation) : undefined;
}

/** Run `draw` with the clip's blend mode set on `ctx`, then restore the previous mode. */
export function withBlend(ctx: Ctx, id: string | undefined, draw: () => void): void {
  const op = blendOp(id);
  if (!op) { draw(); return; }
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = op;
  try { draw(); } finally { ctx.globalCompositeOperation = prev; }
}
