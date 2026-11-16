import type { ClipTypeUi } from "../../ui/clipTypeUi";
import { Ic } from "../../ui/Icon";

/** P35: a storyboard shot with no clip yet: shot label and "Not generated" on a hatched card. */
const placeholder: ClipTypeUi = {
  id: "placeholder",
  kindClass: "is-placeholder",
  // A placeholder that also carries a blank flag keeps the blank colour behind its card, as before P69.
  background: (p) => (p.blank ? { background: p.blank.color } : undefined),
  body: (p) => (
    <span className="v2-clip-name v2-ph" title={`${p.placeholder!.label} — not generated yet. Add its clip on the storyboard and Send to timeline (Update), or Fill placeholder (pick or upload a clip).`}>
      <Ic g="board" size={12} /><span className="v2-ph-label">{p.placeholder!.label}</span><span className="v2-ph-state">Not generated</span>
    </span>
  ),
};
export default placeholder;
