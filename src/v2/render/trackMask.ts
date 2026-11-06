/** P39/P40 traveling masks: clip a tracked video clip's draw to (or around) each masked tracker's box, preview and export alike. */
import { sampleAt, tracksOf, type NamedTrack } from "../domain/tracking";
import type { Placement } from "../domain/model";
import type { Placed } from "./frame";

/**
 * One tracker's box in the placement's local draw space (origin = clip centre, before rotation). `hide`: an "inside"
 * mask whose feature is lost or out of range (nothing to show). Undefined: no mask applies this frame.
 */
export function maskRect(tr: NamedTrack, srcW: number, srcH: number, r: Placed, sourceTicks: number) {
  if (!tr.mask) return undefined;
  const s = sampleAt(tr, sourceTicks);
  if (!s || s.lost) return tr.mask === "inside" ? { hide: true as const } : undefined;
  const bx = (s.x - s.w / 2) * srcW, by = (s.y - s.h / 2) * srcH;
  return { x: -r.w / 2 + ((bx - r.sx) / r.sw) * r.w, y: -r.h / 2 + ((by - r.sy) / r.sh) * r.h, w: (s.w * srcW * r.w) / r.sw, h: (s.h * srcH * r.h) / r.sh, inside: tr.mask === "inside" };
}

/** Apply every masked tracker as a clip path on `g` (call after translate/rotate, inside save/restore). */
export function applyTrackMask(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, p: Placement, srcW: number, srcH: number, r: Placed, sourceTicks: number): void {
  for (const tr of tracksOf(p)) {
    const m = maskRect(tr, srcW, srcH, r, sourceTicks);
    if (!m) continue;
    g.beginPath();
    if ("hide" in m) { g.rect(0, 0, 0, 0); g.clip(); continue; }
    if (!m.inside) g.rect(-r.w / 2 - 1, -r.h / 2 - 1, r.w + 2, r.h + 2);
    g.rect(m.x, m.y, m.w, m.h);
    g.clip(m.inside ? "nonzero" : "evenodd");
  }
}
