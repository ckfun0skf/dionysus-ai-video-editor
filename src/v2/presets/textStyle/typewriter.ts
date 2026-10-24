import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "typewriter",
  name: "Typewriter",
  category: "Basic",
  description: "Light grey monospace that types itself on.",
  data: { font: "mono", bold: false, color: "#e8e8e8", animIn: "typewriter", effect: "none" },
  order: 50,
});
