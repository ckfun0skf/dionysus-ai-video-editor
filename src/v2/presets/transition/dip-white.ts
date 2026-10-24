import { defineTransition } from "../define";
import { s } from "../_lib/math";

export default defineTransition({
  id: "dip-white",
  name: "Dip to white",
  category: "Basic",
  description: "Fades the outgoing clip to white, then out of white into the incoming clip; dreamy or memory scenes.",
  params: [
    { key: "color", label: "Colour", description: "Colour the picture dips through (#rrggbb).", type: "color", default: "#ffffff" },
  ],
  type: "dipColor",
  frame: (f, p, k) => { const c = s(k.color, "#ffffff"); return p < 0.5
    ? { ...f, mixOut: 1, mixIn: 0, tOut: { tint: c, tintAlpha: p * 2 } }
    : { ...f, mixOut: 0, mixIn: 1, tIn: { tint: c, tintAlpha: 2 - p * 2 } }; },
  popular: true,
  order: 20,
});
