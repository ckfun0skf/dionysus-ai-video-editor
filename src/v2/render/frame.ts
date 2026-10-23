/** Pure frame resolution: which placements are active at time t, bottom-to-top. */
import type { Composition, Placement, Track } from "../domain/model";

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
