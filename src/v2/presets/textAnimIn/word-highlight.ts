import { defineTextAnimIn } from "../define";
import { n } from "../_lib/math";

export default defineTextAnimIn({
  id: "word-highlight",
  name: "Word highlight",
  category: "Captions",
  description: "Keeps the whole caption visible and emphasises each word in time (pending, current, spoken). Each state has colour, opacity, scale and font weight. Needs word timings (Even split or Align with AI), or a track Caption style.",
  params: [
    { key: "pendingOpacity", label: "Pending opacity", description: "Opacity of words not yet spoken (0–1).", type: "number", min: 0, max: 1, step: 0.05, default: 0.4 },
    { key: "pendingScale", label: "Pending scale", description: "Extra size of pending words as a fraction.", type: "number", min: 0, max: 0.5, step: 0.01, default: 0 },
    { key: "pendingWeight", label: "Pending weight", description: "Font weight of pending words (100 to 900; 0 = match the clip).", type: "number", min: 0, max: 900, step: 100, default: 0 },
    { key: "highlightColor", label: "Current colour", description: "Fill colour of the word that is current (CSS #rrggbb).", type: "color", default: "#20d5ec" },
    { key: "currentOpacity", label: "Current opacity", description: "Opacity of the current word (0–1).", type: "number", min: 0, max: 1, step: 0.05, default: 1 },
    { key: "currentScale", label: "Current scale", description: "Extra size of the current word as a fraction (0.08 = 8% larger).", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 },
    { key: "currentWeight", label: "Current weight", description: "Font weight of the current word (100 to 900; 0 = match the clip).", type: "number", min: 0, max: 900, step: 100, default: 0 },
    { key: "spokenOpacity", label: "Spoken opacity", description: "Opacity of spoken words (0–1).", type: "number", min: 0, max: 1, step: 0.05, default: 1 },
    { key: "spokenScale", label: "Spoken scale", description: "Extra size of spoken words as a fraction.", type: "number", min: 0, max: 0.5, step: 0.01, default: 0 },
    { key: "spokenWeight", label: "Spoken weight", description: "Font weight of spoken words (100 to 900; 0 = match the clip).", type: "number", min: 0, max: 900, step: 100, default: 0 },
  ],
  type: "word-highlight",
  // Full text stays visible; per-word colour is applied in the text renderer from `words`.
  frame: (f, _p, k) => {
    const hex = (v: unknown, fallback?: string) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
    const pendingOpacity = Math.min(1, Math.max(0, n(k.pendingOpacity, 0.4)));
    const highlightColor = hex(k.highlightColor, "#20d5ec") ?? "#20d5ec";
    const currentScale = Math.max(0, n(k.currentScale, 0.08));
    const phase = (opacity: number, scale: number, color?: string, weightKey?: string) => ({
      ...(color ? { color } : {}),
      opacity,
      scale,
      ...((typeof k[weightKey ?? ""] === "number" && (k[weightKey ?? ""] as number) >= 100) ? { weight: Math.round(n(k[weightKey ?? ""], 0) / 100) * 100 } : {}),
    });
    return {
      ...f,
      chars: 1,
      alpha: f.alpha,
      wordHighlight: {
        pendingOpacity,
        highlightColor,
        currentScale,
        pending: phase(pendingOpacity, Math.max(0, n(k.pendingScale, 0)), hex(k.pendingColor), "pendingWeight"),
        current: phase(Math.min(1, Math.max(0, n(k.currentOpacity, 1))), currentScale, hex(k.currentColor) ?? highlightColor, "currentWeight"),
        spoken: phase(Math.min(1, Math.max(0, n(k.spokenOpacity, 1))), Math.max(0, n(k.spokenScale, 0)), hex(k.spokenColor), "spokenWeight"),
      },
    };
  },
  order: 70,
  ai: {
    use: "Karaoke-style captions: the whole line is on screen and each word lights up with the narration.",
    avoid: "Titles that should pop on one word at a time — use word-pop instead.",
  },
});
