import type { TimelineClip, TimelineTrack } from "./types";
import type { CompositionDocument, CompositionPlacement, CompositionSourceReference, CompositionTrack } from "./compositionModel";
import {
  assertValidCompositionDocument,
  deleteCompositionPlacement,
  duplicateCompositionPlacement,
  insertCompositionPlacement,
  moveCompositionPlacement,
  splitCompositionPlacement,
  trimCompositionPlacement,
  unlinkCompositionPlacement,
} from "./compositionCommands";

export interface TimelineState {
  tracks: TimelineTrack[];
  timelineClips: TimelineClip[];
}

function assertUniqueClipIds(clips: TimelineClip[]): void {
  const ids = new Set<string>();
  for (const clip of clips) {
    if (!clip.id.trim() || ids.has(clip.id)) throw new Error("Timeline clip IDs must be non-empty and unique.");
    ids.add(clip.id);
  }
}

function assertValidLinks(clips: TimelineClip[]): void {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  for (const clip of clips) {
    if (clip.linkedVideoClipId === undefined) continue;
    const source = byId.get(clip.linkedVideoClipId);
    if (clip.kind !== "audio" || !source || source.kind !== "video") {
      throw new Error("Linked audio must reference an existing video clip.");
    }
    if (clip.start !== source.start || clip.duration !== source.duration) {
      throw new Error("Linked audio timing must match its source video.");
    }
  }
}


function sourceReferenceForTimelineClip(clip: TimelineClip): CompositionSourceReference {
  if (clip.kind === "clip" && clip.assetId) {
    return { type: "clip", assetId: clip.assetId, ...(clip.clipVersionId ? { versionId: clip.clipVersionId } : {}) };
  }
  if (clip.shotId) return { type: "shot", shotId: clip.shotId, ...(clip.slotId ? { slotId: clip.slotId } : {}) };
  if (clip.assetId) return { type: "asset", assetId: clip.assetId };
  if (clip.scriptVersionId) return { type: "script", scriptVersionId: clip.scriptVersionId };
  return { type: "none" };
}

function placementFromTimelineClip(clip: TimelineClip, order: number): CompositionPlacement {
  return {
    id: clip.id, name: clip.name, trackId: clip.trackId, start: clip.start, duration: clip.duration, order,
    source: sourceReferenceForTimelineClip(clip),
    ...(clip.sourceIn !== undefined ? { sourceIn: clip.sourceIn } : {}),
    ...(clip.sourceOut !== undefined ? { sourceOut: clip.sourceOut } : {}),
    ...(clip.linkedVideoClipId ? { linkedToPlacementId: clip.linkedVideoClipId } : {}),
    legacyData: structuredClone(clip) as unknown as Record<string, unknown>,
  };
}

function compositionDocumentFromTimelineState(state: TimelineState): CompositionDocument {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const tracks: CompositionTrack[] = state.tracks.map((track, order) => {
    const kind: CompositionTrack["kind"] = track.kind === "audio" ? "audio" : track.kind === "text" ? "text" : "video";
    return {
      id: track.id, name: track.name, kind, order,
      ...(track.muted !== undefined ? { muted: track.muted } : {}),
      ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
      ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
      ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
      ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : track.kind !== kind ? { originalKind: track.kind } : {}),
      legacyData: structuredClone(track) as unknown as Record<string, unknown>,
    };
  });
  const placements = state.timelineClips.map((clip, index) => placementFromTimelineClip(clip, index));
  return {
    id: "compat:master-timeline", name: "Timeline",
    duration: Math.max(0, ...placements.map(item => item.start + item.duration)),
    frameRate: 24, width: 1920, height: 1080, tracks, placements,
  };
}

function timelineStateFromCompositionDocument(state: TimelineState, document: CompositionDocument): TimelineState {
  const timelineClips: TimelineClip[] = document.placements.map(placement => {
    const legacy = structuredClone(placement.legacyData) as unknown as Record<string, unknown>;
    const output = {
      ...legacy, id: placement.id, name: placement.name, trackId: placement.trackId,
      start: placement.start, duration: placement.duration,
    } as unknown as TimelineClip;
    if (placement.sourceIn === undefined) delete output.sourceIn;
    else output.sourceIn = placement.sourceIn;
    if (placement.sourceOut === undefined) delete output.sourceOut;
    else output.sourceOut = placement.sourceOut;
    if (placement.linkedToPlacementId === undefined) delete output.linkedVideoClipId;
    else output.linkedVideoClipId = placement.linkedToPlacementId;
    return output;
  });
  return { ...state, timelineClips };
}

function applyCompositionCommand(
  state: TimelineState,
  command: (document: CompositionDocument) => CompositionDocument,
): TimelineState {
  const document = compositionDocumentFromTimelineState(state);
  const next = command(document);
  assertValidCompositionDocument(next);
  return timelineStateFromCompositionDocument(state, next);
}

