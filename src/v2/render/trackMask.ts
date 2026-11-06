/** P39 traveling mask: clip a tracked video clip's draw to (or around) its tracked box, in preview and export alike. */
import { sampleAt } from "../domain/tracking";
import type { Placement } from "../domain/model";
import type { Placed } from "./frame";

/** The tracked box in the placement's local draw space (origin = clip centre, before rotation), or undefined. */
export function maskRect(p: Placement, srcW: number, srcH: number, r: Placed, sourceTicks: number) {
  const tr = p.motionTrack, s = tr?.mask ? sampleAt(tr, sourceTicks) : undefined;
  if (!s) return undefined;
  const bx = (s.x - s.w / 2) * srcW, by = (s.y - s.h / 2) * srcH;
  return { x: -r.w / 2 + ((bx - r.sx) / r.sw) * r.w, y: -r.h / 2 + ((by - r.sy) / r.sh) * r.h, w: (s.w * srcW * r.w) / r.sw, h: (s.h * srcH * r.h) / r.sh, inside: tr!.mask === "inside" };
}

/** Apply the mask as a clip path on `g` (call after translate/rotate, inside save/restore). */
export function applyTrackMask(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, p: Placement, srcW: number, srcH: number, r: Placed, sourceTicks: number): void {
  const m = maskRect(p, srcW, srcH, r, sourceTicks);
  if (!m) return;
  g.beginPath();
  if (!m.inside) g.rect(-r.w / 2 - 1, -r.h / 2 - 1, r.w + 2, r.h + 2);
  g.rect(m.x, m.y, m.w, m.h);
  g.clip(m.inside ? "nonzero" : "evenodd");
}
