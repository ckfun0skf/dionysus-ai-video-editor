import { defineAudioFx } from "../define";

/** Muffled: highs removed, as if underwater or behind a wall. */
export default defineAudioFx({
  id: "underwater",
  name: "Muffled / underwater",
  category: "Character",
  order: 60,
  description: "Muffled sound with the highs removed: underwater, behind a wall or door, from the next room, or a character losing consciousness.",
  data: { lowpass: 450, reverb: { seconds: 1.2, decay: 2, mix: 0.2 }, makeup: 1.3 },
  preview: { icon: "🌊" },
  ai: { use: "sound heard underwater, through a wall or door, or a dazed point of view" },
});
