import { defineClipType } from "../define";

/**
 * Fallback for a `clipType` this build does not know (a newer build or an unloaded plugin). Today such a clip is put on
 * a video track (`trackKindFor`) and every predicate answers false; step 1.8 adds the slate and the export warning.
 */
export default defineClipType({
  id: "unknown",
  description: "A clip of a type this build does not know: kept as is, drawn as a slate, warned on export.",
  trackKind: "video",
  caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: false, thumb: false, asset: "none" },
});
