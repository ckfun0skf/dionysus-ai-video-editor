import { defineTextAnimIn } from "../define";
import { n } from "../_lib/math";

export default defineTextAnimIn({
  id: "word-highlight",
  name: "Word highlight",
  category: "Captions",
  description: "Keeps the whole caption visible and emphasises each word in time (pending dim, current colour, spoken normal). Needs word timings on the clip (Even split or Align with AI).",
  params: [
    { key: "pendingOpacity", label: "Pending opacity", description: "Opacity of words not yet spoken (0–1). Spoken words use the clip colour at full opacity.", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.4 },
    { key: "highlightColor", label: "Highlight colour", description: "Fill colour of the word that is current (CSS #rrggbb).", type: "color", default: "#20d5ec" },
    { key: "currentScale", label: "Current scale", description: "Extra size of the current word as a fraction (0.08 = 8% larger).", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.08 },
  ],
  type: "word-highlight",
  // Full text stays visible; per-word colour is applied in the text renderer from `words`.
  frame: (f, _p, k) => ({
    ...f,
    chars: 1,
    alpha: f.alpha,
    wordHighlight: {
      pendingOpacity: Math.min(1, Math.max(0.1, n(k.pendingOpacity, 0.4))),
      highlightColor: typeof k.highlightColor === "string" && /^#[0-9a-fA-F]{6}$/.test(k.highlightColor) ? k.highlightColor : "#20d5ec",
      currentScale: Math.max(0, n(k.currentScale, 0.08)),
    },
  }),
  order: 70,
  ai: {
    use: "Karaoke-style captions: the whole line is on screen and each word lights up with the narration.",
    avoid: "Titles that should pop on one word at a time — use word-pop instead.",
  },
});
