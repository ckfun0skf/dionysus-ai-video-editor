import type { ClipTypeUi } from "../../ui/clipTypeUi";

/**
 * P74: a 3D scene clip. Line cube icon, named after its asset; a read-only Scene tab (objects, events, problems) before
 * the editing tabs; no speed, volume or source-time tools (it renders from time alone). No thumbnail yet.
 * P75: the phone clip toolbar starts with Scene (the same panel in a sheet), so the tab is reachable at 390 px too.
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
  toolbar: ["scene", "adjust", "link", "to-main"],
  toolbarMain: ["scene", "adjust"],
  speed: false,
  volume: false,
};
export default scene;
