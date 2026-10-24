import { defineSticker } from "../define";
import { RED, svg } from "../_lib/sticker";

export default defineSticker({
  id: "arrow-right",
  name: "Arrow →",
  category: "Shapes",
  description: "Red arrow pointing right.",
  svg: svg(`<path d="M20 100h130" stroke="${RED}" stroke-width="18" stroke-linecap="round"/><path d="M110 55l50 45-50 45" fill="none" stroke="${RED}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  order: 0,
});
