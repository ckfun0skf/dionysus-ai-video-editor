import { defineFont } from "../define";

/** P7-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/audiowide-OFL.txt). */
export default defineFont({
  id: "audiowide",
  label: "Audiowide",
  stack: "'Audiowide', sans-serif",
  description: "Bundled rounded retro-futuristic display face: logos, racing or arcade titles.",
  width: 0.7,
  bundled: { family: "Audiowide", files: [{ file: "audiowide-latin-400-normal.woff2", weight: 400 }], license: "audiowide-OFL.txt" },
  order: 102,
});
