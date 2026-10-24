import { defineTransition } from "../define";
import { bell, n, hash } from "../_lib/math";

export default defineTransition({
  id: "glitch",
  name: "Glitch",
  category: "Glitch",
  description: "Digital glitch: picture bands jump sideways around a hard cut; tech, horror, hype.",
  params: [
    { key: "amount", label: "Amount", description: "Largest band shift as a fraction of the frame width.", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.08 },
  ],
  type: "glitch",
  frame: (f, p, k) => { const a = n(k.amount, 0.08) * bell(p), seed = Math.floor(p * 14), j = (hash(seed) - 0.5) * a * 0.5;
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { glitch: a, seed, dx: j }, tIn: { glitch: a, seed: seed + 7, dx: -j } }; },
  popular: true,
  order: 200,
});
