import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "./types";
import { addVideoClip, deleteTimelineClip, moveTimelineClip, trimTimelineClip, unlinkTimelineAudio } from "./timelineOperations";

const tracks: TimelineTrack[] = [
  { id: "v1", name: "Video 1", kind: "video" },
  { id: "v2", name: "Video 2", kind: "video" },
  { id: "a1", name: "Audio 1", kind: "audio" },
];
const empty = { tracks, timelineClips: [] };

describe("linked multi-track timeline operations", () => {
  it("adds source audio linked to its video by default when the source has audio", () => {
    const state = addVideoClip(empty, { id: "v-clip", name: "Interview", trackId: "v1", start: 2, duration: 8, assetId: "media-1", sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a-clip" });
    expect(state.timelineClips).toEqual([
      { id: "v-clip", name: "Interview", kind: "video", trackId: "v1", start: 2, duration: 8, assetId: "media-1" },
      { id: "a-clip", name: "Interview audio", kind: "audio", trackId: "a1", start: 2, duration: 8, assetId: "media-1", linkedVideoClipId: "v-clip" },
    ]);
  });

  it("moves linked audio with the source video", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const moved = moveTimelineClip(state, "v", 4);
    expect(moved.timelineClips.find(c => c.id === "v")?.start).toBe(4);
    expect(moved.timelineClips.find(c => c.id === "a")?.start).toBe(4);
  });

  it("allows unlinked audio to move and trim independently", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const unlinked = unlinkTimelineAudio(state, "a");
    const moved = moveTimelineClip(unlinked, "a", 9);
    const trimmed = trimTimelineClip(moved, "a", 2);
    expect(trimmed.timelineClips.find(c => c.id === "a")).toMatchObject({ start: 9, duration: 2 });
    expect(trimmed.timelineClips.find(c => c.id === "v")).toMatchObject({ start: 1, duration: 5 });
    expect(trimmed.timelineClips.find(c => c.id === "a")).not.toHaveProperty("linkedVideoClipId");
  });

  it("trims linked audio with its video", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const trimmed = trimTimelineClip(state, "v", 3);
    expect(trimmed.timelineClips.find(c => c.id === "a")?.duration).toBe(3);
  });

  it("deletes linked source audio together with its video but preserves detached audio", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const withDetached = unlinkTimelineAudio(state, "a");
    const result = deleteTimelineClip(withDetached, "v");
    expect(result.timelineClips.map(c => c.id)).toEqual(["a"]);
  });

  it("rejects invalid ranges and wrong track kinds", () => {
    expect(() => addVideoClip(empty, { id: "bad", name: "Bad", trackId: "a1", start: 0, duration: 2 })).toThrow();
    expect(() => moveTimelineClip(empty, "missing", -1)).toThrow();
    expect(() => trimTimelineClip(empty, "missing", 0)).toThrow();
  });
});
