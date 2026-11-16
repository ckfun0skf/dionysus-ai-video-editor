import { defineClipType } from "../define";

export default defineClipType({
  id: "html",
  description: "A code clip (dionysus.htmlclip/1): HTML/JS rendered in a sandboxed iframe from virtual time, with params and inputs.",
  trackKind: "video",
  caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: true, thumb: true, asset: "media" },
  accepts: { mime: ["text/html"], ext: ["html", "htm"], mimeByExt: { html: "text/html", htm: "text/html" } },
  story: { assetTypes: ["html"], slotType: "html", layerType: "html", layer: true, sendLength: "planned", takes: false, params: true },
});
