import { defineTextEffect } from "../define";
import { n, s } from "../_lib/math";

export default defineTextEffect({
  id: "glow",
  name: "Glow",
  category: "Light",
  description: "Soft coloured glow around the letters.",
  params: [
    { key: "blur", label: "Blur", description: "Glow radius as a fraction of the font size.", type: "number", min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  type: "glow",
  frame: (f, _p, k) => ({ ...f, fx: { ...f.fx, glowBlur: n(k.blur, 0.35), color: s(k.color, "#20d5ec") } }),
  order: 0,
});
