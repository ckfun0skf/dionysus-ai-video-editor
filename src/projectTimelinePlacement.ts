import type { DionysusProject, Shot, TimelineClip } from "./types";
import { getMasterShotStart } from "./masterTimeline";
import { calculateTimelineDropPosition } from "./timelinePlacement";
import { applyTimelineClipResize, calculateTimelineClipResizePreview, type ClipResizePreview } from "./timelineResize";
import { withDurationAndClampedFades } from "./audioEnvelope";

function asShotPlacement(project: DionysusProject, shot: Shot): TimelineClip {
  const trackId = shot.masterTrackId && project.tracks.some(track => track.id === shot.masterTrackId && track.kind === "video")
    ? shot.masterTrackId
    : project.tracks.find(track => track.kind === "video")?.id ?? "";
  return {
    id: shot.id,
    name: shot.title,
    kind: "video",
    trackId,
    start: getMasterShotStart(project.shots, shot.id),
    duration: shot.duration,
  };
}

/** A shared occupancy set for Master Shots and ordinary clips. Materialized Storyboard clips
 * are represented by their Shot except while that materialized clip itself is being edited. */
export function getProjectTimelinePlacementItems(
  project: DionysusProject,
  movingClip?: TimelineClip,
  excludeShotId?: string,
): TimelineClip[] {
  const materialized = Boolean(movingClip?.id.startsWith("storyboard-"));
  const associatedShotId = materialized
    ? movingClip?.shotId ?? project.shots.find(shot => movingClip!.id.startsWith("storyboard-" + shot.id + "-"))?.id
    : excludeShotId;
  const items = [
    ...(project.timelineClips ?? []).filter(clip => !clip.id.startsWith("storyboard-")),
    ...project.shots.filter(shot => shot.id !== associatedShotId).map(shot => asShotPlacement(project, shot)),
  ];
  if (materialized && movingClip && !items.some(item => item.id === movingClip.id)) items.push(movingClip);
  return items;
}

export function calculateProjectTimelineDropPosition(
  project: DionysusProject,
  movingClip: TimelineClip,
  targetTrackId: string,
  desiredStart: number,
  timelineDuration: number,
): ReturnType<typeof calculateTimelineDropPosition> {
  return calculateTimelineDropPosition(
    getProjectTimelinePlacementItems(project, movingClip),
    movingClip.id,
    targetTrackId,
    desiredStart,
    movingClip.duration,
    timelineDuration,
    Math.max(1, project.frameRate || 24),
  );
}

export function calculateProjectTimelineClipResizePreview(
  project: DionysusProject,
  movingClip: TimelineClip,
  edge: "left" | "right",
  deltaSeconds: number,
  timelineDuration: number,
): ClipResizePreview | null {
  return calculateTimelineClipResizePreview(
    getProjectTimelinePlacementItems(project, movingClip),
    movingClip.id,
    edge,
    deltaSeconds,
    timelineDuration,
    Math.max(1, project.frameRate || 24),
  );
}

/** Apply a resize across both Shot placements and ordinary clips as one project change. */
export function applyProjectTimelineClipResize(
  project: DionysusProject,
  preview: ClipResizePreview,
): DionysusProject {
  const fps = Math.max(1, project.frameRate || 24);
  const shotIds = new Set(project.shots.map(shot => shot.id));
  const shotTrims = preview.trims.filter(trim => shotIds.has(trim.id));
  const isShotTarget = shotIds.has(preview.id);
  const shotUpdates = new Map<string, { start: number; duration: number }>();
  if (isShotTarget) shotUpdates.set(preview.id, { start: preview.start, duration: preview.duration });
  for (const trim of shotTrims) shotUpdates.set(trim.id, { start: trim.start, duration: trim.duration });
  const clipPreview: ClipResizePreview = {
    ...preview,
    id: isShotTarget ? "__master-shot-resize__" : preview.id,
    trims: preview.trims.filter(trim => !shotIds.has(trim.id)),
  };
  const timelineClips = applyTimelineClipResize(project.timelineClips ?? [], clipPreview, fps)
    .map(clip => clip.kind === "audio" ? withDurationAndClampedFades(clip, clip.duration) : clip);
  return {
    ...project,
    shots: project.shots.map(shot => {
      const update = shotUpdates.get(shot.id);
      return update ? { ...shot, masterStart: update.start, duration: update.duration } : shot;
    }),
    timelineClips,
  };
}
