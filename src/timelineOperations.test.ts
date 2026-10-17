import { describe, expect, it } from "vitest";
import type { TimelineTrack } from "./types";
import { addVideoClip, deleteTimelineClip, duplicateTimelineClip, moveTimelineClip, trimTimelineClip, unlinkTimelineAudio } from "./timelineOperations";

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

  it("rejects duplicate video and generated audio IDs before adding any clips", () => {
    const existing = { ...empty, timelineClips: [{ id: "v", name: "Existing", kind: "video" as const, trackId: "v1", start: 0, duration: 2 }] };
    expect(() => addVideoClip(existing, { id: "v", name: "Duplicate", trackId: "v1", start: 3, duration: 2 })).toThrow(/unique/);
    expect(() => addVideoClip(empty, { id: "same", name: "Collision", trackId: "v1", start: 0, duration: 2, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "same" })).toThrow(/unique/);
    expect(empty.timelineClips).toHaveLength(0);
  });

  it("rejects negative, non-finite, and zero-length linked edits without changing the input", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    expect(() => moveTimelineClip(state, "v", -0.1)).toThrow();
    expect(() => moveTimelineClip(state, "v", Number.NaN)).toThrow();
    expect(() => trimTimelineClip(state, "v", 0)).toThrow();
    expect(() => trimTimelineClip(state, "a", Number.POSITIVE_INFINITY)).toThrow();
    expect(state.timelineClips.find(c => c.id === "v")).toMatchObject({ start: 1, duration: 5 });
    expect(state.timelineClips.find(c => c.id === "a")).toMatchObject({ start: 1, duration: 5 });
  });

  it("moves a linked audio clip and its source as one group, and deletes linked audio without dangling links", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 2, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const moved = moveTimelineClip(state, "a", 7);
    expect(moved.timelineClips.find(c => c.id === "v")?.start).toBe(7);
    expect(moved.timelineClips.find(c => c.id === "a")?.start).toBe(7);
    expect(deleteTimelineClip(moved, "v").timelineClips).toEqual([]);
  });

  it("rejects invalid ranges and wrong track kinds", () => {
    expect(() => addVideoClip(empty, { id: "bad", name: "Bad", trackId: "a1", start: 0, duration: 2 })).toThrow();
    expect(() => moveTimelineClip(empty, "missing", -1)).toThrow();
    expect(() => trimTimelineClip(empty, "missing", 0)).toThrow();
  });

  it("duplicates a video and its linked audio with fresh IDs and no dangling references", () => {
    const state = addVideoClip(empty, { id: "v", name: "Video", trackId: "v1", start: 1, duration: 5, sourceHasAudio: true, audioTrackId: "a1", audioClipId: "a" });
    const duplicated = duplicateTimelineClip(state, "v", { newClipId: "v-copy", newAudioClipId: "a-copy", start: 8 });
    expect(duplicated.timelineClips).toHaveLength(4);
    expect(duplicated.timelineClips.find(c => c.id === "v-copy")).toMatchObject({ start: 8, duration: 5, kind: "video" });
    expect(duplicated.timelineClips.find(c => c.id === "a-copy")).toMatchObject({ start: 8, duration: 5, kind: "audio", linkedVideoClipId: "v-copy" });
    expect(duplicated.timelineClips.filter(c => c.kind === "audio").every(c => duplicated.timelineClips.some(v => v.id === c.linkedVideoClipId && v.kind === "video" && v.start === c.start && v.duration === c.duration))).toBe(true);
    expect(() => duplicateTimelineClip(state, "v", { newClipId: "v", newAudioClipId: "a-copy" })).toThrow(/unique/);
    expect(() => duplicateTimelineClip(state, "v", { newClipId: "v-copy" })).toThrow(/newAudioClipId/);
  });

  it("rejects malformed duplicate IDs and dangling or out-of-sync links before editing", () => {
    const duplicateIds = { ...empty, timelineClips: [
      { id: "same", name: "Video", kind: "video" as const, trackId: "v1", start: 0, duration: 2 },
      { id: "same", name: "Audio", kind: "audio" as const, trackId: "a1", start: 0, duration: 2 },
    ] };
    expect(() => trimTimelineClip(duplicateIds, "same", 1)).toThrow(/unique/);
    const dangling = { ...empty, timelineClips: [
      { id: "audio", name: "Audio", kind: "audio" as const, trackId: "a1", start: 0, duration: 2, linkedVideoClipId: "missing-video" },
    ] };
    expect(() => moveTimelineClip(dangling, "audio", 1)).toThrow(/existing video/);
    expect(() => deleteTimelineClip(dangling, "audio")).toThrow(/existing video/);
    const outOfSync = { ...empty, timelineClips: [
      { id: "video", name: "Video", kind: "video" as const, trackId: "v1", start: 0, duration: 2 },
      { id: "audio", name: "Audio", kind: "audio" as const, trackId: "a1", start: 1, duration: 2, linkedVideoClipId: "video" },
    ] };
    expect(() => trimTimelineClip(outOfSync, "video", 3)).toThrow(/timing must match/);
  });

});
