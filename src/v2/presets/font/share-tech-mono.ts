import { defineFont } from "../define";

/** P7-FONTS: bundled, SIL Open Font License 1.1 (public/fonts/share-tech-mono-OFL.txt). */
export default defineFont({
  id: "share-tech-mono",
  label: "Share Tech Mono",
  stack: "'Share Tech Mono', ui-monospace, monospace",
  description: "Bundled sci-fi monospace: terminals, typewriter captions, location/date stamps.",
  width: 0.6,
  bundled: { family: "Share Tech Mono", files: [{ file: "share-tech-mono-latin-400-normal.woff2", weight: 400 }], license: "share-tech-mono-OFL.txt" },
  order: 101,
});
