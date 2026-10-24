import { defineTextAnimIn } from "../define";
import { wipe } from "../_lib/textAnim";

export default defineTextAnimIn({
  id: "wipe",
  name: "Wipe",
  category: "Reveal",
  description: "Reveals the text left to right behind a moving edge.",
  type: "wipe",
  frame: wipe,
  order: 60,
});
