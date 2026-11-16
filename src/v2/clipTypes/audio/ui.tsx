import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Audio: a tall waveform, no thumbnail. */
const audio: ClipTypeUi = { id: "audio", thumbBackground: false, waveform: () => "audio", assetThumb: "none" };
export default audio;
