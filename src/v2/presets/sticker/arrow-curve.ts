import { defineSticker } from "../define";
import { RED, svg } from "../_lib/sticker";

export default defineSticker({
  id: "arrow-curve",
  name: "Curved arrow",
  category: "Shapes",
  description: "Red curved arrow for call-outs.",
  svg: svg(`<path d="M30 160C40 70 110 40 160 60" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round"/><path d="M125 35l40 25-28 38" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`),
  order: 20,
});
