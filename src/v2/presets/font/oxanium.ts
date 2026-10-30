import { defineFont } from "../define";

/** P8-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/oxanium-OFL.txt, from github.com/google/fonts ofl/). */
export default defineFont({
  id: "oxanium",
  label: "Oxanium",
  stack: "'Oxanium', sans-serif",
  description: "Bundled squared sci-fi display face with clipped corners: HUD readouts, titles.",
  width: 0.58,
  bundled: { family: "Oxanium", files: [{ file: "oxanium-latin-400-normal.woff2", weight: 400 }, { file: "oxanium-latin-700-normal.woff2", weight: 700 }], license: "oxanium-OFL.txt" },
  order: 106,
});
