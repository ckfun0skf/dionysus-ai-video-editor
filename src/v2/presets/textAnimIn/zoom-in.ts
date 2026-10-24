import { defineTextAnimIn } from "../define";
import { zoom } from "../_lib/textAnim";

export default defineTextAnimIn({
  id: "zoom-in",
  name: "Zoom",
  category: "Basic",
  description: "Grows from nothing to full size.",
  type: "zoom",
  frame: zoom,
  order: 40,
});
