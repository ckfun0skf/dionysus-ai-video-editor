import type { ClipRenderer } from "../../render/clipRenderers";
import { drawMediaClip } from "../../render/mediaClip";

/**
 * A `clipType` this build does not register keeps the element path it always had (P68, unchanged behaviour); step 1.8
 * replaces this with a slate and an export warning.
 */
const unknown: ClipRenderer = { id: "unknown", frame: drawMediaClip };
export default unknown;
