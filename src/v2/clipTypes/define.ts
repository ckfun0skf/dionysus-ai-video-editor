import type { ClipTypeCore, ClipTypeDef } from "./types";

/** Default export of `clipTypes/<id>/core.ts`. Fills defaults; the loader validates the result. */
export const defineClipType = (def: ClipTypeDef): ClipTypeCore => ({ ...def, version: def.version ?? 1 });
