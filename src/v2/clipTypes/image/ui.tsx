import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Image: the picture as the clip background; no waveform or filmstrip. */
const image: ClipTypeUi = { id: "image", waveform: () => undefined, assetPreviews: { peaks: false, filmstrip: false } };
export default image;
