import { defineFont } from "../define";

/** P7-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/rajdhani-OFL.txt). */
export default defineFont({
  id: "rajdhani",
  label: "Rajdhani",
  stack: "'Rajdhani', sans-serif",
  description: "Bundled squared, condensed tech sans: UI overlays, subtitles with a sci-fi feel.",
  width: 0.48,
  bundled: { family: "Rajdhani", files: [{ file: "rajdhani-latin-400-normal.woff2", weight: 400 }, { file: "rajdhani-latin-700-normal.woff2", weight: 700 }], license: "rajdhani-OFL.txt" },
  order: 103,
});
