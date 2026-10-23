/** Pure frame resolution: which placements are active at time t, bottom-to-top. */
import { transformOf, type Composition, type Placement, type Track } from "../domain/model";

export interface ActiveLayer { track: Track; placement: Placement; sourceTicks: number }

export function activeAt(comp: Composition, t: number): ActiveLayer[] {
  const out: ActiveLayer[] = [];
  for (let i = comp.tracks.length - 1; i >= 0; i -= 1) {
    const track = comp.tracks[i];
    for (const p of track.placements) {
      if (t >= p.startTicks && t < p.startTicks + p.durationTicks) out.push({ track, placement: p, sourceTicks: p.sourceInTicks + (t - p.startTicks) });
    }
  }
  return out;
}

/** Contain-fit a source rect into a destination. */
export function fitRect(sw: number, sh: number, dw: number, dh: number) {
  const s = Math.min(dw / sw, dh / sh);
  const w = sw * s, h = sh * s;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

/** Where a visual placement lands on the canvas: centre, size, rotation (rad), alpha, and the source crop rect. */
export interface Placed { cx: number; cy: number; w: number; h: number; rot: number; alpha: number; sx: number; sy: number; sw: number; sh: number }
export function placeRect(p: Placement, srcW: number, srcH: number, dw: number, dh: number): Placed {
  const t = transformOf(p);
  const sw = srcW * (1 - t.crop.l - t.crop.r), sh = srcH * (1 - t.crop.t - t.crop.b);
  // Fit the uncropped frame so cropping does not zoom the remaining picture.
  const s = Math.min(dw / srcW, dh / srcH) * t.scale;
  const fullW = srcW * s, fullH = srcH * s;
  const cx = dw / 2 + t.x * dw + (t.crop.l - t.crop.r) / 2 * fullW, cy = dh / 2 + t.y * dh + (t.crop.t - t.crop.b) / 2 * fullH;
  return { cx, cy, w: sw * s, h: sh * s, rot: (t.rotation * Math.PI) / 180, alpha: t.opacity, sx: srcW * t.crop.l, sy: srcH * t.crop.t, sw, sh };
}
