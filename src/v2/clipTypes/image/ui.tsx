import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Image: the picture as the clip background; no waveform or filmstrip; no speed or volume. */
const image: ClipTypeUi = {
  id: "image",
  waveform: () => undefined,
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "image",
  inspectorTabs: ["basic", "chroma", "transition"],
  speed: false,
  volume: false,
};
export default image;
