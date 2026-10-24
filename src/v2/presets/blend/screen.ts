import { defineBlend } from "../define";

/** Black disappears; light parts brighten the picture under it. */
export default defineBlend({
  id: "screen",
  name: "Screen",
  category: "Lighten",
  order: 10,
  op: "screen",
  description: "Black disappears and light areas brighten what is under it. Use for light leaks, flares, sparks, dust or glow footage shot on black.",
  preview: { icon: "◐" },
});
