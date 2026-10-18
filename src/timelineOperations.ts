import type { TimelineClip, TimelineTrack } from "./types";

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

export function addVideoClip(state: TimelineState, input: {
  id: string; name: string; trackId: string; start: number; duration: number;
  assetId?: string; shotId?: string; slotId?: string; sourceHasAudio?: boolean; audioTrackId?: string; audioClipId?: string;
}): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  if (!input.id.trim() || state.timelineClips.some(clip => clip.id === input.id) || (input.sourceHasAudio && input.audioTrackId && input.audioClipId && (!input.audioClipId.trim() || input.audioClipId === input.id || state.timelineClips.some(clip => clip.id === input.audioClipId)))) throw new Error("Timeline clip IDs must be non-empty and unique.");
  const track = state.tracks.find(item => item.id === input.trackId);
  if (!track || track.kind !== "video") throw new Error("A video clip must use a video track.");
  if (!Number.isFinite(input.start) || input.start < 0 || !Number.isFinite(input.duration) || input.duration <= 0) throw new Error("Clip timing must be finite, with a non-negative start and positive duration.");
  const video: TimelineClip = { id: input.id, name: input.name, kind: "video", trackId: input.trackId, start: input.start, duration: input.duration, ...(input.assetId ? { assetId: input.assetId } : {}), ...(input.shotId ? { shotId: input.shotId } : {}), ...(input.slotId ? { slotId: input.slotId } : {}) };
  const clips = [...state.timelineClips, video];
  if (input.sourceHasAudio && input.audioTrackId && input.audioClipId) {
    const audioTrack = state.tracks.find(item => item.id === input.audioTrackId);
    if (!audioTrack || audioTrack.kind !== "audio") throw new Error("Linked source audio must use an audio track.");
    clips.push({ id: input.audioClipId, name: input.name + " audio", kind: "audio", trackId: input.audioTrackId, start: input.start, duration: input.duration, ...(input.assetId ? { assetId: input.assetId } : {}), linkedVideoClipId: video.id });
  }
  return { ...state, timelineClips: clips };
}

export function moveTimelineClip(state: TimelineState, clipId: string, start: number): TimelineState {
  if (!Number.isFinite(start) || start < 0) throw new Error("Clip start must be finite and non-negative.");
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  const linkedSourceId = clip.kind === "audio" ? clip.linkedVideoClipId : undefined;
  const sourceId = linkedSourceId ?? (clip.kind === "video" ? clip.id : undefined);
  const source = sourceId ? state.timelineClips.find(item => item.id === sourceId) : undefined;
  const delta = start - clip.start;
  return { ...state, timelineClips: state.timelineClips.map(item => {
    if (item.id === clipId || (source && item.id === source.id)) return { ...item, start: item.id === clipId ? start : item.start + delta };
    if (sourceId && item.kind === "audio" && item.linkedVideoClipId === sourceId) return { ...item, start: item.start + delta };
    return item;
  }) };
}

