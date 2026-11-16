import type { ClipTypeUi } from "../../ui/clipTypeUi";

/**
 * Video: filmstrip and waveform (no waveform while its sound is muted, frozen or reversed). Inspector and toolbar are
 * the defaults; it adds freeze / reverse, the in / out frame strip and linked-audio tools.
 */
const video: ClipTypeUi = {
  id: "video",
  timeTools: true,
  inOutFrames: true,
  linkedAudio: true,
  filmstrip: true,
  waveform: (p) => (p.linkedAudio?.muted || p.freeze || p.reverse ? undefined : "video"),
  assetPreviews: { peaks: true, filmstrip: true },
};
export default video;
