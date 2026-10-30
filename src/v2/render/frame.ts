/** Pure frame resolution: which placements are active at time t, bottom-to-top. */
import { trackTransitions } from "../domain/transitions";
import type { TransLayer } from "../registry";
import { sourceAt, transformAt, transformOf, type Composition, type Placement, type Track } from "../domain/model";

/** `mix` multiplies the layer's opacity (transitions); `tfx` is the transition's extra look for this side (V2-TL-TRANS). */
export interface ActiveLayer { track: Track; placement: Placement; sourceTicks: number; mix?: number; tfx?: TransLayer }

export function activeAt(comp: Composition, t: number): ActiveLayer[] {
  const out: ActiveLayer[] = [];
  for (let i = comp.tracks.length - 1; i >= 0; i -= 1) {
    const track = comp.tracks[i];
    if (track.hidden) continue; // hidden layers are skipped in preview and export alike
    const tr = trackTransitions(track).find((x) => t >= x.from && t < x.to);
    if (tr) {
      // Outgoing below, incoming on top; each holds its edge frame outside its own span.
      const a = (t - tr.from) / (tr.to - tr.from), m = tr.kind.mix(a), look = tr.kind.look(a);
      out.push({ track, placement: tr.prev, sourceTicks: sourceAt(tr.prev, Math.min(t, tr.prev.startTicks + tr.prev.durationTicks - 1)), mix: m.out, ...(look.out ? { tfx: look.out } : {}) });
      out.push({ track, placement: tr.next, sourceTicks: sourceAt(tr.next, t), mix: m.in, ...(look.in ? { tfx: look.in } : {}) });
    }
    for (const p of track.placements) {
      if (tr && (p === tr.prev || p === tr.next)) continue;
      if (t >= p.startTicks && t < p.startTicks + p.durationTicks) out.push({ track, placement: p, sourceTicks: sourceAt(p, t) });
    }
  }
  return out;
}

/**
 * P1-SHORT-AUDIO: audio and video clips that start within `aheadTicks` after `t` (on visible, unmuted-or-not tracks).
 * The player loads their media before they start, so a clip shorter than the media load time still plays.
 */
export function upcomingMedia(comp: Composition, t: number, aheadTicks: number): { track: Track; placement: Placement }[] {
  const out: { track: Track; placement: Placement }[] = [];
  for (const track of comp.tracks) {
    if (track.hidden) continue;
    for (const p of track.placements) if ((p.clipType === "audio" || p.clipType === "video") && p.startTicks > t && p.startTicks <= t + aheadTicks) out.push({ track, placement: p });
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
export function placeRect(p: Placement, srcW: number, srcH: number, dw: number, dh: number, at?: number): Placed {
  const t = at === undefined ? transformOf(p) : transformAt(p, at);
  const sw = srcW * (1 - t.crop.l - t.crop.r), sh = srcH * (1 - t.crop.t - t.crop.b);
  // Fit the uncropped frame so cropping does not zoom the remaining picture.
  const s = Math.min(dw / srcW, dh / srcH) * t.scale;
  const fullW = srcW * s, fullH = srcH * s;
  const cx = dw / 2 + t.x * dw + (t.crop.l - t.crop.r) / 2 * fullW, cy = dh / 2 + t.y * dh + (t.crop.t - t.crop.b) / 2 * fullH;
  return { cx, cy, w: sw * s, h: sh * s, rot: (t.rotation * Math.PI) / 180, alpha: t.opacity, sx: srcW * t.crop.l, sy: srcH * t.crop.t, sw, sh };
}
