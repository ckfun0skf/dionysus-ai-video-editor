import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "pop",
  name: "Pop title",
  category: "Bold",
  description: "Large white Impact title with a hard drop shadow that pops in and shrinks out.",
  data: { font: "impact", color: "#ffffff", shadow: { color: "#000000", blur: 0, x: 0.05, y: 0.05 }, animIn: "pop", animOut: "shrink", size: 0.14 },
  order: 40,
});
