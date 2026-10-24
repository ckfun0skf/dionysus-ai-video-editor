import { defineTransition } from "../define";
import { push } from "../_lib/transitions";

export default defineTransition({
  id: "whip-left",
  name: "Whip pan",
  category: "Slide",
  description: "A fast push to the left with motion blur, like a whip pan.",
  params: [
    { key: "dirX", label: "Direction X", description: "Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: -1 },
    { key: "dirY", label: "Direction Y", description: "Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: 0 },
    { key: "blur", label: "Motion blur", description: "Blur at the middle of the move, as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.04 },
  ],
  type: "push",
  frame: push,
  popular: true,
  order: 80,
});
