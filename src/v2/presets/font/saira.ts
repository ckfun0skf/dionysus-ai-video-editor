import { defineFont } from "../define";

/** P8-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/saira-OFL.txt, from github.com/google/fonts ofl/). */
export default defineFont({
  id: "saira",
  label: "Saira",
  stack: "'Saira', sans-serif",
  description: "Bundled wide squarish tech sans: bold titles, numbers, sports / military look.",
  width: 0.58,
  bundled: { family: "Saira", files: [{ file: "saira-latin-400-normal.woff2", weight: 400 }, { file: "saira-latin-700-normal.woff2", weight: 700 }], license: "saira-OFL.txt" },
  order: 107,
});
