import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "outline",
  name: "Outline",
  category: "Bold",
  description: "Yellow Impact letters with a thick black outline; meme or punchy look.",
  data: { font: "impact", color: "#ffe14d", strokeWidth: 0.08, strokeColor: "#000000", effect: "none" },
  order: 20,
});
