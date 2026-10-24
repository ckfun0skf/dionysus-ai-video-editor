import { defineTextStyle } from "../define";

export default defineTextStyle({
  id: "caption",
  name: "Caption",
  category: "Basic",
  description: "Smaller bold white text on a translucent black box; subtitles and lower thirds.",
  data: { font: "sans", bold: true, color: "#ffffff", background: { color: "#000000", opacity: 0.6 }, effect: "none", size: 0.06 },
  order: 10,
});
