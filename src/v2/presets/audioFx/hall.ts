import { defineAudioFx } from "../define";

/** Concert-hall reverb: a long, smooth tail. */
export default defineAudioFx({
  id: "hall",
  name: "Hall",
  category: "Echo & reverb",
  order: 20,
  description: "Large hall reverb with a long smooth tail. Use for a church, cathedral, cave, empty warehouse or a dreamy, epic voice.",
  data: { reverb: { seconds: 3.2, decay: 2.2, mix: 0.45, preDelay: 0.04 } },
  preview: { icon: "🏛" },
  ai: { use: "a voice or sound in a very large space, or a dream/flashback feel" },
});
