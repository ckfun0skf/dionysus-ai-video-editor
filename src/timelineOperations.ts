import type { TimelineClip, TimelineTrack } from "./types";

export interface TimelineState {
  tracks: TimelineTrack[];
  timelineClips: TimelineClip[];
}

export function addVideoClip(state: TimelineState, input: {
  id: string; name: string; trackId: string; start: number; duration: number;
  assetId?: string; sourceHasAudio?: boolean; audioTrackId?: string; audioClipId?: string;
}): TimelineState {
  const track = state.tracks.find(item => item.id === input.trackId);
  if (!track || track.kind !== "video") throw new Error("A video clip must use a video track.");
  if (!Number.isFinite(input.start) || input.start < 0 || !Number.isFinite(input.duration) || input.duration <= 0) throw new Error("Clip timing must be finite, with a non-negative start and positive duration.");
  const video: TimelineClip = { id: input.id, name: input.name, kind: "video", trackId: input.trackId, start: input.start, duration: input.duration, ...(input.assetId ? { assetId: input.assetId } : {}) };
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
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  const delta = start - clip.start;
  return { ...state, timelineClips: state.timelineClips.map(item => {
    if (item.id === clipId) return { ...item, start };
    if (clip.kind === "video" && item.kind === "audio" && item.linkedVideoClipId === clipId) return { ...item, start: item.start + delta };
    return item;
  }) };
}

export function trimTimelineClip(state: TimelineState, clipId: string, duration: number): TimelineState {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Clip duration must be finite and positive.");
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) throw new Error("Timeline clip not found.");
  return { ...state, timelineClips: state.timelineClips.map(item => {
    if (item.id === clipId) return { ...item, duration };
    if (clip.kind === "video" && item.kind === "audio" && item.linkedVideoClipId === clipId) return { ...item, duration };
    return item;
  }) };
}

export function unlinkTimelineAudio(state: TimelineState, audioClipId: string): TimelineState {
  const clip = state.timelineClips.find(item => item.id === audioClipId);
  if (!clip || clip.kind !== "audio" || !clip.linkedVideoClipId) throw new Error("Choose linked source audio to unlink.");
  return { ...state, timelineClips: state.timelineClips.map(item => item.id === audioClipId ? (({ linkedVideoClipId: _link, ...unlinked }) => unlinked)(item) : item) };
}

export function deleteTimelineClip(state: TimelineState, clipId: string): TimelineState {
  const clip = state.timelineClips.find(item => item.id === clipId);
  if (!clip) return state;
  return { ...state, timelineClips: state.timelineClips.filter(item => item.id !== clipId && !(clip.kind === "video" && item.kind === "audio" && item.linkedVideoClipId === clipId)) };
}
