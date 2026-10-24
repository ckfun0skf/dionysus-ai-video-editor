import { defineSticker } from "../define";
import { YEL, svg } from "../_lib/sticker";

export default defineSticker({
  id: "arrow-down",
  name: "Arrow ↓",
  category: "Shapes",
  description: "Yellow arrow pointing down.",
  svg: svg(`<path d="M100 20v130" stroke="${YEL}" stroke-width="18" stroke-linecap="round"/><path d="M55 110l45 50 45-50" fill="none" stroke="${YEL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  order: 10,
});
