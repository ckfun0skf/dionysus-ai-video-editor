import { defineSticker } from "../define";
import { RED, svg } from "../_lib/sticker";

export default defineSticker({
  id: "circle",
  name: "Circle",
  category: "Shapes",
  description: "Red circle to ring a detail.",
  svg: svg(`<circle cx="100" cy="100" r="78" fill="none" stroke="${RED}" stroke-width="14"/>`),
  order: 30,
});