export function addVideoClip(state: TimelineState, input: {
  id: string; name: string; trackId: string; start: number; duration: number;
  assetId?: string; shotId?: string; slotId?: string; sourceHasAudio?: boolean; audioTrackId?: string; audioClipId?: string;
}): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  if (!input.id.trim() || state.timelineClips.some(clip => clip.id === input.id) || (input.sourceHasAudio && input.audioTrackId && input.audioClipId && (!input.audioClipId.trim() || input.audioClipId === input.id || state.timelineClips.some(clip => clip.id === input.audioClipId)))) {
    throw new Error("Timeline clip IDs must be non-empty and unique.");
  }
  const track = state.tracks.find(item => item.id === input.trackId);
  if (!track || track.kind !== "video") throw new Error("A video clip must use a video track.");
  if (!Number.isFinite(input.start) || input.start < 0 || !Number.isFinite(input.duration) || input.duration <= 0) {
    throw new Error("Clip timing must be finite, with a non-negative start and positive duration.");
  }
  let document = compositionDocumentFromTimelineState(state);
  const video: TimelineClip = {
    id: input.id, name: input.name, kind: "video", trackId: input.trackId, start: input.start, duration: input.duration,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    ...(input.shotId ? { shotId: input.shotId } : {}),
    ...(input.slotId ? { slotId: input.slotId } : {}),
  };
  document = insertCompositionPlacement(document, placementFromTimelineClip(video, document.placements.length));
  if (input.sourceHasAudio && input.audioTrackId && input.audioClipId) {
    const audioTrack = state.tracks.find(item => item.id === input.audioTrackId);
    if (!audioTrack || audioTrack.kind !== "audio") throw new Error("Linked source audio must use an audio track.");
    const audio: TimelineClip = {
      id: input.audioClipId, name: input.name + " audio", kind: "audio",
      trackId: input.audioTrackId, start: input.start, duration: input.duration,
      ...(input.assetId ? { assetId: input.assetId } : {}),
      linkedVideoClipId: video.id,
    };
    document = insertCompositionPlacement(document, placementFromTimelineClip(audio, document.placements.length));
  }
  return timelineStateFromCompositionDocument(state, document);
}

export function moveTimelineClip(state: TimelineState, clipId: string, start: number): TimelineState {
  return applyCompositionCommand(state, document => moveCompositionPlacement(document, clipId, start));
}

export function trimTimelineClip(state: TimelineState, clipId: string, duration: number): TimelineState {
  return applyCompositionCommand(state, document => trimCompositionPlacement(document, clipId, duration));
}

export function splitTimelineClip(state: TimelineState, clipId: string, splitTime: number, input: {
  newClipId: string;
  newLinkedAudioClipIds?: string[];
}): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  if (clip.kind === "audio" && clip.linkedVideoClipId) {
    throw new Error("Split the source video to split linked source audio.");
  }
  const linkedAudio = clip.kind === "video"
    ? state.timelineClips.filter(item => item.kind === "audio" && item.linkedVideoClipId === clip.id)
    : [];
  const newAudioIds = input.newLinkedAudioClipIds ?? [];
  if (newAudioIds.length !== linkedAudio.length ||
      newAudioIds.some(newId => !newId.trim() || newId === input.newClipId || newId === clip.id || state.timelineClips.some(item => item.id === newId)) ||
      new Set(newAudioIds).size !== newAudioIds.length) {
    if (linkedAudio.length) throw new Error("Provide one unique new audio ID for each linked source-audio child.");
    if (newAudioIds.length) throw new Error("Audio IDs were supplied for a clip with no linked source audio.");
  }
  const newPlacementIds: Record<string, string> = { [clip.id]: input.newClipId };
  linkedAudio.forEach((audio, index) => { newPlacementIds[audio.id] = newAudioIds[index]; });
  return applyCompositionCommand(state, document => splitCompositionPlacement(document, clipId, splitTime, { newPlacementIds }));
}

export function unlinkTimelineAudio(state: TimelineState, audioClipId: string): TimelineState {
  return applyCompositionCommand(state, document => unlinkCompositionPlacement(document, audioClipId));
}

export function deleteTimelineClip(state: TimelineState, clipId: string): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  if (!state.timelineClips.some(item => item.id === clipId)) return state;
  return applyCompositionCommand(state, document => deleteCompositionPlacement(document, clipId));
}

export function duplicateTimelineClip(state: TimelineState, clipId: string, input: {
  newClipId: string; newAudioClipId?: string; start?: number;
}): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  if (!input.newClipId.trim() || state.timelineClips.some(item => item.id === input.newClipId)) {
    throw new Error("Timeline clip IDs must be non-empty and unique.");
  }
  const start = input.start ?? clip.start;
  if (!Number.isFinite(start) || start < 0) throw new Error("Clip start must be finite and non-negative.");
  if (clip.kind === "audio" && clip.linkedVideoClipId) {
    throw new Error("Duplicate the source video to copy linked audio as a group.");
  }
  const linkedAudio = clip.kind === "video"
    ? state.timelineClips.filter(item => item.kind === "audio" && item.linkedVideoClipId === clip.id)
    : [];
  if (linkedAudio.length && (!input.newAudioClipId?.trim() ||
      state.timelineClips.some(item => item.id === input.newAudioClipId) || input.newAudioClipId === input.newClipId)) {
    throw new Error("A unique newAudioClipId is required to duplicate linked source audio.");
  }
  const newPlacementIds: Record<string, string> = { [clip.id]: input.newClipId };
  linkedAudio.forEach((audio, index) => {
    const newId = index === 0 ? input.newAudioClipId! : input.newAudioClipId + "-" + (index + 1);
    if (state.timelineClips.some(item => item.id === newId) || newId === input.newClipId ||
        Object.values(newPlacementIds).includes(newId)) {
      throw new Error("Timeline clip IDs must be non-empty and unique.");
    }
    newPlacementIds[audio.id] = newId;
  });
  return applyCompositionCommand(state, document => duplicateCompositionPlacement(document, clipId, { newPlacementIds, start }));
}
