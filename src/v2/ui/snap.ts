/** Smart snapping for preview transforms. Pure math in canvas pixels; guides are canvas coordinates. */
export interface SnapBox { cx: number; cy: number; w: number; h: number; rot: number }
export interface Guides { x?: number; y?: number }

/** Axis-aligned half extents of a rotated box. */
export function halfExtents(b: SnapBox) {
  const c = Math.abs(Math.cos(b.rot)), s = Math.abs(Math.sin(b.rot));
  return { hx: (b.w * c + b.h * s) / 2, hy: (b.w * s + b.h * c) / 2 };
}

/** Canvas edges + centre lines, and the edges + centres of other elements. */
export function snapTargets(W: number, H: number, others: SnapBox[]) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const o of others) { const { hx, hy } = halfExtents(o); xs.push(o.cx - hx, o.cx, o.cx + hx); ys.push(o.cy - hy, o.cy, o.cy + hy); }
  return { xs, ys };
}

function best(refs: number[], targets: number[], thr: number) {
  let out: { d: number; at: number } | undefined;
  for (const r of refs) for (const t of targets) { const d = t - r; if (Math.abs(d) <= thr && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: t }; }
  return out;
}

/** Snap a moved box: its left/centre/right and top/middle/bottom to the nearest target within `thr`. */
export function snapMove(b: SnapBox, t: { xs: number[]; ys: number[] }, thr: number): { dx: number; dy: number; guides: Guides } {
  const { hx, hy } = halfExtents(b);
  const sx = best([b.cx - hx, b.cx, b.cx + hx], t.xs, thr), sy = best([b.cy - hy, b.cy, b.cy + hy], t.ys, thr);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, guides: { x: sx?.at, y: sy?.at } };
}

/** Snap a scale (about the centre) so an edge lands on a target. Returns the corrected scale factor multiplier. */
export function snapScale(b: SnapBox, t: { xs: number[]; ys: number[] }, thr: number): { k: number; guides: Guides } {
  const { hx, hy } = halfExtents(b);
  let out: { k: number; err: number; g: Guides } | undefined;
  const tryAxis = (c: number, h: number, targets: number[], axis: "x" | "y") => {
    if (h <= 0) return;
    for (const tg of targets) for (const sign of [-1, 1]) {
      const err = Math.abs(c + sign * h - tg);
      const k = (sign * (tg - c)) / h;
      if (err <= thr && k > 0 && (!out || err < out.err)) out = { k, err, g: { [axis]: tg } };
    }
  };
  tryAxis(b.cx, hx, t.xs, "x"); tryAxis(b.cy, hy, t.ys, "y");
  return out ? { k: out.k, guides: out.g } : { k: 1, guides: {} };
}

/** Snap rotation (degrees) to 0/90/180/270 within `thr` degrees. */
export function snapRotation(deg: number, thr = 4): { deg: number; snapped: boolean } {
  for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(deg - a) <= thr) return { deg: a === -180 ? 180 : a, snapped: true };
  return { deg, snapped: false };
}

/** Screen-pixel threshold → canvas pixels. */
export const SNAP_PX = 6;
