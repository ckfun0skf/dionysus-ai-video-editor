import { defineBlend } from "../define";

/** Default: the clip covers what is under it. */
export default defineBlend({
  id: "normal",
  name: "Normal",
  category: "Basic",
  order: 0,
  op: "source-over",
  description: "Covers the layers under it (default).",
  preview: { icon: "◼" },
});
