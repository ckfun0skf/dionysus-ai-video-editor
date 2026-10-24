import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "echo",
  name: "Echo",
  category: "Bold",
  description: "White Impact letters with pink echo copies that slide up in.",
  data: { font: "impact", color: "#ffffff", effect: "echo", effectColor: "#ff4d6d", animIn: "slide-up" },
  order: 70,
});
