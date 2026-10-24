import { defineSticker } from "../define";
import { YEL, svg } from "../_lib/sticker";

export default defineSticker({
  id: "burst",
  name: "Highlight",
  category: "Shapes",
  description: "Yellow highlight rays around a point.",
  svg: svg(`<g stroke="${YEL}" stroke-width="12" stroke-linecap="round"><path d="M100 20v35M100 145v35M20 100h35M145 100h35M43 43l25 25M132 132l25 25M157 43l-25 25M68 132l-25 25"/></g>`),
  order: 50,
});
