import { defineBlend } from "../define";

/** Keeps the darker of the two pixels. */
export default defineBlend({
  id: "darken",
  name: "Darken",
  category: "Darken",
  order: 50,
  op: "darken",
  description: "Keeps whichever pixel is darker, the clip or what is under it. Use to drop a white background off dark graphics.",
  preview: { icon: "▽" },
});
