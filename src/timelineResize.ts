import type { TimelineClip } from "./types";

export type ResizeEdge = "left" | "right";
export interface ClipResizeTrim {
  id: string;
  start: number;
  duration: number;
  edge: ResizeEdge;
}
export interface ClipResizePreview {
  id: string;
  trackId: string;
  edge: ResizeEdge;
  start: number;
  duration: number;
  trims: ClipResizeTrim[];
  overlap?: { start: number; duration: number };
}

const epsilon = 1e-6;
const snapFrame = (seconds: number, fps: number) => Math.round(seconds * fps) / fps;

/** Calculate an immutable drag preview, including the adjacent clip's planned trim. */
export function calculateTimelineClipResizePreview(
  clips: TimelineClip[],
  clipId: string,
  edge: ResizeEdge,
  deltaSeconds: number,
  timelineDuration: number,
  fps: number
): ClipResizePreview | null {
  const clip = clips.find(item => item.id === clipId);
  if (!clip || !Number.isFinite(deltaSeconds) || !Number.isFinite(timelineDuration) || timelineDuration <= 0) return null;

  const rate = Math.max(1, Number.isFinite(fps) ? fps : 24);
  const frame = 1 / rate;
  const oldStart = clip.start;
  const oldEnd = clip.start + clip.duration;
  const sameTrack = clips.filter(item => item.trackId === clip.trackId && item.id !== clipId);
  const trims: ClipResizeTrim[] = [];
  let start = oldStart;
  let end = oldEnd;
  let overlap: { start: number; duration: number } | undefined;

  if (edge === "right") {
    end = snapFrame(Math.max(oldStart + frame, Math.min(timelineDuration, oldEnd + deltaSeconds)), rate);
    const next = sameTrack.filter(item => item.start >= oldEnd - epsilon).sort((a, b) => a.start - b.start)[0];
    if (next && end > next.start + epsilon) {
      const nextEnd = next.start + next.duration;
      end = Math.min(end, nextEnd - frame);
      end = Math.max(oldEnd + frame, end);
      end = snapFrame(Math.min(timelineDuration, end), rate);
      const trimStart = Math.max(next.start + frame, end);
      if (trimStart > next.start + epsilon) {
        trims.push({ id: next.id, start: trimStart, duration: Math.max(frame, snapFrame(nextEnd - trimStart, rate)), edge: "left" });
        overlap = { start: next.start, duration: Math.max(0, Math.min(end, nextEnd) - next.start) };
      }
    }
  } else {
    start = snapFrame(Math.max(0, Math.min(oldEnd - frame, oldStart + deltaSeconds)), rate);
    // Explicit source ranges cannot be extended beyond their known source-in point.
    if (clip.sourceIn !== undefined) start = Math.max(start, snapFrame(oldStart - clip.sourceIn, rate));
    const previous = sameTrack.filter(item => item.start + item.duration <= oldStart + epsilon).sort((a, b) => b.start - a.start)[0];
    if (previous && start < previous.start + previous.duration - epsilon) {
      start = Math.max(start, previous.start + frame);
      start = snapFrame(start, rate);
      const previousEnd = previous.start + previous.duration;
      if (start < oldStart - epsilon) {
        trims.push({ id: previous.id, start: previous.start, duration: Math.max(frame, snapFrame(start - previous.start, rate)), edge: "right" });
        overlap = { start, duration: Math.max(0, Math.min(oldStart, previousEnd) - start) };
      }
    }
  }

  start = Math.max(0, start);
  end = Math.min(timelineDuration, Math.max(start + frame, end));
  const nextStart = edge === "left" ? start : oldStart;
  const nextDuration = edge === "left" ? oldEnd - start : end - oldStart;
  return {
    id: clip.id, trackId: clip.trackId, edge, start: snapFrame(nextStart, rate),
    duration: Math.max(frame, snapFrame(nextDuration, rate)), trims,
    ...(overlap && overlap.duration > epsilon ? { overlap } : {})
  };
}

/** Commit a resize preview atomically, updating explicit source ranges and linked audio. */
export function applyTimelineClipResize(clips: TimelineClip[], preview: ClipResizePreview, fps: number): TimelineClip[] {
  const rate = Math.max(1, Number.isFinite(fps) ? fps : 24);
  const updates = new Map<string, { start: number; duration: number; edge: ResizeEdge }>();
  updates.set(preview.id, { start: preview.start, duration: preview.duration, edge: preview.edge });
  for (const trim of preview.trims) updates.set(trim.id, { start: trim.start, duration: trim.duration, edge: trim.edge });

  const changed = clips.map(clip => {
    const update = updates.get(clip.id);
    if (!update) return clip;
    const deltaStart = update.start - clip.start;
    const hasSourceRange = clip.sourceIn !== undefined || clip.sourceOut !== undefined;
    const sourceIn = !hasSourceRange
      ? undefined
      : update.edge === "left" ? Math.max(0, (clip.sourceIn ?? 0) + deltaStart) : clip.sourceIn;
    const sourceOut = !hasSourceRange
      ? undefined
      : update.edge === "right" ? (sourceIn ?? clip.sourceIn ?? 0) + update.duration : clip.sourceOut;
    return {
      ...clip,
      start: snapFrame(update.start, rate),
      duration: Math.max(1 / rate, snapFrame(update.duration, rate)),
      ...(sourceIn !== undefined ? { sourceIn } : {}),
      ...(sourceOut !== undefined ? { sourceOut } : {})
    };
  });

  const changedVideos = new Set([...updates.keys()].filter(id => clips.find(item => item.id === id)?.kind === "video"));
  return changed.map(clip => {
    if (clip.kind !== "audio" || !clip.linkedVideoClipId || !changedVideos.has(clip.linkedVideoClipId)) return clip;
    const video = changed.find(item => item.id === clip.linkedVideoClipId);
    if (!video) return clip;
    return {
      ...clip,
      start: video.start,
      duration: video.duration,
      ...(video.sourceIn !== undefined ? { sourceIn: video.sourceIn } : {}),
      ...(video.sourceOut !== undefined ? { sourceOut: video.sourceOut } : {})
    };
  });
}
