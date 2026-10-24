import { defineTransition } from "../define";
import { easeIO, bell, n } from "../_lib/math";

export default defineTransition({
  id: "spin",
  name: "Spin",
  category: "Zoom",
  description: "The outgoing clip spins away and the incoming clip spins into place; playful.",
  params: [
    { key: "degrees", label: "Turn", description: "Degrees each clip turns.", type: "number", min: 30, max: 720, step: 15, default: 180 },
  ],
  type: "spin",
  frame: (f, p, k) => { const e = easeIO(p), d = n(k.degrees, 180);
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { rot: d * e, scale: 1 - 0.7 * bell(p), blur: 0.01 * bell(p) }, tIn: { rot: -d * (1 - e), scale: 1 - 0.7 * bell(p), blur: 0.01 * bell(p) } }; },
  order: 170,
});
