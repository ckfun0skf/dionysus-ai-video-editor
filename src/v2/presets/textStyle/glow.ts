import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "glow",
  name: "Glow",
  category: "Light",
  description: "Italic white serif with a cyan glow that floats softly.",
  data: { font: "serif", italic: true, color: "#ffffff", effect: "glow", effectColor: "#20d5ec", loop: "float" },
  order: 60,
});
