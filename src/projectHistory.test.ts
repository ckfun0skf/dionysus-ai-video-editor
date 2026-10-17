import { describe, expect, it } from "vitest";
import { recordProjectChange, redoProjectChange, undoProjectChange } from "./projectHistory";

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
