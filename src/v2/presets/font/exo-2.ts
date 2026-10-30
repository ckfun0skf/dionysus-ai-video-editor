import { defineFont } from "../define";

/** P7-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/exo-2-OFL.txt). */
export default defineFont({
  id: "exo-2",
  label: "Exo 2",
  stack: "'Exo 2', sans-serif",
  description: "Bundled modern techno sans, readable at small sizes: body text, lower thirds.",
  width: 0.56,
  bundled: { family: "Exo 2", files: [{ file: "exo-2-latin-400-normal.woff2", weight: 400 }, { file: "exo-2-latin-700-normal.woff2", weight: 700 }], license: "exo-2-OFL.txt" },
  order: 104,
});
