import { defineFont } from "../define";

/** P7-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/orbitron-OFL.txt). */
export default defineFont({
  id: "orbitron",
  label: "Orbitron",
  stack: "'Orbitron', 'Eurostile', sans-serif",
  description: "Bundled sci-fi display caps, wide and geometric: titles, HUD labels, future dates.",
  width: 0.72,
  bundled: { family: "Orbitron", files: [{ file: "orbitron-latin-400-normal.woff2", weight: 400 }, { file: "orbitron-latin-700-normal.woff2", weight: 700 }], license: "orbitron-OFL.txt" },
  order: 100,
});
