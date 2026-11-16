import type { ClipRenderer } from "../../render/clipRenderers";
import { drawKeyed } from "../../render/chromaKey";
import { placeRect } from "../../render/frame";
import { drawMediaClip } from "../../render/mediaClip";
import { drawWithLook } from "../../render/transitionDraw";

/**
 * A video clip (P68, from Player.draw()). In export, clips the WebCodecs decoder handles draw its exact frame; every
 * other case (preview, decoder fallback) uses the pooled <video> slaved to the timeline.
 */
const video: ClipRenderer = {
  id: "video",
  frame(h) {
    const { g: ctx, canvas, placement, mix, tfx, paint, media: m } = h;
    if (m.exportVideo?.handles(placement.id)) {
      h.frame.live.add(placement.id);
      const f = m.exportVideo.frame(placement.id)!;
      if (ctx && canvas) {
        const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, h.time);
        h.setBox(r);
        paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
          g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
          h.blit(g, f.width, f.height, r, (gg) => drawKeyed(gg, f.image, f.width, f.height, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, m.keyOf(placement)));
          g.restore();
        }));
      }
      return;
    }
    drawMediaClip(h);
  },
};
export default video;
