import type { ClipVersion, CompositionLayer, TimelineTrack } from "./types";
import type { CompositionDocument, CompositionPlacement, CompositionSourceReference, CompositionTrack } from "./compositionModel";
import { applyCompositionResizePreview, deleteCompositionPlacement, insertCompositionPlacement, moveCompositionPlacementToTrack, updateCompositionPlacement, updateCompositionTrack, type CompositionResizePreview } from "./compositionCommands";

export type CanonicalNestedTrackKind = "video" | "audio" | "text";

export function nestedTrackKind(layer: CompositionLayer): CanonicalNestedTrackKind {
  if (layer.kind === "audio") return "audio";
  if (layer.kind === "text") return "text";
  return "video";
}

function canonicalTrackKind(kind: TimelineTrack["kind"]): CanonicalNestedTrackKind {
  if (kind === "audio") return "audio";
  if (kind === "text") return "text";
  return "video";
}

/** Additive, deterministic schema-1.0 migration: nested Clip Versions gain explicit tracks and
 * every layer gets a trackId. Existing valid track IDs and ordering are preserved. */
export function normalizeClipVersionTracks(version: ClipVersion): ClipVersion {
  if (version.composition) {
    const composition = structuredClone(version.composition);
    const tracks: TimelineTrack[] = composition.tracks.map(track => ({
      ...structuredClone(track.legacyData ?? {}),
      id: track.id,
      name: track.name,
      kind: track.kind,
      ...(track.muted !== undefined ? { muted: track.muted } : {}),
      ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
      ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
      ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
      ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : {}),
    } as TimelineTrack));
    const layers = compositionLayersFromCompositionDocument(composition);
    return { ...version, duration: Math.max(version.duration, composition.duration), tracks, layers };
  }
  const tracks: TimelineTrack[] = (version.tracks ?? []).map(track => {
    const kind = canonicalTrackKind(track.kind);
    return {
      ...track,
      kind,
      ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : track.kind !== kind ? { originalKind: track.kind } : {}),
    };
  });
  const ensureTrack = (kind: CanonicalNestedTrackKind): TimelineTrack => {
    const existing = tracks.find(track => track.kind === kind);
    if (existing) return existing;
    const track: TimelineTrack = {
      id: `clip-track:${version.id}:${kind}`,
      name: kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text",
      kind,
    };
    tracks.push(track);
    return track;
  };
  const layers = version.layers.map(layer => {
    const kind = nestedTrackKind(layer);
    const existing = layer.trackId ? tracks.find(track => track.id === layer.trackId && track.kind === kind) : undefined;
    const track = existing ?? ensureTrack(kind);
    return { ...layer, trackId: track.id };
  });
  return { ...version, tracks, layers };
}

export function addClipVersionTrack(
  version: ClipVersion,
  track: TimelineTrack,
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const kind = canonicalTrackKind(track.kind);
  if (normalized.tracks?.some(item => item.id === track.id)) {
    throw new Error("Track ID already exists in this Clip Version.");
  }
  const nextTrack = { ...track, kind };
  const composition = compositionDocumentFromClipVersion(normalized);
  const compositionTrack: CompositionTrack = {
    id: nextTrack.id, name: nextTrack.name, kind, order: composition.tracks.length,
    ...(nextTrack.muted !== undefined ? { muted: nextTrack.muted } : {}),
    ...(nextTrack.backgroundColor !== undefined ? { backgroundColor: nextTrack.backgroundColor } : {}),
    ...(nextTrack.backgroundTransparent !== undefined ? { backgroundTransparent: nextTrack.backgroundTransparent } : {}),
    ...(nextTrack.opacity !== undefined ? { opacity: nextTrack.opacity } : {}),
    ...(nextTrack.originalKind !== undefined ? { originalKind: nextTrack.originalKind } : {}),
    legacyData: structuredClone(nextTrack) as unknown as Record<string, unknown>,
  };
  const updatedComposition = { ...composition, tracks: [...composition.tracks, compositionTrack] };
  return { ...normalized, tracks: [...(normalized.tracks ?? []), nextTrack], composition: updatedComposition };
}

