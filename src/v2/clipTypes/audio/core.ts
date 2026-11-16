import { defineClipType } from "../define";

export default defineClipType({
  id: "audio",
  description: "A sound file (music, voice-over, sound effect, Audio editor clip) on an audio track.",
  trackKind: "audio",
  caps: { sourceTime: true, still: false, sound: true, visual: false, keyable: false, thumb: false, asset: "media" },
  accepts: { mimePrefix: "audio/", ext: ["mp3", "wav", "m4a", "aac", "ogg", "flac"], mimeByExt: { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" } },
  // Audio is never a shot clip or layer (cues place it); layerType is what Sync wrote for a non-video/html clip.
  story: { assetTypes: ["audio"], slotType: "audio", layerType: "image", layer: false, sendLength: "media", takes: false, params: false },
});
