import { defineAudioFx } from "../define";

/** Station / stadium public-address: a band-limited horn speaker with a slap-back echo and a big space. */
export default defineAudioFx({
  id: "pa-announcement",
  name: "PA announcement",
  category: "Echo & reverb",
  order: 10,
  description: "Public-address loudspeaker in a large space: thin horn tone, slap-back echo and a long tail. Use for station, airport, stadium or school announcements.",
  data: { highpass: 450, lowpass: 4200, peak: { freq: 2200, gainDb: 6, q: 1 }, drive: 0.25, echo: { time: 0.18, feedback: 0.35, mix: 0.35 }, reverb: { seconds: 2.4, decay: 2.5, mix: 0.4, preDelay: 0.03 }, makeup: 1.4 },
  preview: { icon: "📢" },
  ai: { use: "an announcement over loudspeakers in a big public space", avoid: "normal narration or dialogue in a small room" },
});