/** Materialize an independent canonical Composition even for an empty nested Version. */
export function ensureClipVersionComposition(
  version: ClipVersion,
  dimensions?: { width: number; height: number },
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const document = compositionDocumentFromClipVersion(normalized);
  const sizedDocument = !normalized.composition && dimensions
    ? { ...document, width: dimensions.width, height: dimensions.height }
    : document;
  return versionWithComposition(normalized, sizedDocument);
}

/** Update a nested track through the canonical Composition command and refresh its compatibility projection. */
export function updateClipVersionTrack(
  version: ClipVersion,
  trackId: string,
  patch: Partial<Pick<TimelineTrack, "name" | "muted" | "backgroundColor" | "backgroundTransparent" | "opacity">>,
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const track = normalized.tracks?.find(item => item.id === trackId);
  if (!track) throw new Error("Clip Version track not found.");
  const document = compositionDocumentFromClipVersion(normalized);
  const canonicalTrack = document.tracks.find(item => item.id === trackId);
  if (!canonicalTrack) throw new Error("Clip Version Composition track not found.");
  const legacyData = { ...(canonicalTrack.legacyData ?? {}), ...structuredClone(patch) };
  const updated = updateCompositionTrack(document, trackId, {
    ...structuredClone(patch),
    legacyData,
  });
  return versionWithComposition(normalized, updated);
}

/** Update nested Version duration in the canonical Composition and its compatibility projection. */
export function updateClipVersionDuration(version: ClipVersion, duration: number): ClipVersion {
  if (!Number.isFinite(duration) || duration < 0.1) {
    throw new Error("Clip Version duration must be finite and at least 0.1 seconds.");
  }
  const normalized = normalizeClipVersionTracks(version);
  const document = compositionDocumentFromClipVersion(normalized);
  const updatedComposition = { ...document, duration };
  return {
    ...versionWithComposition({ ...normalized, duration }, updatedComposition),
    duration,
  };
}

/** Keep nested Version description metadata aligned with an existing canonical Composition snapshot. */
export function updateClipVersionDescription(version: ClipVersion, description: string): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  if (!normalized.composition) return { ...normalized, description };
  return {
    ...normalized,
    description,
    composition: {
      ...structuredClone(normalized.composition),
      legacyData: {
        ...(normalized.composition.legacyData ?? {}),
        description,
      },
    },
  };
}

/** Add a source placement to a compatible track, creating a deterministic default if needed. */
export function addClipVersionLayer(
  version: ClipVersion,
  layer: CompositionLayer,
  targetTrackId?: string,
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const kind = nestedTrackKind(layer);
  const target = targetTrackId
    ? normalized.tracks?.find(track => track.id === targetTrackId && track.kind === kind)
    : normalized.tracks?.find(track => track.kind === kind);
  let next = normalized;
  let track = target;
  if (!track) {
    if (targetTrackId) throw new Error("The selected track cannot contain this source type.");
    track = {
      id: `clip-track:${version.id}:${kind}:${(normalized.tracks?.length ?? 0) + 1}`,
      name: kind === "video" ? "Video " + ((normalized.tracks ?? []).filter(item => item.kind === "video").length + 1)
        : kind === "audio" ? "Audio " + ((normalized.tracks ?? []).filter(item => item.kind === "audio").length + 1)
        : "Text " + ((normalized.tracks ?? []).filter(item => item.kind === "text").length + 1),
      kind,
    };
    next = { ...normalized, tracks: [...(normalized.tracks ?? []), track] };
    if (normalized.composition) {
      const canonicalTrack: CompositionTrack = {
        id: track.id,
        name: track.name,
        kind,
        order: normalized.composition.tracks.length,
        ...(track.muted !== undefined ? { muted: track.muted } : {}),
        ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
        ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
        ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
        ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : {}),
        legacyData: structuredClone(track) as unknown as Record<string, unknown>,
      };
      next = {
        ...next,
        composition: {
          ...structuredClone(normalized.composition),
          tracks: [...normalized.composition.tracks, canonicalTrack],
        },
      };
    }
  }

  const document = compositionDocumentFromClipVersion(next);
  const legacyData = structuredClone(layer) as unknown as Record<string, unknown>;
  const linkedToPlacementId = typeof legacyData.linkedToPlacementId === "string"
    ? legacyData.linkedToPlacementId
    : typeof legacyData.linkedVideoClipId === "string" ? legacyData.linkedVideoClipId : undefined;
  const inserted = insertCompositionPlacement(document, {
    id: layer.id,
    name: layer.name,
    trackId: track.id,
    start: layer.start,
    duration: layer.duration,
    order: document.placements.length,
    source: sourceReferenceForLayer(layer),
    ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}),
    ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}),
    ...(linkedToPlacementId ? { linkedToPlacementId } : {}),
    legacyData,
  });
  return versionWithComposition(next, inserted);
}

