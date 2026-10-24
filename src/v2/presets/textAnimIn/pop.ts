import { defineTextAnimIn } from "../define";
import { ease, n } from "../_lib/math";

export default defineTextAnimIn({
  id: "pop",
  name: "Pop",
  category: "Bounce",
  description: "Scales up from small with a springy overshoot; lively titles and labels.",
  params: [
    { key: "overshoot", label: "Overshoot", description: "Extra size at the middle of the pop, as a fraction of full size (0.12 = 12% larger).", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.12 },
  ],
  type: "pop",
  frame: (f, p, k) => ({ ...f, scale: f.scale * (0.4 + 0.6 * ease(p) + Math.sin(p * Math.PI) * n(k.overshoot, 0.12)), alpha: f.alpha * Math.min(1, p * 3) }),
  order: 30,
});
