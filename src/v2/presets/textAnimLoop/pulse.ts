import { defineTextAnimLoop } from "../define";
import { wave, n } from "../_lib/math";

export default defineTextAnimLoop({
  id: "pulse",
  name: "Pulse",
  category: "Basic",
  description: "Gently grows and shrinks in a loop.",
  params: [
    { key: "period", label: "Period", description: "Length of one cycle in seconds.", type: "number", min: 0.2, max: 4, default: 1 },
    { key: "amount", label: "Amount", description: "Size change at the peak, as a fraction of full size (0.06 = 6%).", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 },
  ],
  type: "pulse",
  frame: (f, p, k) => ({ ...f, scale: f.scale * (1 + n(k.amount, 0.06) * wave(p)) }),
  order: 0,
});
