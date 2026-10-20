import type { DionysusProject, Shot, TimelineClip } from "./types";
import type { CompositionPlacement } from "./compositionModel";
import { assertValidCompositionDocument, applyCompositionResizePreview, insertCompositionPlacement, moveCompositionPlacementToTrack } from "./compositionCommands";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import { getMasterShotStart } from "./masterTimeline";
import { calculateTimelineDropPosition } from "./timelinePlacement";
import { applyTimelineClipResize, calculateTimelineClipResizePreview, type ClipResizePreview } from "./timelineResize";
import { withDurationAndClampedFades } from "./audioEnvelope";
import { canPlaceTimelineClipOnTrack } from "./timelinePlacement";
import { moveTimelineClip } from "./timelineOperations";
import { setMasterShotStart } from "./masterTimeline";

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

/** Apply a resize through the shared Composition command when the legacy project can be
 * represented without losing any of the affected placements. Materialized Storyboard clips and
 * malformed legacy link groups remain on the compatibility path until their migration is resolved. */
export function applyProjectTimelineClipResize(
  project: DionysusProject,
  preview: ClipResizePreview,
): DionysusProject {
  let rootComposition: ReturnType<typeof migrateLegacyProjectToComposition>["rootComposition"] | undefined;
  try {
    rootComposition = migrateLegacyProjectToComposition(project).rootComposition;
    assertValidCompositionDocument(rootComposition);
  } catch {
    rootComposition = undefined;
  }

  const requestedIds = [preview.id, ...preview.trims.map(trim => trim.id)];
  if (rootComposition && requestedIds.every(id => rootComposition!.placements.some(item => item.id === id))) {
    const resized = applyCompositionResizePreview(rootComposition, preview);
    const originalById = new Map(rootComposition.placements.map(placement => [placement.id, placement]));
    const updatedById = new Map(resized.placements.map(placement => [placement.id, placement]));
    // Include linked descendants changed by the shared command, not only the explicit resize
    // and trim IDs. Otherwise the canonical document is correct but the compatibility projection
    // leaves linked audio at its previous timing/source range.
    const touchedIds = new Set(resized.placements.filter(placement => {
      const original = originalById.get(placement.id);
      return original && (
        original.start !== placement.start ||
        original.duration !== placement.duration ||
        original.sourceIn !== placement.sourceIn ||
        original.sourceOut !== placement.sourceOut ||
        original.trackId !== placement.trackId
      );
    }).map(placement => placement.id));
    const shots = project.shots.map(shot => {
      if (!touchedIds.has(shot.id)) return shot;
      const placement = updatedById.get(shot.id);
      if (!placement) return shot;
      return {
        ...shot,
        masterStart: placement.start,
        duration: placement.duration,
        masterTrackId: placement.trackId,
      };
    });
    const timelineClips = (project.timelineClips ?? []).map(clip => {
      if (!touchedIds.has(clip.id)) return clip;
      const placement = updatedById.get(clip.id);
      if (!placement) return clip;
      const {
        sourceIn: _sourceIn,
        sourceOut: _sourceOut,
        linkedVideoClipId: _linkedVideoClipId,
        ...rest
      } = clip;
      return {
        ...rest,
        trackId: placement.trackId,
        start: placement.start,
        duration: placement.duration,
        ...(placement.sourceIn !== undefined ? { sourceIn: placement.sourceIn } : {}),
        ...(placement.sourceOut !== undefined ? { sourceOut: placement.sourceOut } : {}),
        ...(placement.linkedToPlacementId ? { linkedVideoClipId: placement.linkedToPlacementId } : {}),
      };
    }).map(clip => clip.kind === "audio" ? withDurationAndClampedFades(clip, clip.duration) : clip);
    return { ...project, shots, timelineClips };
  }

  // Transitional fallback: legacy Storyboard materializations are intentionally omitted from the
  // canonical root projection, so retain the existing behavior for operations that include them.
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


export type ProjectTimelineInsertionStatus = "ready" | "start-occupied" | "needs-resolution" | "invalid-track";
export type ProjectTimelineInsertResolution = "ripple" | "trim";

export interface ProjectTimelineInsertionPlan {
  status: ProjectTimelineInsertionStatus;
  clip: TimelineClip;
  trackId: string;
  start: number;
  duration: number;
  /** Free time before the next item on this track. Infinity means no later item. */
  availableDuration: number;
  /** The first following placement that the new clip would collide with. */
  conflictStart?: number;
  conflictId?: string;
  conflictName?: string;
  /** Frame-aligned shift required to insert without overlap. */
  shiftBy?: number;
}

const insertionEpsilon = 1e-7;
const snapInsertionFrame = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

function materializedShotId(clip: TimelineClip, project: DionysusProject): string | undefined {
  if (!clip.id.startsWith("storyboard-")) return undefined;
  return clip.shotId ?? project.shots.find(shot => clip.id.startsWith("storyboard-" + shot.id + "-"))?.id;
}

function isCanonicalShotMaterialization(clip: TimelineClip, project: DionysusProject): boolean {
  if (clip.kind !== "video") return false;
  const shotId = materializedShotId(clip, project);
  if (!shotId) return false;
  const shot = project.shots.find(item => item.id === shotId);
  return Boolean(shot && asShotPlacement(project, shot).trackId === clip.trackId);
}

/** Include generated Storyboard audio/text placements on their own tracks without double-counting
 * the Master Shot video placement. Orphaned legacy storyboard placements remain visible to occupancy. */
function getInsertionOccupancyItems(
  project: DionysusProject,
  movingClip: TimelineClip,
  targetTrackId: string,
): TimelineClip[] {
  const items = getProjectTimelinePlacementItems(project, movingClip);
  const ids = new Set(items.map(item => item.id));
  for (const clip of project.timelineClips ?? []) {
    if (!clip.id.startsWith("storyboard-") || clip.trackId !== targetTrackId || ids.has(clip.id)) continue;
    if (isCanonicalShotMaterialization(clip, project)) continue;
    items.push(clip);
    ids.add(clip.id);
  }
  return items;
}

/** Calculate a click-to-place plan without silently overwriting or moving existing placements. */
export function calculateProjectTimelineInsertionPlan(
  project: DionysusProject,
  draft: TimelineClip,
  targetTrackId: string,
  desiredStart: number,
): ProjectTimelineInsertionPlan {
  const fps = Math.max(1, Number.isFinite(project.frameRate) ? project.frameRate : 24);
  const frame = 1 / fps;
  const start = snapInsertionFrame(Math.max(0, Number.isFinite(desiredStart) ? desiredStart : 0), fps);
  const validDuration = Number.isFinite(draft.duration) && draft.duration > 0;
  const duration = validDuration ? Math.max(frame, snapInsertionFrame(draft.duration, fps)) : frame;
  const clip: TimelineClip = { ...draft, trackId: targetTrackId, start, duration };
  const track = project.tracks.find(item => item.id === targetTrackId);
  if (!validDuration || !track || !canPlaceTimelineClipOnTrack(clip, track)) {
    return { status: "invalid-track", clip, trackId: targetTrackId, start, duration, availableDuration: 0 };
  }

  const occupancy = getInsertionOccupancyItems(project, clip, targetTrackId)
    .filter(item => item.trackId === targetTrackId)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const covering = occupancy.find(item =>
    start >= item.start - insertionEpsilon && start < item.start + item.duration - insertionEpsilon
  );
  if (covering) {
    return {
      status: "start-occupied", clip, trackId: targetTrackId, start, duration,
      availableDuration: 0, conflictStart: covering.start, conflictId: covering.id, conflictName: covering.name,
    };
  }

  const next = occupancy.find(item => item.start >= start - insertionEpsilon);
  const availableDuration = next ? Math.max(0, next.start - start) : Number.POSITIVE_INFINITY;
  if (!next || duration <= availableDuration + insertionEpsilon) {
    return { status: "ready", clip, trackId: targetTrackId, start, duration, availableDuration };
  }

  const shiftBy = Math.ceil(((start + duration - next.start) * fps) - insertionEpsilon) / fps;
  return {
    status: "needs-resolution", clip, trackId: targetTrackId, start, duration,
    availableDuration, conflictStart: next.start, conflictId: next.id, conflictName: next.name,
    shiftBy: Math.max(frame, shiftBy),
  };
}

/** Commit the insertion and optional ripple/trim resolution as a single immutable project update. */
export function applyProjectTimelineInsertion(
  project: DionysusProject,
  plan: ProjectTimelineInsertionPlan,
  resolution?: ProjectTimelineInsertResolution,
): DionysusProject {
  if (plan.status === "invalid-track") throw new Error("This clip cannot be placed on the selected layer.");
  if (plan.status === "start-occupied") throw new Error("Choose an empty point on the timeline layer.");
  if (plan.status === "needs-resolution" && !resolution) throw new Error("Choose how to resolve the timeline overlap.");

  const fps = Math.max(1, Number.isFinite(project.frameRate) ? project.frameRate : 24);
  const frame = 1 / fps;
  let inserted = { ...plan.clip };
  let nextProject = project;

  if (plan.status === "needs-resolution" && resolution === "trim") {
    const trimDuration = Math.floor((plan.availableDuration + insertionEpsilon) * fps) / fps;
    if (trimDuration < frame - insertionEpsilon) {
      throw new Error("There is not enough room to keep even one frame. Choose Ripple later clips or another position.");
    }
    inserted = {
      ...inserted,
      duration: trimDuration,
      ...((inserted.sourceIn !== undefined || inserted.sourceOut !== undefined)
        ? { sourceOut: (inserted.sourceIn ?? 0) + trimDuration }
        : {}),
    };
  } else if (plan.status === "needs-resolution" && resolution === "ripple") {
    const boundary = plan.conflictStart;
    const delta = plan.shiftBy;
    if (boundary === undefined || delta === undefined || delta <= 0) {
      throw new Error("The ripple insertion plan is incomplete.");
    }
    const occupancy = getInsertionOccupancyItems(project, plan.clip, plan.trackId)
      .filter(item => item.trackId === plan.trackId && item.start >= boundary - insertionEpsilon);
    const occupiedIds = new Set(occupancy.map(item => item.id));
    const shotIds = new Set(project.shots.map(shot => shot.id));
    const shiftedShotIds = new Set(occupancy.filter(item => shotIds.has(item.id)).map(item => item.id));
    const shiftedTimelineIds = new Set(occupancy.filter(item => (project.timelineClips ?? []).some(clip => clip.id === item.id)).map(item => item.id));

    const shots = shiftedShotIds.size
      ? project.shots.map(shot => ({
          ...shot,
          // Materialize legacy sequential placements before moving any Shot so other start times remain stable.
          masterStart: getMasterShotStart(project.shots, shot.id) + (shiftedShotIds.has(shot.id) ? delta : 0),
        }))
      : project.shots;

    const timelineClips = (project.timelineClips ?? []).map(clip => {
      const ownerShotId = materializedShotId(clip, project);
      const shift = occupiedIds.has(clip.id)
        || Boolean(clip.linkedVideoClipId && shiftedTimelineIds.has(clip.linkedVideoClipId))
        || Boolean(ownerShotId && shiftedShotIds.has(ownerShotId));
      return shift ? { ...clip, start: snapInsertionFrame(clip.start + delta, fps) } : clip;
    });
    nextProject = { ...project, shots, timelineClips };
  }

  const existingIds = new Set([
    ...nextProject.shots.map(shot => shot.id),
    ...(nextProject.timelineClips ?? []).map(clip => clip.id),
  ]);
  if (existingIds.has(inserted.id)) {
    throw new Error("Timeline placement IDs must be unique.");
  }

  // Route ordinary placements through the shared immutable Composition insertion command
  // whenever the transitional project can be represented without losing source relationships.
  // Materialized Storyboard items are still excluded from the canonical projection and retain
  // the compatibility path until their migration is completed.
  let rootComposition: ReturnType<typeof migrateLegacyProjectToComposition>["rootComposition"] | undefined;
  let canonicalInserted: CompositionPlacement | undefined;
  try {
    rootComposition = migrateLegacyProjectToComposition(nextProject).rootComposition;
    assertValidCompositionDocument(rootComposition);
    const candidateProject = {
      ...nextProject,
      timelineClips: [...(nextProject.timelineClips ?? []), inserted],
    };
    const candidateRoot = migrateLegacyProjectToComposition(candidateProject).rootComposition;
    assertValidCompositionDocument(candidateRoot);
    canonicalInserted = candidateRoot.placements.find(placement => placement.id === inserted.id);
  } catch {
    rootComposition = undefined;
  }

  if (rootComposition && canonicalInserted) {
    const committed = insertCompositionPlacement(rootComposition, canonicalInserted);
    const insertedPlacement = committed.placements.find(placement => placement.id === inserted.id);
    if (!insertedPlacement) throw new Error("Composition insertion did not return the inserted placement.");
    return {
      ...nextProject,
      timelineClips: [
        ...(nextProject.timelineClips ?? []),
        structuredClone(insertedPlacement.legacyData) as unknown as TimelineClip,
      ],
    };
  }

  return {
    ...nextProject,
    timelineClips: [...(nextProject.timelineClips ?? []), inserted],
  };
}


export type ProjectTimelineMoveTarget =
  | { type: "shot"; shotId: string }
  | { type: "clip"; clipId: string };

/** Commit a valid placement move for either a Master Shot or an ordinary timeline clip. */
export function moveProjectTimelinePlacement(
  project: DionysusProject,
  target: ProjectTimelineMoveTarget,
  targetTrackId: string,
  start: number,
): DionysusProject {
  if (!Number.isFinite(start) || start < 0) throw new Error("Placement start must be finite and non-negative.");
  const targetTrack = project.tracks.find(track => track.id === targetTrackId);
  if (!targetTrack) throw new Error("Destination track not found.");

  if (target.type === "shot") {
    const shot = project.shots.find(item => item.id === target.shotId);
    if (!shot) throw new Error("Master Shot not found.");
    if (targetTrack.kind !== "video") throw new Error("A Master Shot must use a video track.");

    // Master Shots are canonical root Composition placements too. Apply the shared immutable
    // Composition command first, then project its committed fields back into the schema-1.0 Shot.
    let rootComposition: ReturnType<typeof migrateLegacyProjectToComposition>["rootComposition"] | undefined;
    try {
      rootComposition = migrateLegacyProjectToComposition(project).rootComposition;
      assertValidCompositionDocument(rootComposition);
    } catch {
      rootComposition = undefined;
    }
    const canonicalShot = rootComposition?.placements.find(placement => placement.id === shot.id);
    if (rootComposition && canonicalShot) {
      const movedComposition = moveCompositionPlacementToTrack(rootComposition, shot.id, targetTrackId, start);
      const committed = movedComposition.placements.find(placement => placement.id === shot.id);
      if (!committed) throw new Error("Composition move did not return the moved Master Shot.");
      const delta = committed.start - canonicalShot.start;
      return {
        ...project,
        shots: project.shots.map(item => item.id === shot.id
          ? { ...item, masterStart: committed.start, duration: committed.duration, masterTrackId: committed.trackId }
          : item),
        timelineClips: (project.timelineClips ?? []).map(clip =>
          clip.id.startsWith("storyboard-" + shot.id + "-")
            ? { ...clip, start: Math.max(0, clip.start + delta), ...(clip.kind === "video" ? { trackId: committed.trackId } : {}) }
            : clip
        ),
      };
    }

    // Compatibility fallback for malformed/legacy projects that cannot be represented as a
    // valid root Composition. Keep the old edit behavior rather than blocking recovery.
    const delta = start - getMasterShotStart(project.shots, shot.id);
    return {
      ...project,
      shots: setMasterShotStart(project.shots, shot.id, start)
        .map(item => item.id === shot.id ? { ...item, masterTrackId: targetTrackId } : item),
      timelineClips: (project.timelineClips ?? []).map(clip =>
        clip.id.startsWith("storyboard-" + shot.id + "-")
          ? { ...clip, start: Math.max(0, clip.start + delta), ...(clip.kind === "video" ? { trackId: targetTrackId } : {}) }
          : clip
      ),
    };
  }

  const moving = (project.timelineClips ?? []).find(item => item.id === target.clipId);
  if (!moving) throw new Error("Timeline clip not found.");
  if (!canPlaceTimelineClipOnTrack(moving, targetTrack)) throw new Error("This clip type cannot be placed on the destination track.");

  let rootComposition: ReturnType<typeof migrateLegacyProjectToComposition>["rootComposition"] | undefined;
  try {
    rootComposition = migrateLegacyProjectToComposition(project).rootComposition;
    assertValidCompositionDocument(rootComposition);
  } catch {
    rootComposition = undefined;
  }
  if (rootComposition?.placements.some(placement => placement.id === moving.id)) {
    const movedComposition = moveCompositionPlacementToTrack(rootComposition, moving.id, targetTrackId, start);
    const originalById = new Map(rootComposition.placements.map(placement => [placement.id, placement]));
    const movedById = new Map(movedComposition.placements.map(placement => [placement.id, placement]));
    const touchedIds = new Set(movedComposition.placements.filter(placement => {
      const original = originalById.get(placement.id);
      return original && (
        original.start !== placement.start ||
        original.duration !== placement.duration ||
        original.trackId !== placement.trackId ||
        original.sourceIn !== placement.sourceIn ||
        original.sourceOut !== placement.sourceOut
      );
    }).map(placement => placement.id));
    const timelineClips = (project.timelineClips ?? []).map(clip => {
      if (!touchedIds.has(clip.id)) return clip;
      const placement = movedById.get(clip.id);
      if (!placement) return clip;
      return {
        ...clip,
        trackId: placement.trackId,
        start: placement.start,
        duration: placement.duration,
        ...(placement.sourceIn !== undefined ? { sourceIn: placement.sourceIn } : {}),
        ...(placement.sourceOut !== undefined ? { sourceOut: placement.sourceOut } : {}),
      };
    });
    return { ...project, timelineClips };
  }

  // Compatibility path for materialized Storyboard placements omitted from the root projection.
  const targetClips = (project.timelineClips ?? []).map(clip => clip.id === moving.id ? { ...clip, trackId: targetTrackId } : clip);
  const moved = moveTimelineClip({ tracks: project.tracks, timelineClips: targetClips }, moving.id, start);
  return { ...project, timelineClips: moved.timelineClips };
}
