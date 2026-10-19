import type { CompositionSnapshot } from "./compositionSnapshot";
import type { CompositionDocument, CompositionPlacement } from "./compositionModel";
import type { ClipVersion, CompositionLayer, DionysusProject, TimelineTrack } from "./types";

export interface CompositionSnapshotClipVersionOptions {
  versionId: string;
  name: string;
  description: string;
}

function layerKind(placement: CompositionPlacement, project: DionysusProject): CompositionLayer["kind"] {
  switch (placement.source.type) {
    case "clip": return "composition";
    case "script": return "script";
    case "none": return "procedural";
    case "asset": {
      const asset = project.assets.find(item => item.id === placement.source.assetId);
      if (asset?.kind === "audio") return "audio";
      if (asset?.kind === "image") return "image";
      if (asset?.kind === "script") return "script";
      return "video";
    }
    case "shot":
    case "missing": return "video";
  }
}

function shotVisual(project: DionysusProject, placement: CompositionPlacement): Partial<CompositionLayer> {
  if (placement.source.type !== "shot") return {};
  const shot = project.shots.find(item => item.id === placement.source.shotId);
  if (!shot) return {};
  const slot = placement.source.slotId
    ? shot.slots.find(item => item.id === placement.source.slotId)
    : shot.slots.length === 1 ? shot.slots[0] : undefined;
  const version = placement.source.versionId
    ? slot?.versions.find(item => item.id === placement.source.versionId)
    : slot?.versions.find(item => item.id === slot.selectedVersionId);
  const layer = version?.layers.find(item => item.kind === "video" || item.kind === "image");
  return {
    ...(layer?.assetId ? { assetId: layer.assetId } : shot.previewAssetId ? { assetId: shot.previewAssetId } : {}),
    ...(layer?.prompt || shot.generationPrompt ? { prompt: layer?.prompt ?? shot.generationPrompt } : {}),
    ...(layer?.modelName ? { modelName: layer.modelName } : {}),
    ...(layer?.modelVersion ? { modelVersion: layer.modelVersion } : {}),
  };
}

function projectLayer(placement: CompositionPlacement, project: DionysusProject): CompositionLayer {
  const source = placement.source;
  const legacy = placement.legacyData as Partial<CompositionLayer>;
  const visual = shotVisual(project, placement);
  const assetId = source.type === "asset" || source.type === "clip"
    ? source.assetId : source.type === "shot" ? visual.assetId : undefined;
  return {
    ...legacy,
    id: placement.id, name: placement.name, trackId: placement.trackId,
    kind: layerKind(placement, project), start: placement.start, duration: placement.duration,
    ...(assetId ? { assetId } : {}),
    ...(source.type === "clip" ? { childCompositionId: source.assetId, ...(source.versionId ? { clipVersionId: source.versionId } : {}) } : {}),
    ...(source.type === "script" && source.scriptVersionId ? { scriptVersionId: source.scriptVersionId } : {}),
    ...(source.type === "shot" ? visual : {}),
    ...(placement.sourceIn !== undefined ? { sourceIn: placement.sourceIn } : {}),
    ...(placement.sourceOut !== undefined ? { sourceOut: placement.sourceOut } : {}),
  };
}

/** Keep a lossless canonical document beside compatibility arrays until canonical editing is authoritative. */
export function compositionSnapshotToClipVersion(
  snapshot: CompositionSnapshot,
  project: DionysusProject,
  options: CompositionSnapshotClipVersionOptions,
): ClipVersion {
  const composition = structuredClone(snapshot.composition);
  const tracks: TimelineTrack[] = composition.tracks.map(track => ({
    id: track.id, name: track.name, kind: track.kind,
    ...(track.muted !== undefined ? { muted: track.muted } : {}),
    ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
    ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
    ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
    ...(track.originalKind ? { originalKind: track.originalKind } : {}),
  }));
  return {
    id: options.versionId, name: options.name, description: options.description,
    duration: Math.max(0.1, composition.duration, ...composition.placements.map(item => item.start + item.duration)),
    layers: composition.placements.map(placement => projectLayer(placement, project)),
    tracks,
    compositionDocument: composition,
    scriptVersionIds: [], generationRecords: [],
  };
}
