import { describe, expect, it } from "vitest";
import { recordProjectChange, redoProjectChange, undoProjectChange } from "./projectHistory";
import { addVideoClip, deleteTimelineClip, duplicateTimelineClip, moveTimelineClip, trimTimelineClip, unlinkTimelineAudio } from "./timelineOperations";
import type { TimelineTrack } from "./types";

describe("project history", () => {
  it("undoes and redoes timeline snapshots including linked audio state", () => {
    const original = { timelineClips: [{ id: "video", start: 1 }, { id: "audio", start: 1, linkedVideoClipId: "video" }] };
    const moved = { timelineClips: [{ id: "video", start: 5 }, { id: "audio", start: 5, linkedVideoClipId: "video" }] };
    const unlinked = { timelineClips: [{ id: "video", start: 5 }, { id: "audio", start: 5 }] };
    const afterMove = recordProjectChange({ current: original, undo: [], redo: [] }, moved);
    expect(undoProjectChange(afterMove).current).toEqual(original);
    const afterUnlink = recordProjectChange(afterMove, unlinked);
    const undone = undoProjectChange(afterUnlink);
    expect(undone.current).toEqual(moved);
    expect(redoProjectChange(undone).current).toEqual(unlinked);
  });

  it("undoes and redoes real linked timeline operations as complete project snapshots", () => {
    const tracks: TimelineTrack[] = [
      { id: "video-track", name: "Video", kind: "video" },
      { id: "audio-track", name: "Audio", kind: "audio" },
    ];
    const initial = { id: "project", tracks, timelineClips: [] as ReturnType<typeof addVideoClip>["timelineClips"] };
    const added = addVideoClip(initial, { id: "video-1", name: "Interview", trackId: "video-track", start: 1, duration: 8, sourceHasAudio: true, audioTrackId: "audio-track", audioClipId: "audio-1" });
    const afterAdd = recordProjectChange({ current: initial, undo: [], redo: [] }, added);
    const moved = moveTimelineClip(afterAdd.current, "video-1", 4);
    const afterMove = recordProjectChange(afterAdd, moved);
    const trimmed = trimTimelineClip(afterMove.current, "audio-1", 3);
    const afterTrim = recordProjectChange(afterMove, trimmed);
    const duplicated = duplicateTimelineClip(afterTrim.current, "video-1", { newClipId: "video-copy", newAudioClipId: "audio-copy", start: 12 });
    const afterDuplicate = recordProjectChange(afterTrim, duplicated);
    const unlinked = unlinkTimelineAudio(afterDuplicate.current, "audio-copy");
    const afterUnlink = recordProjectChange(afterDuplicate, unlinked);
    const deleted = deleteTimelineClip(afterUnlink.current, "video-copy");
    const afterDelete = recordProjectChange(afterUnlink, deleted);

    expect(afterDelete.current.timelineClips.map(clip => clip.id)).toEqual(["video-1", "audio-1", "audio-copy"]);
    expect(afterDelete.current.timelineClips.find(clip => clip.id === "audio-copy")).not.toHaveProperty("linkedVideoClipId");
    const undoDelete = undoProjectChange(afterDelete);
    expect(undoDelete.current.timelineClips.some(clip => clip.id === "video-copy" && clip.kind === "video")).toBe(true);
    expect(undoDelete.current.timelineClips.find(clip => clip.id === "audio-copy")).not.toHaveProperty("linkedVideoClipId");
    const undoUnlink = undoProjectChange(undoDelete);
    expect(undoUnlink.current.timelineClips.find(clip => clip.id === "audio-copy")?.linkedVideoClipId).toBe("video-copy");
    const undoDuplicate = undoProjectChange(undoUnlink);
    expect(undoDuplicate.current.timelineClips.map(clip => clip.id)).toEqual(["video-1", "audio-1"]);
    const undoTrim = undoProjectChange(undoDuplicate);
    expect(undoTrim.current.timelineClips.find(clip => clip.id === "video-1")).toMatchObject({ start: 4, duration: 8 });
    expect(undoTrim.current.timelineClips.find(clip => clip.id === "audio-1")).toMatchObject({ start: 4, duration: 8 });
    const undoMove = undoProjectChange(undoTrim);
    expect(undoMove.current.timelineClips.find(clip => clip.id === "video-1")).toMatchObject({ start: 1, duration: 8 });
    expect(undoMove.current.timelineClips.find(clip => clip.id === "audio-1")).toMatchObject({ start: 1, duration: 8 });
    const undoAdd = undoProjectChange(undoMove);
    expect(undoAdd.current.timelineClips).toEqual([]);
    const redoAdd = redoProjectChange(undoAdd);
    const redoMove = redoProjectChange(redoAdd);
    const redoTrim = redoProjectChange(redoMove);
    const redoDuplicate = redoProjectChange(redoTrim);
    const redoUnlink = redoProjectChange(redoDuplicate);
    const redoDelete = redoProjectChange(redoUnlink);
    expect(redoDelete.current).toEqual(afterDelete.current);
  });

  it("clears redo on a new edit, bounds history, and no-ops on empty stacks", () => {
    const start = { current: 0, undo: [] as number[], redo: [] as number[] };
    const first = recordProjectChange(start, 1);
    const undone = undoProjectChange(first);
    expect(undone.current).toBe(0);
    const branched = recordProjectChange({ ...undone, redo: [1] }, 2);
    expect(branched.redo).toEqual([]);
    let history = start;
    for (let i = 1; i <= 60; i++) history = recordProjectChange(history, i);
    expect(history.undo).toHaveLength(50);
    expect(undoProjectChange(start)).toBe(start);
    expect(redoProjectChange(start)).toBe(start);
  });
});
