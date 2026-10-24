import { defineTextAnimLoop } from "../define";

export default defineTextAnimLoop({
  id: "blink",
  name: "Blink",
  category: "Basic",
  description: "Blinks on and off in a loop.",
  params: [
    { key: "period", label: "Period", description: "Length of one cycle in seconds.", type: "number", min: 0.2, max: 4, default: 1 },
  ],
  type: "blink",
  frame: (f, p) => ({ ...f, alpha: f.alpha * (0.55 + 0.45 * Math.cos(p * Math.PI * 2)) }),
  order: 30,
});
