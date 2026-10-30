import { defineFont } from "../define";

/** P8-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/chakra-petch-OFL.txt, from github.com/google/fonts ofl/). */
export default defineFont({
  id: "chakra-petch",
  label: "Chakra Petch",
  stack: "'Chakra Petch', sans-serif",
  description: "Bundled angular sans with 45° cut corners: military / game HUD titles, captions.",
  width: 0.56,
  bundled: { family: "Chakra Petch", files: [{ file: "chakra-petch-latin-400-normal.woff2", weight: 400 }, { file: "chakra-petch-latin-700-normal.woff2", weight: 700 }], license: "chakra-petch-OFL.txt" },
  order: 105,
});
