import { defineTextEffect } from "../define";
import { n, s } from "../_lib/math";

export default defineTextEffect({
  id: "echo",
  name: "Echo",
  category: "Style",
  description: "Repeated offset copies behind the text.",
  params: [
    { key: "offset", label: "Offset", description: "Offset between the copies, as a fraction of the font size.", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 },
  ],
  type: "echo",
  frame: (f, _p, k) => { const o = n(k.offset, 0.06); return { ...f, fx: { ...f.fx, color: s(k.color, "#20d5ec"), echo: [{ dx: o * 2, dy: o * 2, alpha: 0.35 }, { dx: o, dy: o, alpha: 0.6 }] } }; },
  order: 30,
});
