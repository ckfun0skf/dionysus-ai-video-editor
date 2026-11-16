import type { ClipTypeUi } from "../../ui/clipTypeUi";
import { effectName } from "../../ui/effectName";

/** Effect: its preset's name after the effect icon. */
const effect: ClipTypeUi = { id: "effect", name: (p) => effectName(p), icon: "effect", titlePrefix: "Effect: " };
export default effect;
