import { defineTransition } from "../define";

export default defineTransition({
  id: "crossfade",
  name: "Crossfade",
  category: "Basic",
  description: "The outgoing clip dissolves into the incoming clip.",
  type: "crossfade",
  frame: (f, p) => ({ ...f, mixOut: 1, mixIn: Math.max(0, Math.min(1, p)) }),
  preview: { icon: "⧓" },
  popular: true,
  order: 0,
});
