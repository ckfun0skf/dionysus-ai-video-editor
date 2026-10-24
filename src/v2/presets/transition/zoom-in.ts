import { defineTransition } from "../define";
import { zoomT } from "../_lib/transitions";

export default defineTransition({
  id: "zoom-in",
  name: "Zoom in",
  category: "Zoom",
  description: "Rushes forward: the outgoing clip zooms in and the incoming clip continues the push; energetic.",
  params: [
    { key: "outScale", label: "Out zoom", description: "Scale the outgoing clip reaches, as a multiplier of full size (1 = unchanged).", type: "number", min: 0.2, max: 3, step: 0.05, default: 1.8 },
    { key: "inScale", label: "In zoom", description: "Scale the incoming clip starts from, as a multiplier of full size (1 = unchanged).", type: "number", min: 0.2, max: 3, step: 0.05, default: 0.6 },
    { key: "blur", label: "Blur", description: "Peak blur as a fraction of the frame height.", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.02 },
  ],
  type: "zoomT",
  frame: zoomT,
  popular: true,
  order: 150,
});
