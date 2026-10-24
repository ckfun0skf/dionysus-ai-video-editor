import { defineTextAnimOut } from "../define";
import { blurIn } from "../_lib/textAnim";

export default defineTextAnimOut({
  id: "blur-out",
  name: "Blur",
  category: "Reveal",
  description: "Blurs and fades away.",
  params: [
    { key: "blur", label: "Blur", description: "Blur radius in pixels at the hidden end.", type: "number", min: 0, max: 30, default: 8 },
  ],
  type: "blurIn",
  frame: blurIn,
  order: 30,
});
