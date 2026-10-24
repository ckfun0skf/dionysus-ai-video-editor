import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "fade-out",
  name: "Fade out",
  category: "Basic",
  description: "Fades the picture out to black at the end of the range.",
  params: [
    { key: "length", label: "Length", description: "fraction of the effect's time range, not seconds; 0.5 fades out over the last half of the range", type: "number", min: 0.05, max: 1, step: 0.05, default: 0.5 },
  ],
  type: "vFadeOut",
  frame: (f, p, k) => ({ ...f, alpha: f.alpha * Math.min(1, (1 - p) / Math.max(0.01, n(k.length, 0.5))) }),
  order: 10,
});
