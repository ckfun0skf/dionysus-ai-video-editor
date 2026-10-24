import { defineBlend } from "../define";

/** Contrast blend: mid grey disappears. */
export default defineBlend({
  id: "overlay",
  name: "Overlay",
  category: "Contrast",
  order: 60,
  op: "overlay",
  description: "Adds contrast: mid grey disappears, lighter areas brighten and darker areas darken what is under it. Use for film grain, textures and colour washes on grey.",
  preview: { icon: "◒" },
});
