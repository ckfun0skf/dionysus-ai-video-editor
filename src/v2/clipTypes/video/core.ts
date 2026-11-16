import { defineClipType } from "../define";

export default defineClipType({
  id: "video",
  description: "A video file: picture, embedded sound (linked audio), trim, speed, reverse, freeze.",
  trackKind: "video",
  caps: { sourceTime: true, still: false, sound: true, visual: true, keyable: true, thumb: true, asset: "media" },
  accepts: { mimePrefix: "video/", ext: ["mp4", "webm", "mov", "m4v"], mimeByExt: { mov: "video/quicktime", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm" } },
  story: { assetTypes: ["video"], slotType: "video", layerType: "video", layer: true, sendLength: "media", takes: true, params: false },
});
