import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** P36: a solid colour clip: its colour as the background and a swatch dot with "Blank". */
const blank: ClipTypeUi = {
  id: "blank",
  kindClass: "is-blank",
  background: (p) => ({ background: p.blank!.color }),
  body: (p) => <span className="v2-clip-name v2-blank-body" style={{ ["--blank" as string]: p.blank!.color }}><span className="v2-blank-dot" aria-hidden />Blank</span>,
};
export default blank;
