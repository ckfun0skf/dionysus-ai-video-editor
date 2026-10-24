import { defineTransition } from "../define";
import { easeIO, n } from "../_lib/math";

export default defineTransition({
  id: "slide-over",
  name: "Slide over",
  category: "Slide",
  description: "The incoming clip slides in from the right over the outgoing clip, which darkens.",
  params: [
    { key: "dirX", label: "Direction X", description: "Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: -1 },
    { key: "dirY", label: "Direction Y", description: "Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: 0 },
  ],
  type: "cover",
  frame: (f, p, k) => { const e = easeIO(p), x = n(k.dirX, -1), y = n(k.dirY, 0);
    return { ...f, mixOut: 1, mixIn: 1, tOut: { tint: "#000000", tintAlpha: 0.5 * e }, tIn: { dx: -x * (1 - e), dy: -y * (1 - e) } }; },
  order: 90,
});
