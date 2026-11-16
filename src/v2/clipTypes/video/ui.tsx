import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Video: filmstrip and waveform (no waveform while its sound is muted, frozen or reversed). */
const video: ClipTypeUi = {
  id: "video",
  filmstrip: true,
  waveform: (p) => (p.linkedAudio?.muted || p.freeze || p.reverse ? undefined : "video"),
  assetPreviews: { peaks: true, filmstrip: true },
};
export default video;
