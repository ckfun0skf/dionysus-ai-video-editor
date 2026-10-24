import { defineTransition } from "../define";
import { wipeT } from "../_lib/transitions";

export default defineTransition({
  id: "wipe-right",
  name: "Wipe right",
  category: "Wipe",
  description: "A hard edge sweeps left to right, revealing the incoming clip.",
  params: [
    { key: "dirX", label: "Direction X", description: "Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: 1 },
    { key: "dirY", label: "Direction Y", description: "Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none).", type: "number", min: -1, max: 1, step: 1, default: 0 },
  ],
  type: "wipeT",
  frame: wipeT,
  popular: true,
  order: 100,
});
