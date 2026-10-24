import { defineTransition } from "../define";
import { blurT } from "../_lib/transitions";

export default defineTransition({
  id: "blur-dissolve",
  name: "Blur dissolve",
  category: "Blur",
  description: "Both clips soften into a blur while they cross-dissolve; smooth and gentle.",
  params: [
    { key: "blur", label: "Blur", description: "Peak blur as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.03 },
  ],
  type: "blurT",
  frame: blurT,
  popular: true,
  order: 180,
});
