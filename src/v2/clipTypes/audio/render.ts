import type { ClipRenderer } from "../../render/clipRenderers";
import { drawMediaClip } from "../../render/mediaClip";

/** Sound only: a pooled <audio> slaved to the timeline (volume, fades, audio fx, spatial); nothing is drawn (P68). */
const audio: ClipRenderer = { id: "audio", frame: drawMediaClip };
export default audio;
