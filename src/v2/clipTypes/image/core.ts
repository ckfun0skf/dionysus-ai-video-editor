import { defineClipType } from "../define";

export default defineClipType({
  id: "image",
  description: "A still picture (photo, frame, character or location still) held for the clip's length.",
  trackKind: "video",
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: true, asset: "media" },
});
