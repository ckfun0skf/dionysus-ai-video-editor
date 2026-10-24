import { defineBlend } from "../define";

/** Keeps the lighter of the two pixels. */
export default defineBlend({
  id: "lighten",
  name: "Lighten",
  category: "Lighten",
  order: 30,
  op: "lighten",
  description: "Keeps whichever pixel is lighter, the clip or what is under it. Use to drop a dark background off light graphics.",
  preview: { icon: "△" },
});
