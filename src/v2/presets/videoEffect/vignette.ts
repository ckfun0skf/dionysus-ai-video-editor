import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "vignette",
  name: "Vignette",
  category: "Lens",
  description: "Darkens the frame edges to focus the centre.",
  params: [
    { key: "amount", label: "Amount", description: "Edge darkness, 0 (none) to 1 (black corners).", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  type: "vVignette",
  frame: (f, _p, k) => ({ ...f, vignette: Math.min(1, Math.max(f.vignette ?? 0, n(k.amount, 0.6))) }),
  order: 50,
});