/** Delete a nested placement through the same command used by the root Timeline. */
export function deleteClipVersionLayer(version: ClipVersion, layerId: string): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const document = compositionDocumentFromClipVersion(normalized);
  if (!document.placements.some(placement => placement.id === layerId)) return normalized;
  const deleted = deleteCompositionPlacement(document, layerId);
  return versionWithComposition(normalized, deleted);
}

/** Move a layer within or between compatible nested tracks. */
function sourceReferenceForLayer(layer: CompositionLayer): CompositionSourceReference {
  const metadata = layer as unknown as Record<string, unknown>;
  if (typeof metadata.shotId === "string") {
    return {
      type: "shot",
      shotId: metadata.shotId,
      ...(typeof metadata.slotId === "string" ? { slotId: metadata.slotId } : {}),
      ...(typeof metadata.shotVersionId === "string" ? { versionId: metadata.shotVersionId } : {}),
    };
  }
  if (layer.kind === "composition" && layer.childCompositionId) {
    return { type: "clip", assetId: layer.childCompositionId, ...(layer.clipVersionId ? { versionId: layer.clipVersionId } : {}) };
  }
  if (layer.scriptVersionId || layer.kind === "script" || layer.kind === "procedural") {
    return {
      type: "script",
      ...(layer.assetId ? { assetId: layer.assetId } : {}),
      ...(layer.scriptVersionId ? { scriptVersionId: layer.scriptVersionId } : {}),
    };
  }
  if (layer.assetId) return { type: "asset", assetId: layer.assetId };
  return { type: "none" };
}

function compositionDocumentFromClipVersion(version: ClipVersion): CompositionDocument {
  if (version.composition) return structuredClone(version.composition);
  const normalized = normalizeClipVersionTracks(version);
  const tracks: CompositionTrack[] = (normalized.tracks ?? []).map((track, order) => ({
    id: track.id,
    name: track.name,
    kind: track.kind === "audio" ? "audio" : track.kind === "text" ? "text" : "video",
    order,
    ...(track.muted !== undefined ? { muted: track.muted } : {}),
    ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
    ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
    ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
    ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : {}),
    legacyData: structuredClone(track) as unknown as Record<string, unknown>,
  }));
  const placements: CompositionPlacement[] = normalized.layers.map((layer, order) => {
    const legacy = structuredClone(layer) as unknown as Record<string, unknown>;
    const linkedToPlacementId = typeof legacy.linkedToPlacementId === "string"
      ? legacy.linkedToPlacementId
      : typeof legacy.linkedVideoClipId === "string" ? legacy.linkedVideoClipId : undefined;
    const trackKind = layer.kind === "audio" ? "audio" : layer.kind === "text" ? "text" : "video";
    return {
      id: layer.id,
      name: layer.name,
      trackId: layer.trackId ?? tracks.find(track => track.kind === trackKind)?.id ?? "",
      start: layer.start,
      duration: layer.duration,
      order,
      source: sourceReferenceForLayer(layer),
      ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}),
      ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}),
      ...(linkedToPlacementId ? { linkedToPlacementId } : {}),
      legacyData: legacy,
    };
  });
  return {
    id: "compat:clip-version:" + version.id,
    name: version.name,
    duration: version.duration,
    frameRate: 24,
    width: 1920,
    height: 1080,
    tracks,
    placements,
  };
}

