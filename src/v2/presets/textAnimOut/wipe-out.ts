import { defineTextAnimOut } from "../define";
import { wipe } from "../_lib/textAnim";

export default defineTextAnimOut({
  id: "wipe-out",
  name: "Wipe",
  category: "Reveal",
  description: "Hides the text right to left behind a moving edge.",
  type: "wipe",
  frame: wipe,
  order: 40,
});
