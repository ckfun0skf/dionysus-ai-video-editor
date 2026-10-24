import { defineTextAnimIn } from "../define";
import { slide } from "../_lib/textAnim";

export default defineTextAnimIn({
  id: "slide-up",
  name: "Slide up",
  category: "Basic",
  description: "Fades in while sliding up into place from slightly below.",
  params: [
    { key: "distance", label: "Distance", description: "How far the text travels, as a fraction of the frame size (0.1 = 10%).", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 },
    { key: "dirX", label: "X", description: "Side the text is offset to while hidden (it slides from / to there): -1 left, 1 right, 0 none.", type: "number", min: -1, max: 1, default: 0 },
    { key: "dirY", label: "Y", description: "Side the text is offset to while hidden: -1 above, 1 below, 0 none.", type: "number", min: -1, max: 1, default: 1 },
  ],
  type: "slide",
  frame: slide,
  order: 10,
});
