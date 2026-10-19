import type { Asset, CompositionLayer, DionysusProject, TimelineClip, TimelineTrack } from "./types";
import {
  canonicalTrackKind,
  findAsset,
  selectedShotVersion,
  type CompositionDocument,
  type CompositionMigrationResult,
  type CompositionMigrationWarning,
  type CompositionPlacement,
  type CompositionSourceReference,
  type CompositionTrack,
} from "./compositionModel";

function record(value: object): Record<string, unknown> {
  return { ...value } as Record<string, unknown>;
}

function sourceForTimelineClip(project: DionysusProject, clip: TimelineClip): CompositionSourceReference {
  if (clip.shotId) {
    const versionId = selectedShotVersion(project, clip.shotId, clip.slotId);
    return {
      type: "shot",
      shotId: clip.shotId,
      ...(clip.slotId ? { slotId: clip.slotId } : {}),
      ...(versionId ? { versionId } : {}),
    };
  }
  if (clip.assetId) {
    const asset = findAsset(project, clip.assetId);
    if (!asset) return { type: "missing", originalKind: clip.kind, originalId: clip.assetId };
    if (asset.kind === "clip" || clip.kind === "clip") {
      const versionId = clip.clipVersionId ?? asset.selectedClipVersionId;
      return { type: "clip", assetId: clip.assetId, ...(versionId ? { versionId } : {}) };
    }
    return { type: "asset", assetId: clip.assetId };
  }
  if (clip.scriptVersionId) return { type: "script", scriptVersionId: clip.scriptVersionId };
  return { type: "none" };
}

function sourceForLayer(project: DionysusProject, layer: CompositionLayer): CompositionSourceReference {
  if (layer.kind === "composition" && layer.childCompositionId) {
    const asset = findAsset(project, layer.childCompositionId);
    if (!asset || asset.kind !== "clip") return { type: "missing", originalKind: layer.kind, originalId: layer.childCompositionId };
    return { type: "clip", assetId: layer.childCompositionId, ...(layer.clipVersionId ? { versionId: layer.clipVersionId } : {}) };
  }
  if (layer.assetId) {
    const asset = findAsset(project, layer.assetId);
    if (!asset) return { type: "missing", originalKind: layer.kind, originalId: layer.assetId };
    if (asset.kind === "clip") {
      const versionId = layer.clipVersionId ?? asset.selectedClipVersionId;
      return { type: "clip", assetId: asset.id, ...(versionId ? { versionId } : {}) };
    }
    return { type: "asset", assetId: layer.assetId };
  }
  if (layer.scriptVersionId) return { type: "script", scriptVersionId: layer.scriptVersionId };
  return { type: "none" };
}

function rootTracks(projectTracks: TimelineTrack[], warnings: CompositionMigrationWarning[]): CompositionTrack[] {
  return projectTracks.map((track, order) => {
    const kind = canonicalTrackKind(track.kind);
    if (track.kind !== kind) warnings.push({
      code: "unsupported-track-kind",
      entityId: track.id,
      message: `Legacy track kind "${track.kind}" was mapped to canonical "${kind}" while retaining originalKind.`,
    });
    return {
      id: track.id,
      name: track.name,
      kind,
      order,
      ...(track.muted !== undefined ? { muted: track.muted } : {}),
      ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
      ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
      ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
      ...(track.kind !== kind ? { originalKind: track.kind } : {}),
      legacyData: record(track),
    };
  });
}

function rootPlacements(project: DionysusProject, warnings: CompositionMigrationWarning[]): CompositionPlacement[] {
  const clips = project.timelineClips ?? [];
  const byId = new Map(clips.map((clip) => [clip.id, clip]));
  const duplicateCandidates = new Set<string>();

  for (const clip of clips) {
    if (!clip.id.startsWith("storyboard-") || !clip.shotId || !clip.slotId) continue;
    const duplicate = clips.find((other) =>
      other.id !== clip.id &&
      !other.id.startsWith("storyboard-") &&
      other.shotId === clip.shotId &&
      other.slotId === clip.slotId &&
      other.trackId === clip.trackId
    );
    if (duplicate) {
      duplicateCandidates.add(clip.id);
      warnings.push({
        code: "duplicate-storyboard-placement",
        entityId: clip.id,
        message: `Skipped materialized Storyboard placement "${clip.id}" because "${duplicate.id}" already places the same Shot/Slot on the same track.`,
      });
    }
  }

  return clips.filter((clip) => !duplicateCandidates.has(clip.id)).map((clip, order) => {
    const source = sourceForTimelineClip(project, clip);
    if (source.type === "missing") warnings.push({
      code: "missing-source",
      entityId: clip.id,
      message: `Placement "${clip.id}" references missing source "${source.originalId}". The reference is retained as missing.`,
    });
    return {
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      start: clip.start,
      duration: clip.duration,
      order,
      source,
      ...(clip.sourceIn !== undefined ? { sourceIn: clip.sourceIn } : {}),
      ...(clip.sourceOut !== undefined ? { sourceOut: clip.sourceOut } : {}),
      ...(clip.linkedVideoClipId && byId.has(clip.linkedVideoClipId) ? { linkedToPlacementId: clip.linkedVideoClipId } : {}),
      legacyData: record(clip),
    };
  });
}

