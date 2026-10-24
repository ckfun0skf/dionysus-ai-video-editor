import { defineTransition } from "../define";

export default defineTransition({
  id: "dip",
  name: "Dip to black",
  category: "Basic",
  description: "Fades the outgoing clip to black, then up into the incoming clip.",
  type: "dip",
  frame: (f, p) => ({ ...f, mixOut: p < 0.5 ? 1 - p * 2 : 0, mixIn: p < 0.5 ? 0 : (p - 0.5) * 2 }),
  preview: { icon: "◐" },
  popular: true,
  order: 10,
});
