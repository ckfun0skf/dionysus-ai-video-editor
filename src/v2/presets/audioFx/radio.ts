import { defineAudioFx } from "../define";

/** AM radio / walkie-talkie: band-limited, driven, with a midrange honk. */
export default defineAudioFx({
  id: "radio",
  name: "Radio",
  category: "Character",
  order: 50,
  description: "Old AM radio or walkie-talkie: band-limited, crunchy and nasal. Use for broadcasts, police/army radio chatter or a vintage feel.",
  data: { highpass: 500, lowpass: 3000, peak: { freq: 1800, gainDb: 9, q: 1.2 }, drive: 0.6, makeup: 1.5 },
  preview: { icon: "📻" },
  ai: { use: "a radio broadcast, intercom, walkie-talkie or vintage recording" },
});
