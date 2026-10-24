import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "ken-burns",
  name: "Zoom",
  category: "Motion",
  description: "Slow zoom and pan across the picture (push-in); brings stills to life.",
  params: [
    { key: "zoom", label: "Zoom", description: "Extra zoom reached at the end of the range, as a fraction of full size (0.25 = 25% larger).", type: "number", min: 0, max: 1, step: 0.05, default: 0.25 },
    { key: "pan", label: "Pan", description: "Horizontal drift reached at the end of the range, as a fraction of the frame width (negative = left).", type: "number", min: -0.3, max: 0.3, step: 0.01, default: 0.05 },
  ],
  type: "vZoom",
  frame: (f, p, k) => ({ ...f, scale: f.scale * (1 + n(k.zoom, 0.25) * p), dx: f.dx + n(k.pan, 0.05) * p }),
  order: 30,
});
