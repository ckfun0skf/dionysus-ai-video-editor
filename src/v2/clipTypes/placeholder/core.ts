import { defineClipType } from "../define";

/** P35. Stored as `clipType: "image"` + `placeholder`, so its caps are the image predicates' answers today. */
export default defineClipType({
  id: "placeholder",
  description: "A storyboard shot with no clip yet: a labelled slate in preview, a dark frame in export (warned first).",
  trackKind: "video",
  variant: { of: "image", field: "placeholder" },
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: false, asset: "none" },
});
