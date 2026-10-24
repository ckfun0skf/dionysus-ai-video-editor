import { defineTextAnimIn } from "../define";
import { fade } from "../_lib/textAnim";

export default defineTextAnimIn({
  id: "fade",
  name: "Fade",
  category: "Basic",
  description: "Fades the text in from transparent.",
  type: "fade",
  frame: fade,
  order: 0,
});
