import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Text: its words as the name, after a T icon ("Text" when empty). */
const text: ClipTypeUi = { id: "text", name: (p) => p.text?.text, icon: "T", emptyName: "Text" };
export default text;