export function trimTimelineClip(state: TimelineState, clipId: string, duration: number): TimelineState {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Clip duration must be finite and positive.");
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  const sourceId = clip.kind === "audio" ? clip.linkedVideoClipId : clip.id;
  return { ...state, timelineClips: state.timelineClips.map(item => {
    if (item.id === clipId || (sourceId && item.id === sourceId)) return { ...item, duration };
    if (sourceId && item.kind === "audio" && item.linkedVideoClipId === sourceId) return { ...item, duration };
    return item;
  }) };
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
  const end = clip.start + clip.duration;
  if (!Number.isFinite(splitTime) || splitTime <= clip.start || splitTime >= end) {
    throw new Error("Split point must fall strictly inside the clip.");
  }
  if (!input.newClipId.trim() || input.newClipId === clip.id || state.timelineClips.some(item => item.id === input.newClipId)) {
    throw new Error("Split clip ID must be non-empty, unique, and different from the source ID.");
  }

  const linkedAudio = clip.kind === "video"
    ? state.timelineClips.filter(item => item.kind === "audio" && item.linkedVideoClipId === clip.id)
    : [];
  const newAudioIds = input.newLinkedAudioClipIds ?? [];
  if (newAudioIds.length !== linkedAudio.length ||
      newAudioIds.some(id => !id.trim() || id === input.newClipId || id === clip.id || state.timelineClips.some(item => item.id === id)) ||
      new Set(newAudioIds).size !== newAudioIds.length) {
    if (linkedAudio.length) throw new Error("Provide one unique new audio ID for each linked source-audio child.");
    if (newAudioIds.length) throw new Error("Audio IDs were supplied for a clip with no linked source audio.");
  }

  const splitPair = (source: TimelineClip, newId: string) => {
    const leftDuration = splitTime - source.start;
    const rightDuration = source.duration - leftDuration;
    let leftSource: Partial<TimelineClip> = {};
    let rightSource: Partial<TimelineClip> = {};
    if (source.kind === "video" || source.kind === "audio") {
      const sourceIn = source.sourceIn ?? 0;
      const sourceOut = source.sourceOut ?? sourceIn + source.duration;
      if (Math.abs((sourceOut - sourceIn) - source.duration) > 0.001) {
        throw new Error("Source range length must match clip duration before splitting.");
      }
      const middleSource = sourceIn + leftDuration;
      // Materialize implicit source ranges at split time so the right segment resumes
      // from the split point instead of silently replaying from source time zero.
      leftSource = { sourceIn, sourceOut: middleSource };
      rightSource = { sourceIn: middleSource, sourceOut };
    }
    return {
      left: {
        ...source, duration: leftDuration, ...leftSource,
        ...(source.fadeIn !== undefined ? { fadeIn: Math.min(source.fadeIn, leftDuration) } : {}),
        fadeOut: undefined
      },
      right: {
        ...source, id: newId, name: source.name + " (2)", start: splitTime, duration: rightDuration, ...rightSource,
        fadeIn: undefined,
        ...(source.fadeOut !== undefined ? { fadeOut: Math.min(source.fadeOut, rightDuration) } : {})
      }
    };
  };

  const videoPair = splitPair(clip, input.newClipId);
  const audioSourceIn = clip.sourceIn ?? 0;
  const audioSourceOut = clip.sourceOut ?? audioSourceIn + clip.duration;
  const audioPairs = linkedAudio.map((audio, index) => ({
    originalId: audio.id,
    ...splitPair({ ...audio, sourceIn: audioSourceIn, sourceOut: audioSourceOut }, newAudioIds[index]),
    rightLinkedVideoClipId: input.newClipId
  }));
  const leftAudioById = new Map(audioPairs.map(pair => [pair.originalId, pair.left]));
  const nextClips = state.timelineClips.map(item => {
    if (item.id === clip.id) return videoPair.left;
    const leftAudio = leftAudioById.get(item.id);
    return leftAudio ?? item;
  });
  const rightAudioClips = audioPairs.map(pair => ({
    ...pair.right,
    linkedVideoClipId: pair.rightLinkedVideoClipId
  }));
  return {
    ...state,
    timelineClips: [...nextClips, videoPair.right, ...rightAudioClips]
  };
}

export function unlinkTimelineAudio(state: TimelineState, audioClipId: string): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === audioClipId);
  if (!clip || clip.kind !== "audio" || !clip.linkedVideoClipId) throw new Error("Choose linked source audio to unlink.");
  return { ...state, timelineClips: state.timelineClips.map(item => item.id === audioClipId ? (({ linkedVideoClipId: _link, ...unlinked }) => unlinked)(item) : item) };
}

export function deleteTimelineClip(state: TimelineState, clipId: string): TimelineState {
  assertUniqueClipIds(state.timelineClips);
  assertValidLinks(state.timelineClips);
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) return state;
  return { ...state, timelineClips: state.timelineClips.filter(item => item.id !== clipId && !(clip.kind === "video" && item.kind === "audio" && item.linkedVideoClipId === clipId)) };
}

/** Duplicate a video and its linked source audio as a new, internally consistent group. */
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
  const copy: TimelineClip = { ...clip, id: input.newClipId, start };
  const additions: TimelineClip[] = [copy];
  if (clip.kind === "video") {
    const linkedAudio = state.timelineClips.filter(item => item.kind === "audio" && item.linkedVideoClipId === clip.id);
    if (linkedAudio.length && (!input.newAudioClipId?.trim() || state.timelineClips.some(item => item.id === input.newAudioClipId) || input.newAudioClipId === input.newClipId)) {
      throw new Error("A unique newAudioClipId is required to duplicate linked source audio.");
    }
    linkedAudio.forEach((audio, index) => {
      const audioId = index === 0 ? input.newAudioClipId! : `${input.newAudioClipId}-${index + 1}`;
      if (state.timelineClips.some(item => item.id === audioId) || additions.some(item => item.id === audioId)) {
        throw new Error("Timeline clip IDs must be non-empty and unique.");
      }
      additions.push({ ...audio, id: audioId, start, duration: clip.duration, linkedVideoClipId: copy.id });
    });
  }
  return { ...state, timelineClips: [...state.timelineClips, ...additions] };
}
