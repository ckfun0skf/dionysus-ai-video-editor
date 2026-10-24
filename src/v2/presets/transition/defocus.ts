import { defineTransition } from "../define";
import { blurT } from "../_lib/transitions";

export default defineTransition({
  id: "defocus",
  name: "Defocus",
  category: "Blur",
  description: "The outgoing clip goes out of focus, then the incoming clip pulls into focus.",
  params: [
    { key: "blur", label: "Blur", description: "Peak blur as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.05 },
    { key: "cut", label: "Hard cut", description: "Switch mode: 1 (on) swaps the clips at full blur, 0 (off) dissolves them.", type: "number", min: 0, max: 1, step: 1, default: 1 },
  ],
  type: "blurT",
  frame: blurT,
  order: 190,
});
