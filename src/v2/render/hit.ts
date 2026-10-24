import type { Placed } from "./frame";

/** Is canvas point (x, y) inside a placed box, honouring its rotation? */
export function inBox(b: Placed, x: number, y: number): boolean {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const dx = x - b.cx, dy = y - b.cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

/** Topmost element under a canvas point. `boxes` is in draw order (bottom first). */
export function hitTest(boxes: Map<string, Placed>, x: number, y: number): string | undefined {
  const list = [...boxes.entries()];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i][1].alpha > 0.01 && inBox(list[i][1], x, y)) return list[i][0];
  return undefined;
}

/** Distance (canvas px) from a point to a placed box, 0 inside; rotation-aware. */
export function boxDistance(b: Pick<Placed, "cx" | "cy" | "w" | "h" | "rot">, x: number, y: number): number {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const dx = x - b.cx, dy = y - b.cy;
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - b.w / 2), Math.max(0, Math.abs(ly) - b.h / 2));
}

export interface HitOpts {
  /** Extra reach around each element (canvas px), so near-misses still count. */
  tol?: number;
  /** Minimum hit-box side (canvas px), centred on the element, for tiny elements. */
  min?: number;
  /** Elements to leave out (e.g. the current selection). */
  skip?: (id: string, b: Placed) => boolean;
}

/**
 * V2-113: every element under a point, best first. An element counts when the point is inside its
 * box grown to at least `min`, or within `tol` of its real box. Smallest area wins (tiny text over
 * a big video stays grabbable), then topmost.
 */
export function hitCandidates(boxes: Map<string, Placed>, x: number, y: number, { tol = 0, min = 0, skip }: HitOpts = {}): string[] {
  const out: { id: string; area: number; z: number }[] = [];
  let z = 0;
  for (const [id, b] of boxes) {
    z += 1;
    if (b.alpha <= 0.01 || skip?.(id, b)) continue;
    const grown = { ...b, w: Math.max(b.w, min), h: Math.max(b.h, min) };
    if (boxDistance(grown, x, y) === 0 || boxDistance(b, x, y) <= tol) out.push({ id, area: b.w * b.h, z });
  }
  out.sort((a, b) => a.area - b.area || b.z - a.z);
  return out.map((o) => o.id);
}

/**
 * Tap selection: best candidate, or — on a repeated tap at the same spot (`cycle`) — the one after
 * `current`, so overlapping elements can all be reached.
 */
export function pickAt(boxes: Map<string, Placed>, x: number, y: number, opts: HitOpts & { current?: string; cycle?: boolean } = {}): string | undefined {
  const list = hitCandidates(boxes, x, y, opts);
  if (!list.length) return undefined;
  const i = opts.cycle && opts.current ? list.indexOf(opts.current) : -1;
  return i >= 0 ? list[(i + 1) % list.length] : list[0];
}

/** Does this box fill most of the frame (a background clip rather than an overlay)? */
export const isBackdrop = (b: Placed, W: number, H: number) => b.w * b.h >= 0.8 * W * H;
