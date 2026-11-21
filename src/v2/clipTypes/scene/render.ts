import type { ClipRenderer } from "../../render/clipRenderers";
import { drawKeyed } from "../../render/chromaKey";
import { placeRect } from "../../render/frame";
import { isValidFrame } from "../../render/htmlClip";
import { drawBlackFrame, drawSlate } from "../../render/placeholderSlate";
import { drawWithLook } from "../../render/transitionDraw";
import { stateAt, type SceneDoc } from "../../domain/scene";
import { ticksToSeconds } from "../../domain/time";

/**
 * P74: a scene clip. The editor computes the state at the clip's source time with the pure `stateAt` and sends it to
 * the clip's sandboxed scene page (render/scenePage.ts) as `ctx.inputs.scene`; the page renders it with three.js and
 * returns the frame, which is placed like a code clip's. A document that can't be read shows a slate (black in export).
 */
/** The scene each page last drew (P76). */
const shownDoc = new WeakMap<object, SceneDoc>();
const scene: ClipRenderer = {
  id: "scene",
  frame(h) {
    const { g: ctx, canvas, placement, version, sourceTicks, mix, tfx, paint, media: m } = h;
    const doc = m.sceneDoc(version.media.blobKey);
    if (doc === null) {
      if (ctx && canvas) {
        if (h.offline) drawBlackFrame({ g: ctx, width: canvas.width, height: canvas.height });
        else drawSlate(ctx, canvas.width, canvas.height, "This 3D scene can't be read", "CHECK THE SCENE JSON");
      }
      return;
    }
    h.frame.live.add(placement.id);
    const host = m.sceneHost(placement.id, version.media.blobKey, canvas?.width ?? 1280, canvas?.height ?? 720);
    if (doc === undefined) return; // loading: export waits for it (Player.settleAll)
    const at = Math.round(ticksToSeconds(sourceTicks) * 1000) / 1000;
    const dur = ticksToSeconds(placement.sourceInTicks + placement.durationTicks * (placement.speed ?? 1));
    const state = stateAt(doc, at);
    // P76: a page kept across an edit (same page key) draws the same time again for the edited scene.
    const fresh = shownDoc.has(host) && shownDoc.get(host) !== doc;
    shownDoc.set(host, doc);
    // Scene Phase 1 (#350): export only, world.export.supersample renders the frame larger; it is placed (fitted) like
    // any frame, so drawing it into the export canvas scales it down. Preview stays 1×.
    const ss = h.offline ? doc.world?.export?.supersample : undefined;
    const inputs = typeof ss === "number" && ss > 1 && ss <= 4 ? { scene: state, supersample: Math.floor(ss) } : { scene: state };
    host.request(at, dur, () => Promise.resolve({ data: { inputs } }), fresh);
    const f = host.frame;
    if (ctx && canvas && isValidFrame(f)) {
      const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, h.time);
      h.setBox(r);
      try {
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
export default scene;
