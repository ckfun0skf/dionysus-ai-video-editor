import { defineBlend } from "../define";

/** White disappears; dark parts darken the picture under it. */
export default defineBlend({
  id: "multiply",
  name: "Multiply",
  category: "Darken",
  order: 40,
  op: "multiply",
  description: "White disappears and dark areas darken what is under it. Use for paper, ink, scribbles, shadows or vignettes on white.",
  preview: { icon: "◑" },
});
