import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** P36: a solid colour clip: its colour as the background and a swatch dot with "Blank". */
const blank: ClipTypeUi = {
  id: "blank",
  kindClass: "is-blank",
  // Stored as an image clip: the image icon, a Colour tab and tool, no chroma key, speed or volume.
  inspectorIcon: "image",
  inspectorTabs: ["colour", "basic", "transition"],
  toolbar: ["colour", "adjust", "link", "to-main"],
  speed: false,
  volume: false,
  background: (p) => ({ background: p.blank!.color }),
  body: (p) => <span className="v2-clip-name v2-blank-body" style={{ ["--blank" as string]: p.blank!.color }}><span className="v2-blank-dot" aria-hidden />Blank</span>,
};
export default blank;
