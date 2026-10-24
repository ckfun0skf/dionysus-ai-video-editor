import { defineTransition } from "../define";
import { easeIO } from "../_lib/math";

export default defineTransition({
  id: "iris",
  name: "Circle open",
  category: "Wipe",
  description: "The incoming clip opens from a growing circle in the centre.",
  type: "iris",
  frame: (f, p) => ({ ...f, mixOut: 1, mixIn: 1, tIn: { iris: easeIO(p) } }),
  order: 140,
});
