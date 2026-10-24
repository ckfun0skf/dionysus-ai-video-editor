import { defineTextAnimIn } from "../define";

export default defineTextAnimIn({
  id: "typewriter",
  name: "Typewriter",
  category: "Type",
  description: "Reveals the text one character at a time.",
  type: "typewriter",
  frame: (f, p) => ({ ...f, chars: Math.min(f.chars, p) }),
  order: 50,
});
