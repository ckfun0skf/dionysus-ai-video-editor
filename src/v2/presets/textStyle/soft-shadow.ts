import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "soft-shadow",
  name: "Soft shadow",
  category: "Basic",
  description: "Bold white sans-serif with a soft drop shadow; stays readable on bright pictures without a box.",
  data: { font: "sans", bold: true, color: "#ffffff", shadow: { color: "#000000", blur: 0.25, x: 0.02, y: 0.04 }, background: null, strokeWidth: 0, effect: "none" },
  order: 75,
});
