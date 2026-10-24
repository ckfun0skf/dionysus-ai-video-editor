import { defineTextEffect } from "../define";
import { n, s } from "../_lib/math";

export default defineTextEffect({
  id: "neon",
  name: "Neon",
  category: "Light",
  description: "Bright neon tube look with a strong coloured glow.",
  params: [
    { key: "blur", label: "Blur", description: "Glow radius as a fraction of the font size.", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  type: "neon",
  frame: (f, _p, k) => ({ ...f, fx: { ...f.fx, neon: true, glowBlur: n(k.blur, 0.6), color: s(k.color, "#20d5ec") } }),
  order: 10,
});
