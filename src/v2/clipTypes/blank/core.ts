import { defineClipType } from "../define";

/** P36. Stored as `clipType: "image"` + `blank`, so its caps are the image predicates' answers today. */
export default defineClipType({
  id: "blank",
  description: "A solid colour clip; transform and opacity apply like a photo's. No media, no thumbnail.",
  trackKind: "video",
  variant: { of: "image", field: "blank" },
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: false, asset: "none" },
  agent: { clipTools: ["set_blank_color"] },
});
