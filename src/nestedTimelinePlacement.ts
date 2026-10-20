import type { ClipVersion, CompositionLayer, TimelineClip } from "./types";
import { applyClipVersionResizePreview as applyCompositionResizePreview, normalizeClipVersionTracks } from "./clipVersionTracks";
import { calculateTimelineClipResizePreview, type ClipResizePreview, type ResizeEdge } from "./timelineResize";
import { calculateTimelineDropPosition, canPlaceTimelineClipOnTrack, type TimelineDropPosition } from "./timelinePlacement";

/** Convert nested Composition layers into the same occupancy contract used by the Master Timeline. */
export function clipVersionLayersAsTimelineClips(version: ClipVersion): TimelineClip[] {
  const normalized = normalizeClipVersionTracks(version);
  return normalized.layers.map((layer: CompositionLayer): TimelineClip => ({
    id: layer.id,
    name: layer.name,
    kind: layer.kind === "audio" ? "audio" : layer.kind === "text" ? "text" : "video",
    trackId: layer.trackId ?? normalized.tracks?.find(track => track.kind === "video")?.id ?? "",
    start: layer.start,
    duration: layer.duration,
    ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}),
    ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}),
  }));
}

/** Calculate a snapping, frame-aligned non-overlapping drop position for any nested layer. */
export function calculateClipVersionDropPosition(
  version: ClipVersion,
  movingLayerId: string,
  targetTrackId: string,
  desiredStart: number,
  timelineDuration = version.duration,
  fps = 24,
): TimelineDropPosition | null {
  const normalized = normalizeClipVersionTracks(version);
  const layer = normalized.layers.find(item => item.id === movingLayerId);
  const track = normalized.tracks?.find(item => item.id === targetTrackId);
  if (!layer || !track) return null;
  const clips = clipVersionLayersAsTimelineClips(normalized);
  const moving = clips.find(item => item.id === movingLayerId);
  if (!moving || !canPlaceTimelineClipOnTrack(moving, track)) return null;
  return calculateTimelineDropPosition(
    clips,
    movingLayerId,
    targetTrackId,
    desiredStart,
    moving.duration,
    timelineDuration,
    Math.max(1, Number.isFinite(fps) ? fps : 24),
  );
}

export function calculateClipVersionResizePreview(
  version: ClipVersion,
  layerId: string,
  edge: ResizeEdge,
  deltaSeconds: number,
  timelineDuration = version.duration,
  fps = 24,
): ClipResizePreview | null {
  const clips = clipVersionLayersAsTimelineClips(version);
  return calculateTimelineClipResizePreview(clips, layerId, edge, deltaSeconds, timelineDuration, fps);
}

/** Apply the resized layer and any adjacent-layer trim as one immutable version update. */
export function applyClipVersionResizePreview(
  version: ClipVersion,
  preview: ClipResizePreview,
): ClipVersion {
  return applyCompositionResizePreview(version, preview);
}
