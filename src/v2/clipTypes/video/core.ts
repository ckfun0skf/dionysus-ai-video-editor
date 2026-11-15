import { defineClipType } from "../define";

export default defineClipType({
  id: "video",
  description: "A video file: picture, embedded sound (linked audio), trim, speed, reverse, freeze.",
  trackKind: "video",
  caps: { sourceTime: true, still: false, sound: true, visual: true, keyable: true, thumb: true, asset: "media" },
});
