import type { ClipRenderer } from "../../render/clipRenderers";
import { placeRect } from "../../render/frame";
import { drawWithLook } from "../../render/transitionDraw";

/** P36: a solid colour filling the frame, placed, faded, masked and transitioned like a photo of the frame's size. */
const blank: ClipRenderer = {
  id: "blank",
  draw(h) {
    const { width, height, placement } = h;
    const r = placeRect(placement, width, height, width, height, h.time);
    h.setBox(r);
    h.paint(placement.blend, (dc) => drawWithLook(dc, width, height, h.tfx, (g) => {
      g.save(); g.globalAlpha = r.alpha * (h.mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
      h.blit(g, width, height, r, (gg) => { gg.fillStyle = placement.blank!.color; gg.fillRect(-r.w / 2, -r.h / 2, r.w, r.h); });
      g.restore();
    }));
  },
};
export default blank;
