import type { ClipVersion, CompositionLayer, TimelineTrack } from "./types";
import type { CompositionDocument, CompositionPlacement, CompositionSourceReference, CompositionTrack } from "./compositionModel";
import { deleteCompositionPlacement, insertCompositionPlacement, moveCompositionPlacementToTrack } from "./compositionCommands";

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
  return {
    ...normalized,
    tracks: [...(normalized.tracks ?? []), { ...track, kind }],
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
  return { ...next, layers: compositionLayersFromCompositionDocument(inserted) };
}

/** Delete a nested placement through the same command used by the root Timeline. */
export function deleteClipVersionLayer(version: ClipVersion, layerId: string): ClipVersion {
  const normalized = normalizeClipVersionTracks(version);
  const document = compositionDocumentFromClipVersion(normalized);
  if (!document.placements.some(placement => placement.id === layerId)) return normalized;
  const deleted = deleteCompositionPlacement(document, layerId);
  return { ...normalized, layers: compositionLayersFromCompositionDocument(deleted) };
}

/** Move a layer within or between compatible nested tracks. */
function sourceReferenceForLayer(layer: CompositionLayer): CompositionSourceReference {
  if (layer.kind === "composition" && layer.childCompositionId) {
    return { type: "clip", assetId: layer.childCompositionId, ...(layer.clipVersionId ? { versionId: layer.clipVersionId } : {}) };
  }
  if (layer.assetId) return { type: "asset", assetId: layer.assetId };
  if (layer.scriptVersionId) return { type: "script", scriptVersionId: layer.scriptVersionId };
  return { type: "none" };
}

function compositionDocumentFromClipVersion(version: ClipVersion): CompositionDocument {
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
    delete rawOutput.linkedToPlacementId;
    if (placement.linkedToPlacementId === undefined) delete rawOutput.linkedVideoClipId;
    else rawOutput.linkedVideoClipId = placement.linkedToPlacementId;
    return output;
  });
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
  return { ...normalized, layers: compositionLayersFromCompositionDocument(moved) };
}
