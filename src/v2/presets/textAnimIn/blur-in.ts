import { defineTextAnimIn } from "../define";
import { blurIn } from "../_lib/textAnim";

export default defineTextAnimIn({
  id: "blur-in",
  name: "Blur",
  category: "Reveal",
  description: "Fades in from a soft blur to sharp; gentle, cinematic.",
  params: [
    { key: "blur", label: "Blur", description: "Blur radius in pixels at the hidden end.", type: "number", min: 0, max: 30, default: 8 },
  ],
  type: "blurIn",
  frame: blurIn,
  order: 70,
});
