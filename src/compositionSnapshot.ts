import { migrateLegacyProjectToComposition } from "./compositionMigration";
import type {
  CompositionDocument,
  CompositionPlacement,
  CompositionSourceReference,
  CompositionTrack,
} from "./compositionModel";
import type { DionysusProject } from "./types";

export interface CompositionSnapshotWarning {
  code: "unpinned-source" | "missing-source" | "orphan-placement";
  message: string;
  entityId?: string;
}

export interface CompositionSnapshotOptions {
  /** Stable identity of the new snapshot. All generated IDs derive from it, so the result is deterministic. */
  snapshotId: string;
  name?: string;
}

export interface CompositionSnapshot {
  snapshotId: string;
  sourceProjectId: string;
  sourceCompositionId: string;
  composition: CompositionDocument;
  trackIdMap: Record<string, string>;
  placementIdMap: Record<string, string>;
  warnings: CompositionSnapshotWarning[];
}

function pinSource(
  project: DionysusProject,
  source: CompositionSourceReference,
  placementId: string,
  warnings: CompositionSnapshotWarning[],
): CompositionSourceReference {
  if (source.type === "clip" && !source.versionId) {
    const asset = project.assets.find(candidate => candidate.id === source.assetId);
    const selected = asset?.selectedClipVersionId;
    if (selected && asset?.clipVersions?.some(version => version.id === selected)) {
      return { type: "clip", assetId: source.assetId, versionId: selected };
    }
    warnings.push({
      code: "unpinned-source",
      entityId: placementId,
      message: `Placement "${placementId}" references Clip "${source.assetId}" without a resolvable pinned version.`,
    });
    return { ...source };
  }
  if (source.type === "shot" && !source.versionId) {
    const shot = project.shots.find(candidate => candidate.id === source.shotId);
    const slots = shot?.slots ?? [];
    const slot = source.slotId ? slots.find(candidate => candidate.id === source.slotId) : slots.length === 1 ? slots[0] : undefined;
    if (slot && slot.versions.some(version => version.id === slot.selectedVersionId)) {
      return { type: "shot", shotId: source.shotId, slotId: slot.id, versionId: slot.selectedVersionId };
    }
    warnings.push({
      code: "unpinned-source",
      entityId: placementId,
      message: `Placement "${placementId}" references Shot "${source.shotId}" without a single resolvable selected version.`,
    });
    return { ...source };
  }
  return structuredClone(source);
}

/**
 * Creates an independent, structure-preserving snapshot of the project's root (Master) Composition.
 * It is neither a render nor a flat layer list: tracks, placement order, timing, source ranges,
 * linked-placement relationships and version pins are preserved under fresh deterministic IDs.
 * The source project is never mutated and the snapshot shares no mutable objects with it.
 */
export function createCompositionSnapshot(project: DionysusProject, options: CompositionSnapshotOptions): CompositionSnapshot {
  const migrated = migrateLegacyProjectToComposition(project);
  const root = migrated.rootComposition;
  const warnings: CompositionSnapshotWarning[] = [];
  const prefix = options.snapshotId;

  const trackIdMap: Record<string, string> = {};
  const tracks: CompositionTrack[] = root.tracks.map(track => {
    const id = `${prefix}:track:${track.id}`;
    trackIdMap[track.id] = id;
    return { ...structuredClone(track), id };
  });

  const placementIdMap: Record<string, string> = {};
  for (const placement of root.placements) placementIdMap[placement.id] = `${prefix}:placement:${placement.id}`;

  const placements: CompositionPlacement[] = root.placements.map(placement => {
    const mappedTrack = trackIdMap[placement.trackId];
    if (!mappedTrack) warnings.push({
      code: "orphan-placement",
      entityId: placement.id,
      message: `Placement "${placement.id}" references unknown track "${placement.trackId}".`,
    });
    const source = pinSource(project, placement.source, placement.id, warnings);
    if (source.type === "missing") warnings.push({
      code: "missing-source",
      entityId: placement.id,
      message: `Placement "${placement.id}" references a missing source and is retained as missing.`,
    });
    const linked = placement.linkedToPlacementId ? placementIdMap[placement.linkedToPlacementId] : undefined;
    const cloned = structuredClone(placement);
    delete cloned.linkedToPlacementId;
    return {
      ...cloned,
      id: placementIdMap[placement.id],
      trackId: mappedTrack ?? placement.trackId,
      source,
      ...(linked ? { linkedToPlacementId: linked } : {}),
      legacyData: {
        ...cloned.legacyData,
        snapshotOrigin: { compositionId: root.id, placementId: placement.id, trackId: placement.trackId },
      },
    };
  });

  const composition: CompositionDocument = {
    id: `${prefix}:composition`,
    name: options.name ?? `${root.name} — Snapshot`,
    duration: root.duration,
    frameRate: root.frameRate,
    width: root.width,
    height: root.height,
    tracks,
    placements,
    legacyData: {
      ...structuredClone(root.legacyData ?? {}),
      snapshotOrigin: { projectId: project.id, compositionId: root.id },
    },
  };

  return {
    snapshotId: prefix,
    sourceProjectId: project.id,
    sourceCompositionId: root.id,
    composition,
    trackIdMap,
    placementIdMap,
    warnings,
  };
}
