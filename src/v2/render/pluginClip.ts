import type { ClipRenderer } from "./clipRenderers";
import { drawKeyed } from "./chromaKey";
import { placeRect } from "./frame";
import { isValidFrame } from "./htmlClip";
import { drawBlackFrame, drawSlate } from "./placeholderSlate";
import { drawWithLook } from "./transitionDraw";
import { pluginMetaOf, pluginParamsOf } from "../clipTypes";
import { ticksToSeconds } from "../domain/time";

/**
 * P85 (Phase 3 step 3.3): a clip of an enabled plugin (registered and trusted for this project on this device). Its
 * sandboxed worker (render/pluginHost.ts, through the Player's `host.plugins`) is asked for the frame at the clip's
 * local time with its params; the last valid frame is drawn like an HTML clip's (placement, mask, crop, blend,
 * transitions, chroma key). A plugin that was stopped draws the slate "Plugin “Name” stopped" in preview and a black
 * frame in export (the export dialog lists those frames).
 */
export const PLUGIN_RENDERER: ClipRenderer = {
  id: "plugin",
  draw(h) {
    if (h.track.kind === "audio") return;
    const { g, placement, mix, tfx, paint } = h;
    const meta = pluginMetaOf(placement.clipType);
    const host = meta && h.plugins?.host(placement.id, placement.clipType, h.width, h.height);
    if (!meta || !host) return;
    const at = Math.round(ticksToSeconds(h.sourceTicks) * 1000) / 1000;
    const dur = ticksToSeconds(placement.sourceInTicks + placement.durationTicks * (placement.speed ?? 1));
    host.request(at, dur, pluginParamsOf(meta, placement));
    if (host.stopped) {
      if (h.offline) drawBlackFrame(h);
      else drawSlate(g, h.width, h.height, `Plugin “${meta.name}” stopped`, "IT HUNG OR FAILED");
      return;
    }
    const f = host.frame;
    if (!isValidFrame(f)) return;
    const r = placeRect(placement, f.width, f.height, h.width, h.height, h.time);
    h.setBox(r);
    try { // a detached or closed bitmap must not throw out of draw() and stall preview or export
      paint(placement.blend, (dc) => drawWithLook(dc, h.width, h.height, tfx, (gg) => {
        gg.save();
        try {
          gg.globalAlpha = r.alpha * (mix ?? 1); gg.translate(r.cx, r.cy); gg.rotate(r.rot);
          h.blit(gg, f.width, f.height, r, (x) => drawKeyed(x, f, f.width, f.height, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, h.plugins!.keyOf(placement)));
        } finally { gg.restore(); }
      }));
    } catch { host.issue = "invalid"; }
  },
};