function nestedTrackKind(layer: CompositionLayer): "video" | "audio" | "text" {
  if (layer.kind === "audio") return "audio";
  if (layer.kind === "text") return "text";
  return "video";
}

function clipComposition(asset: Asset, version: NonNullable<Asset["clipVersions"]>[number], project: DionysusProject, warnings: CompositionMigrationWarning[]): CompositionDocument {
  const id = `composition:${asset.id}:${version.id}`;
  const encounteredKinds: Array<"video" | "audio" | "text"> = [];
  for (const layer of version.layers) {
    const kind = nestedTrackKind(layer);
    if (!encounteredKinds.includes(kind)) encounteredKinds.push(kind);
  }
  const tracks: CompositionTrack[] = encounteredKinds.map((kind, order) => ({
    id: `${id}:track:${kind}`,
    name: kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text",
    kind,
    order,
  }));
  const trackByKind = new Map(tracks.map((track) => [track.kind, track.id]));
  const placements = version.layers.map((layer, order) => {
    const source = sourceForLayer(project, layer);
    if (source.type === "missing") warnings.push({
      code: "missing-source",
      entityId: layer.id,
      message: `Nested placement "${layer.id}" references missing source "${source.originalId}". The reference is retained as missing.`,
    });
    return {
      id: layer.id,
      name: layer.name,
      trackId: trackByKind.get(nestedTrackKind(layer))!,
      start: layer.start,
      duration: layer.duration,
      order,
      source,
      ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}),
      ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}),
      legacyData: record(layer),
    };
  });
  return {
    id,
    name: `${asset.name} — ${version.name}`,
    duration: version.duration,
    frameRate: project.frameRate,
    width: asset.canvasWidth ?? project.width,
    height: asset.canvasHeight ?? project.height,
    tracks,
    placements,
    legacyData: {
      assetId: asset.id,
      clipVersionId: version.id,
      description: version.description,
      scriptVersionIds: [...version.scriptVersionIds],
      generationRecords: structuredClone(version.generationRecords),
    },
  };
}

/**
 * Projects a schema-1.0 project into the canonical Composition shape without mutating or replacing
 * the source project. This is an adapter/projection until import/export is migrated.
 */
export function migrateLegacyProjectToComposition(project: DionysusProject): CompositionMigrationResult {
  const warnings: CompositionMigrationWarning[] = [];
  const tracks = rootTracks(project.tracks, warnings);
  const placements = rootPlacements(project, warnings);
  const shotEnd = project.shots.reduce((end, shot, index) => {
    const fallbackStart = project.shots.slice(0, index).reduce((sum, previous) => sum + previous.duration, 0);
    return Math.max(end, (shot.masterStart ?? fallbackStart) + shot.duration);
  }, 0);
  const placementEnd = placements.reduce((end, placement) => Math.max(end, placement.start + placement.duration), 0);
  const rootComposition: CompositionDocument = {
    id: `composition:project:${project.id}:master`,
    name: `${project.name} — Master Timeline`,
    duration: Math.max(shotEnd, placementEnd),
    frameRate: project.frameRate,
    width: project.width,
    height: project.height,
    tracks,
    placements,
    legacyData: {
      storyboardConnections: structuredClone(project.storyboardConnections ?? []),
      sourceTrackIds: project.tracks.map((track) => track.id),
    },
  };
  const clipCompositions = project.assets
    .filter((asset) => asset.kind === "clip")
    .flatMap((asset) => (asset.clipVersions ?? []).map((version) => clipComposition(asset, version, project, warnings)));
  return {
    schemaVersion: "2.0",
    projectId: project.id,
    name: project.name,
    rootComposition,
    clipCompositions,
    sourceProject: structuredClone(project),
    warnings,
  };
}
