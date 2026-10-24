import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "shake",
  name: "Shake",
  category: "Motion",
  description: "Handheld camera shake.",
  params: [
    { key: "amount", label: "Amount", description: "Largest offset, as a fraction of the frame size.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.02 },
    { key: "speed", label: "Speed", description: "Shake oscillations over the whole effect range (a count, not per second).", type: "number", min: 2, max: 40, step: 1, default: 16 },
  ],
  type: "vShake",
  frame: (f, p, k) => { const a = n(k.amount, 0.02), w = n(k.speed, 16) * Math.PI * 2 * p; return { ...f, dx: f.dx + a * Math.sin(w), dy: f.dy + a * Math.sin(w * 1.37 + 1), scale: f.scale * (1 + a * 2) }; },
  order: 40,
});
