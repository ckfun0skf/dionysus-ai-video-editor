import { defineAudioFx } from "../define";

/** Small-room ambience: a short, natural reverb. */
export default defineAudioFx({
  id: "room",
  name: "Room",
  category: "Echo & reverb",
  order: 30,
  description: "Small room reverb: a short natural reflection that places a dry recording in an indoor space (office, bedroom, bathroom).",
  data: { reverb: { seconds: 0.7, decay: 3, mix: 0.35, preDelay: 0.01 } },
  preview: { icon: "🚪" },
  ai: { use: "a dry voiceover or sound effect should sound like it happens in the room on screen" },
});
