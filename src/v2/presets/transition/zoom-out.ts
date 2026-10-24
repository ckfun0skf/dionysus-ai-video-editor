import { defineTransition } from "../define";
import { zoomT } from "../_lib/transitions";

export default defineTransition({
  id: "zoom-out",
  name: "Zoom out",
  category: "Zoom",
  description: "Pulls back: the outgoing clip shrinks away and the incoming clip settles in from larger.",
  params: [
    { key: "outScale", label: "Out zoom", description: "Scale the outgoing clip reaches, as a multiplier of full size (1 = unchanged).", type: "number", min: 0.2, max: 3, step: 0.05, default: 0.5 },
    { key: "inScale", label: "In zoom", description: "Scale the incoming clip starts from, as a multiplier of full size (1 = unchanged).", type: "number", min: 0.2, max: 3, step: 0.05, default: 1.6 },
    { key: "blur", label: "Blur", description: "Peak blur as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.02 },
  ],
  type: "zoomT",
  frame: zoomT,
  order: 160,
});
