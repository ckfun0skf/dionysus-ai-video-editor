import type { ClipRenderer } from "../../render/clipRenderers";
import { drawTextClip } from "../../render/text";
import { withBlend } from "../../render/blend";

/**
 * Text clips (titles, captions with word timings, word-highlight / word-pop, layer styles). Drawn straight onto the
 * output canvas with the clip's blend; text is not routed through scene capture or overlay-scope effects.
 */
const text: ClipRenderer = {
  id: "text",
  draw(h) {
    withBlend(h.g, h.placement.blend, () => h.setBox(drawTextClip(h.g, h.placement, h.width, h.height, h.time, h.mix ?? 1, h.track)));
  },
};
export default text;
