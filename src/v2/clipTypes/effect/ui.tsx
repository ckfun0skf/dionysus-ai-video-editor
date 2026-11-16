import type { ClipTypeUi } from "../../ui/clipTypeUi";
import { effectName } from "../../ui/effectName";

/** Effect: its preset's name after the effect icon. */
const effect: ClipTypeUi = {
  id: "effect",
  name: (p) => effectName(p),
  icon: "effect",
  titlePrefix: "Effect: ",
  inspectorIcon: "effect",
  inspectorTitle: (p) => `Effect · ${p.effect?.preset ?? ""}`,
  inspectorTabs: ["effect"],
  toolbar: ["fx", "link", "adjust"],
  editor: "effect",
  volume: false,
};
export default effect;
