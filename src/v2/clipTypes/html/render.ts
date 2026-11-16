import type { ClipRenderer } from "../../render/clipRenderers";
import { drawKeyed } from "../../render/chromaKey";
import { placeRect } from "../../render/frame";
import { isValidFrame } from "../../render/htmlClip";
import { drawWithLook } from "../../render/transitionDraw";
import { resolveHtmlParams } from "../../domain/htmlClipPackage";
import { ticksToSeconds } from "../../domain/time";

/**
 * A code (HTML) clip (P68, from Player.draw()): its sandboxed iframe (one per placement, sized to the output) is asked
 * for the frame at the clip's source time with its params and computed inputs; the last valid frame is drawn.
 */
const html: ClipRenderer = {
  id: "html",
  frame(h) {
    const { g: ctx, canvas, placement, version, sourceTicks, mix, tfx, paint, media: m } = h;
    h.frame.live.add(placement.id);
    m.setHtmlOverride(placement.id, placement.htmlParams);
    const host = m.htmlHost(placement.id, version.media.blobKey, canvas?.width ?? 1280, canvas?.height ?? 720);
    const known = m.manifest(version.media.blobKey);
    if (known) host.setParams(resolveHtmlParams(known.params, placement.htmlParams));
    const at = Math.round(ticksToSeconds(sourceTicks) * 1000) / 1000, dur = ticksToSeconds(placement.sourceInTicks + placement.durationTicks * (placement.speed ?? 1));
    const ins = known?.inputs && canvas ? m.inputsFor(placement, known.inputs, canvas) : undefined;
    if (ins) {
      // P38: computed signals only (numbers); a change at the same t (an analysis finished) draws the frame again.
      const sig = JSON.stringify(ins), fresh = sig !== m.inputSig.get(placement.id);
      m.inputSig.set(placement.id, sig);
      host.request(at, dur, () => Promise.resolve({ data: { inputs: ins } }), fresh);
    } else host.request(at, dur);
    const f = host.frame;
    if (ctx && canvas && isValidFrame(f)) {
      const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, h.time);
      h.setBox(r);
      try { // a detached/closed bitmap must not throw out of draw() and stall preview or export
        paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
          g.save();
          try {
            g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            h.blit(g, f.width, f.height, r, (gg) => drawKeyed(gg, f, f.width, f.height, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, m.keyOf(placement)));
          } finally { g.restore(); }
        }));
      } catch { host.issue = "invalid"; }
    }
  },
};
export default html;
