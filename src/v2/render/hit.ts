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
