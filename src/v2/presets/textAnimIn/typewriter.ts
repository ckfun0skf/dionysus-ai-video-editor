import { defineTextAnimIn } from "../define";
import { n } from "../_lib/math";

const AFTER = ["blink", "hide", "fade"] as const;

export default defineTextAnimIn({
  id: "typewriter",
  name: "Typewriter",
  category: "Type",
  description: "Reveals the text one character at a time, with an optional cursor (one character = blinking cursor, several = scramble/decode).",
  params: [
    { key: "cursor", label: "Cursor", description: "Cursor characters. Empty = no cursor; one character (| or _) = a cursor after the text; several (0123456789) = each new character shows random ones of these before it resolves (decode effect).", type: "string", default: "" },
    { key: "blink", label: "Blink rate", description: "Cursor blinks per second once typing has finished (0 = solid).", type: "number", min: 0, max: 6, step: 0.5, default: 2 },
    { key: "after", label: "After typing", description: "What the cursor does when typing is done: blink = keep blinking, hide = disappear at once, fade = fade out over 0.5 s.", type: "select", options: [...AFTER], default: "blink" },
    { key: "scramble", label: "Scramble time", description: "Seconds each character cycles through the cursor characters before resolving (only with several cursor characters).", type: "number", min: 0, max: 1, step: 0.05, default: 0.15 },
  ],
  type: "typewriter",
  frame: (f, p, k) => {
    const out = { ...f, chars: Math.min(f.chars, p) };
    const glyphs = typeof k.cursor === "string" ? k.cursor : "";
    if (!glyphs) return out;
    const after = AFTER.includes(k.after as (typeof AFTER)[number]) ? (k.after as (typeof AFTER)[number]) : "blink";
    return { ...out, cursor: { glyphs, blink: Math.max(0, n(k.blink, 2)), after, scramble: Math.max(0, n(k.scramble, 0.15)) } };
  },
  order: 50,
});
