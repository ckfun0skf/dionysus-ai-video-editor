import { defineTransition } from "../define";
import { bell, n, s } from "../_lib/math";

export default defineTransition({
  id: "flash",
  name: "Flash",
  category: "Basic",
  description: "A quick bright flash hides the cut; punchy, for beats and reveals.",
  params: [
    { key: "color", label: "Colour", description: "Flash colour (#rrggbb).", type: "color", default: "#ffffff" },
    { key: "strength", label: "Strength", description: "Opacity of the flash at its peak, 0 (none) to 1 (full).", type: "number", min: 0, max: 1, step: 0.05, default: 0.9 },
  ],
  type: "flash",
  frame: (f, p, k) => ({ ...f, mixOut: 1, mixIn: p < 0.5 ? 0 : 1, tIn: { tint: s(k.color, "#ffffff"), tintAlpha: n(k.strength, 0.9) * bell(p) }, tOut: { tint: s(k.color, "#ffffff"), tintAlpha: n(k.strength, 0.9) * bell(p) } }),
  order: 30,
});
