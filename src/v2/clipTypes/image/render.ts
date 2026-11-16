import type { ClipRenderer } from "../../render/clipRenderers";
import { drawMediaClip } from "../../render/mediaClip";

/** A still picture: a pooled <img>, placed, keyed, masked and transitioned (P68, from Player.draw()). */
const image: ClipRenderer = { id: "image", frame: drawMediaClip };
export default image;
