import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Audio: a tall waveform, no thumbnail. */
const audio: ClipTypeUi = {
  id: "audio",
  thumbBackground: false,
  waveform: () => "audio",
  assetThumb: "none",
  inspectorIcon: "♫",
  inspectorTabs: ["audio", "speed"],
  toolbar: ["audio", "speed", ["edit-audio", "adjust"]],
  transformInAudioTab: true,
};
export default audio;
