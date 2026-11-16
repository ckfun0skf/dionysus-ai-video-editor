import type { ClipRenderer } from "../../render/clipRenderers";
import { drawBlackFrame, drawSlate } from "../../render/placeholderSlate";

/**
 * P73 (§6 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): a `clipType` this build does not register draws the shared slate
 * naming the missing type in preview and a black frame in export (the export dialog warns first). Its data is kept.
 */
const unknown: ClipRenderer = {
  id: "unknown",
  draw(h) {
    if (h.track.kind === "audio") return; // an unknown clip on an audio track has nothing to draw over the picture
    if (h.offline) drawBlackFrame(h);
    else drawSlate(h.g, h.width, h.height, `Unknown clip type “${h.placement.clipType}”`, "NEEDS A NEWER VERSION");
  },
};
export default unknown;
