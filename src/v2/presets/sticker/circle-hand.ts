import { defineSticker } from "../define";
import { YEL, svg } from "../_lib/sticker";

export default defineSticker({
  id: "circle-hand",
  name: "Hand-drawn circle",
  category: "Shapes",
  description: "Yellow hand-drawn circle.",
  svg: svg(`<path d="M150 45C110 15 35 35 28 100s70 85 120 62 40-95-15-112" fill="none" stroke="${YEL}" stroke-width="12" stroke-linecap="round"/>`),
  order: 40,
});
