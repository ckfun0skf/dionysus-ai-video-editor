import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "blur",
  name: "Blur",
  category: "Lens",
  description: "Blurs the whole picture.",
  params: [
    { key: "amount", label: "Amount", description: "Blur strength 0-1; 1 = a blur radius of 2% of the frame height.", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  type: "vBlur",
  frame: (f, _p, k) => ({ ...f, blur: (f.blur ?? 0) + n(k.amount, 0.5) * 0.02 }),
  order: 20,
});
