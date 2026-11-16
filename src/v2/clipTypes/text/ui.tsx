import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Text: its words as the name, after a T icon ("Text" when empty). */
const text: ClipTypeUi = {
  id: "text",
  name: (p) => p.text?.text,
  icon: "T",
  emptyName: "Text",
  inspectorIcon: "T",
  inspectorTitle: (p) => p.text?.text?.split("\n")[0] || "Text",
  inspectorTabs: ["text", { id: "basic", label: "Transform" }],
  inspectorActions: ["edit-all", "caption-style", "subtitles"],
  toolbar: ["style", "anim", "subs"],
  extraTools: ["adjust"],
  editor: "text",
  speed: false,
  volume: false,
};
export default text;
