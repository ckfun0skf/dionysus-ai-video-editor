import { defineAudioFx } from "../define";

/** Robot voice: ring modulation plus a short metallic comb echo. */
export default defineAudioFx({
  id: "robot",
  name: "Robot",
  category: "Character",
  order: 70,
  description: "Metallic robot or AI voice: ring modulation and a short resonant comb echo. Use for robots, androids, computer voices and aliens.",
  data: { ringMod: { freq: 60, mix: 0.8 }, echo: { time: 0.012, feedback: 0.6, mix: 0.4 }, highpass: 120, makeup: 1.2 },
  preview: { icon: "🤖" },
  ai: { use: "a robot, android, computer or alien voice" },
});
