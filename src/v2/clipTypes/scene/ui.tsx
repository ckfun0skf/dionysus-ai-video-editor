import type { ClipTypeUi } from "../../ui/clipTypeUi";

/**
 * P74: a 3D scene clip. Line cube icon, named after its asset; a read-only Scene tab (objects, events, problems) before
 * the editing tabs; no speed, volume or source-time tools (it renders from time alone). No thumbnail yet.
 */
const scene: ClipTypeUi = {
  id: "scene",
  icon: "scene",
  kindClass: "is-scene",
  thumbBackground: false,
  waveform: () => undefined,
  assetThumb: "none",
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "scene",
  inspectorTabs: ["scene", "basic", "chroma", "transition"],
  toolbar: ["adjust", "link", "to-main"],
  toolbarMain: ["adjust"],
  speed: false,
  volume: false,
};
export default scene;