function compositionLayersFromCompositionDocument(document: CompositionDocument): CompositionLayer[] {
  return document.placements.map(placement => {
    const legacy = structuredClone(placement.legacyData) as unknown as Record<string, unknown>;
    const output = {
      ...legacy,
      id: placement.id,
      name: placement.name,
      trackId: placement.trackId,
      start: placement.start,
      duration: placement.duration,
    } as unknown as CompositionLayer;
    if (placement.sourceIn === undefined) delete output.sourceIn;
    else output.sourceIn = placement.sourceIn;
    if (placement.sourceOut === undefined) delete output.sourceOut;
    else output.sourceOut = placement.sourceOut;
    const rawOutput = output as unknown as Record<string, unknown>;
    if (placement.source.type === "asset") rawOutput.assetId = placement.source.assetId;
    else if (placement.source.type === "clip") {
      rawOutput.childCompositionId = placement.source.assetId;
      rawOutput.assetId = placement.source.assetId;
      if (placement.source.versionId !== undefined) rawOutput.clipVersionId = placement.source.versionId;
    } else if (placement.source.type === "shot") {
      rawOutput.shotId = placement.source.shotId;
      if (placement.source.slotId !== undefined) rawOutput.slotId = placement.source.slotId;
      if (placement.source.versionId !== undefined) rawOutput.shotVersionId = placement.source.versionId;
    } else if (placement.source.type === "script") {
      if (placement.source.assetId !== undefined) rawOutput.assetId = placement.source.assetId;
      if (placement.source.scriptVersionId !== undefined) rawOutput.scriptVersionId = placement.source.scriptVersionId;
    }
    delete rawOutput.linkedToPlacementId;
    if (placement.linkedToPlacementId === undefined) delete rawOutput.linkedVideoClipId;
    else rawOutput.linkedVideoClipId = placement.linkedToPlacementId;
    return output;
  });
}

/** Keep canonical Composition authoritative; legacy layers/tracks are derived projections for rendering and older UI. */
function versionWithComposition(version: ClipVersion, composition: CompositionDocument): ClipVersion {
  const projectedTracks: TimelineTrack[] = composition.tracks.map(track => ({
    ...structuredClone(track.legacyData ?? {}),
    id: track.id,
    name: track.name,
    kind: track.kind,
    ...(track.muted !== undefined ? { muted: track.muted } : {}),
    ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
    ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
    ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
    ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : {}),
  } as TimelineTrack));
  return {
    ...version,
    duration: Math.max(version.duration, composition.duration),
    composition: structuredClone(composition),
    tracks: projectedTracks,
    layers: compositionLayersFromCompositionDocument(composition),
  };
}

/** Update inspector-controlled layer fields in the canonical placement and refresh the legacy render projection. */
export function updateClipVersionLayer(
  version: ClipVersion,
  layerId: string,
  patch: Partial<CompositionLayer>,
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const existingLayer = normalized.layers.find(layer => layer.id === layerId);
  if (!existingLayer) return normalized;
  const updatedLayer = { ...existingLayer, ...structuredClone(patch) };
  const document = compositionDocumentFromClipVersion(normalized);
  const placement = document.placements.find(item => item.id === layerId);
  if (!placement) return normalized;
  const legacy = structuredClone(updatedLayer) as unknown as Record<string, unknown>;
  const linkedToPlacementId = typeof legacy.linkedToPlacementId === "string"
    ? legacy.linkedToPlacementId
    : typeof legacy.linkedVideoClipId === "string" ? legacy.linkedVideoClipId : undefined;
  // Inspector edits must cross the same validated immutable command boundary as
  // timeline operations. This keeps canonical geometry/source fields and their legacy
  // projection synchronized, and validates track/placement invariants on every edit.
  const nextDocument = updateCompositionPlacement(document, layerId, {
    name: updatedLayer.name,
    trackId: updatedLayer.trackId ?? placement.trackId,
    start: updatedLayer.start,
    duration: updatedLayer.duration,
    source: ["assetId", "childCompositionId", "clipVersionId", "scriptVersionId", "shotId", "slotId", "shotVersionId", "kind"]
      .some(key => Object.prototype.hasOwnProperty.call(patch, key))
      ? sourceReferenceForLayer(updatedLayer)
      : placement.source,
    sourceIn: updatedLayer.sourceIn,
    sourceOut: updatedLayer.sourceOut,
    linkedToPlacementId,
    legacyData: { ...placement.legacyData, ...legacy },
  });
  return versionWithComposition(normalized, nextDocument);
}

