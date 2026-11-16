import { defineClipType } from "../define";

export default defineClipType({
  id: "image",
  description: "A still picture (photo, frame, character or location still) held for the clip's length.",
  trackKind: "video",
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: true, asset: "media" },
  // heic: a MIME guess only (iPhone photos keep their type); it is not imported by extension, as before.
  accepts: { mimePrefix: "image/", ext: ["png", "jpg", "jpeg", "gif", "webp"], mimeByExt: { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic" } },
  story: { assetTypes: ["character", "location", "prop", "style", "image", "frame"], slotFallback: true, slotType: "image", layerType: "image", layer: true, sendLength: "still", takes: false, params: false },
});
