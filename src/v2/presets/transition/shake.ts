import { defineTransition } from "../define";
import { bell, n, hash } from "../_lib/math";

export default defineTransition({
  id: "shake",
  name: "Shake",
  category: "Glitch",
  description: "A camera jolt around a hard cut; impacts and beat drops.",
  params: [
    { key: "amount", label: "Amount", description: "Largest jolt as a fraction of the frame.", type: "number", min: 0, max: 0.15, step: 0.005, default: 0.04 },
  ],
  type: "shake",
  frame: (f, p, k) => { const a = n(k.amount, 0.04) * bell(p), seed = Math.floor(p * 20), jx = (hash(seed) - 0.5) * 2 * a, jy = (hash(seed + 99) - 0.5) * 2 * a;
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { dx: jx, dy: jy, scale: 1 + a * 2 }, tIn: { dx: jx, dy: jy, scale: 1 + a * 2 } }; },
  order: 210,
});
