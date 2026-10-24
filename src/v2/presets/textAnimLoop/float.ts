import { defineTextAnimLoop } from "../define";
import { wave, n } from "../_lib/math";

export default defineTextAnimLoop({
  id: "float",
  name: "Float",
  category: "Basic",
  description: "Bobs softly up and down in a loop.",
  params: [
    { key: "period", label: "Period", description: "Length of one cycle in seconds.", type: "number", min: 0.2, max: 4, default: 1 },
    { key: "amount", label: "Amount", description: "Largest vertical offset, as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.015 },
  ],
  type: "float",
  frame: (f, p, k) => ({ ...f, dy: f.dy + n(k.amount, 0.015) * wave(p) }),
  order: 20,
});
