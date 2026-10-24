import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "neon",
  name: "Neon",
  category: "Light",
  description: "White rounded letters with a pink neon glow and a gentle pulse.",
  data: { font: "rounded", color: "#ffffff", effect: "neon", effectColor: "#ff3df2", loop: "pulse" },
  order: 30,
});
