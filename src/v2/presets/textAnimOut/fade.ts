import { defineTextAnimOut } from "../define";
import { fade } from "../_lib/textAnim";

export default defineTextAnimOut({
  id: "fade",
  name: "Fade",
  category: "Basic",
  description: "Fades the text out to transparent.",
  type: "fade",
  frame: fade,
  order: 0,
});
