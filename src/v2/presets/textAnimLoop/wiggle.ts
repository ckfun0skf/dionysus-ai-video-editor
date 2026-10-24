import { defineTextAnimLoop } from "../define";
import { n } from "../_lib/math";

export default defineTextAnimLoop({
  id: "wiggle",
  name: "Wiggle",
  category: "Basic",
  description: "Rocks side to side in a loop; playful.",
  params: [
    { key: "period", label: "Period", description: "Length of one cycle in seconds.", type: "number", min: 0.2, max: 4, default: 1 },
    { key: "degrees", label: "Degrees", description: "Largest rotation each way, in degrees.", type: "number", min: 0, max: 30, default: 4 },
  ],
  type: "wiggle",
  frame: (f, p, k) => ({ ...f, rot: f.rot + n(k.degrees, 4) * Math.sin(p * Math.PI * 4) }),
  order: 10,
});
