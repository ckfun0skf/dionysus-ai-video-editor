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
  const tracks: TimelineTrack[] = (version.tracks ?? []).map(track => ({
    ...track,
    kind: canonicalTrackKind(track.kind),
  }));
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
