import type { ClipVersion, CompositionLayer, TimelineTrack } from "./types";

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
  return {
    ...next,
    layers: [...next.layers, { ...layer, trackId: track.id }],
  };
}

/** Move a layer within or between compatible nested tracks. */
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
  return {
    ...normalized,
    layers: normalized.layers.map(item => item.id === layerId ? { ...item, trackId: targetTrackId, start: Math.min(start, Math.max(0, normalized.duration - item.duration)) } : item),
  };
}
