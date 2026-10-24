import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "plain",
  name: "Plain",
  category: "Basic",
  description: "Bold white sans-serif with no decoration; the default.",
  data: { font: "sans", bold: true, color: "#ffffff", strokeWidth: 0, shadow: null, background: null, effect: "none" },
  order: 0,
});
