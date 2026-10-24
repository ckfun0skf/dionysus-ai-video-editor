import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "bw",
  name: "B&W",
  category: "Color",
  description: "Black-and-white (desaturated) picture.",
  params: [
    { key: "amount", label: "Amount", description: "Desaturation, 0 (full colour) to 1 (black and white).", type: "number", min: 0, max: 1, step: 0.05, default: 1 },
  ],
  type: "vGray",
  frame: (f, _p, k) => ({ ...f, gray: Math.min(1, (f.gray ?? 0) + n(k.amount, 1)) }),
  order: 60,
});
