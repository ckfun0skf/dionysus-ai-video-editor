import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "cinematic",
  name: "Cinematic",
  category: "Film",
  description: "Warm off-white serif, widely letter-spaced, with a soft shadow; film titles and chapter cards.",
  data: { font: "serif", bold: false, color: "#f5f1e8", letterSpacing: 0.3, shadow: { color: "#000000", blur: 0.3, x: 0, y: 0.02 }, background: null, strokeWidth: 0, effect: "none", size: 0.07 },
  order: 80,
});
