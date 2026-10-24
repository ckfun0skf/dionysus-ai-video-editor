import { defineBlend } from "../define";

/** A gentler overlay. */
export default defineBlend({
  id: "soft-light",
  name: "Soft light",
  category: "Contrast",
  order: 70,
  op: "soft-light",
  description: "A gentler overlay: mid grey disappears and the picture under it is lightly brightened or darkened. Use for subtle grain, haze or colour tints.",
  preview: { icon: "◓" },
});
