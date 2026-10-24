import { defineTextAnimOut } from "../define";
import { zoom } from "../_lib/textAnim";

export default defineTextAnimOut({
  id: "shrink",
  name: "Shrink",
  category: "Basic",
  description: "Shrinks to nothing.",
  type: "zoom",
  frame: zoom,
  order: 20,
});
