import { defineClipType } from "../define";

export default defineClipType({
  id: "audio",
  description: "A sound file (music, voice-over, sound effect, Audio editor clip) on an audio track.",
  trackKind: "audio",
  caps: { sourceTime: true, still: false, sound: true, visual: false, keyable: false, thumb: false, asset: "media" },
});