/** Move a nested layer through the same Composition command used by the Master Timeline adapter. */
export function moveClipVersionLayer(
  version: ClipVersion,
  layerId: string,
  targetTrackId: string,
  start: number,
): ClipVersion {
  if (!Number.isFinite(start) || start < 0) throw new Error("Layer start must be finite and non-negative.");
  const normalized = normalizeClipVersionTracks(version);
  const layer = normalized.layers.find(item => item.id === layerId);
  const target = normalized.tracks?.find(item => item.id === targetTrackId);
  if (!layer || !target) throw new Error("Layer or destination track was not found.");
  if (nestedTrackKind(layer) !== target.kind) throw new Error("This source type cannot be moved to the selected track.");
  const nextStart = Math.min(start, Math.max(0, normalized.duration - layer.duration));
  const moved = moveCompositionPlacementToTrack(
    compositionDocumentFromClipVersion(normalized),
    layerId,
    targetTrackId,
    nextStart,
  );
  return versionWithComposition(normalized, moved);
}

/** Commit nested resize and adjacent-trim previews through the shared Composition command. */
export function applyClipVersionResizePreview(
  version: ClipVersion,
  preview: CompositionResizePreview,
): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const resized = applyCompositionResizePreview(compositionDocumentFromClipVersion(normalized), preview);
  return versionWithComposition(normalized, resized);
}

/**
 * Duplicate the editable top-level Clip Version without aliasing canonical placement/track IDs.
 * Nested Composition documents remain pinned snapshots; only references to the duplicated
 * document's own tracks and placements are remapped.
 */
export function duplicateClipVersionComposition(
  version: ClipVersion,
  createId: (kind: "clip-track" | "layer" | "composition", previousId: string) => string,
): ClipVersion {
  const normalized = ensureClipVersionComposition(version);
  const source = structuredClone(normalized.composition!);
  const trackIds = new Map(source.tracks.map(track => [track.id, createId("clip-track", track.id)]));
  const placementIds = new Map(source.placements.map(placement => [placement.id, createId("layer", placement.id)]));
  const composition = {
    ...source,
    id: createId("composition", source.id),
    tracks: source.tracks.map(track => ({
      ...track,
      id: trackIds.get(track.id)!,
      legacyData: { ...(track.legacyData ?? {}), id: trackIds.get(track.id)! },
    })),
    placements: source.placements.map(placement => {
      const nextId = placementIds.get(placement.id)!;
      const linked = placement.linkedToPlacementId ? placementIds.get(placement.linkedToPlacementId) ?? placement.linkedToPlacementId : undefined;
      const legacyData: Record<string, unknown> = { ...placement.legacyData, id: nextId, trackId: trackIds.get(placement.trackId) ?? placement.trackId };
      if (typeof legacyData.linkedVideoClipId === "string") legacyData.linkedVideoClipId = placementIds.get(legacyData.linkedVideoClipId) ?? legacyData.linkedVideoClipId;
      if (typeof legacyData.linkedToPlacementId === "string") legacyData.linkedToPlacementId = placementIds.get(legacyData.linkedToPlacementId) ?? legacyData.linkedToPlacementId;
      return {
        ...placement,
        id: nextId,
        trackId: trackIds.get(placement.trackId) ?? placement.trackId,
        ...(linked ? { linkedToPlacementId: linked } : { linkedToPlacementId: undefined }),
        legacyData,
      };
    }),
  };
  return versionWithComposition(normalized, composition);
}
