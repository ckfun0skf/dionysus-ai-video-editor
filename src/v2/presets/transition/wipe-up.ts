import { defineTransition } from "../define";
import { wipeT } from "../_lib/transitions";

export default defineTransition({
  id: "wipe-up",
  name: "Wipe up",
  category: "Wipe",
  description: "A hard edge sweeps bottom to top, revealing the incoming clip.",
  params: [
    { key: "dirX", label: "Direction X", description: "Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: 0 },
    { key: "dirY", label: "Direction Y", description: "Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: -1 },
  ],
  type: "wipeT",
  frame: wipeT,
  order: 130,
});
