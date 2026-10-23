import type { TimelineClip } from "./types";

const sourceIdentityFields = [
  "kind",
  "assetId",
  "shotId",
  "slotId",
  "clipVersionId",
  "scriptVersionId",
] as const;

/**
 * Only rebuild a canonical source reference when an edit explicitly changes its identity.
 * Geometry, display, mute, and other metadata edits must not re-derive the source from the
 * legacy Project compatibility projection.
 */
export function timelineClipPatchChangesSourceIdentity(patch: Partial<TimelineClip>): boolean {
  return sourceIdentityFields.some(field => Object.prototype.hasOwnProperty.call(patch, field));
}
