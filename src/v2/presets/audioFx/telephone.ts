import { defineAudioFx } from "../define";

/** Phone line: narrow 300–3400 Hz band with a little crunch. */
export default defineAudioFx({
  id: "telephone",
  name: "Telephone",
  category: "Character",
  order: 40,
  description: "Voice heard through a phone: narrow 300–3400 Hz band with slight distortion. Use for the other side of a phone call or a voicemail.",
  data: { highpass: 300, lowpass: 3400, peak: { freq: 1500, gainDb: 4, q: 0.8 }, drive: 0.3, makeup: 1.6 },
  preview: { icon: "☎" },
  ai: { use: "a character speaking on the phone or a voicemail" },
});
