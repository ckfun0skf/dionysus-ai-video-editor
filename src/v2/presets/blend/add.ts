import { defineBlend } from "../define";

/** Adds brightness (linear dodge); stronger than screen. */
export default defineBlend({
  id: "add",
  name: "Add",
  category: "Lighten",
  order: 20,
  op: "lighter",
  description: "Adds its brightness to what is under it (linear dodge); black disappears, bright areas burn to white. Stronger than screen: use for fire, sparks and lens flares.",
  preview: { icon: "✚" },
});
