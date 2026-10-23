import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { createProject } from "../domain/model";

describe("duplicateAbove", () => {
  it("copies onto a new track directly above, same timing, nudged, one undo step", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.addTextClip(1000, { text: "Hi" }, "a"));
    const comp = () => e.getState().project.compositions[e.getState().project.rootCompositionId];
    const before = comp().tracks.length;
    const srcIdx = comp().tracks.findIndex((t) => t.placements.some((p) => p.id === "a"));
    expect(e.dispatch(cmd.duplicateAbove("a", "b", 0.02, 0.01, "trkB"))).toBe(true);
    const tracks = comp().tracks;
    expect(tracks).toHaveLength(before + 1);
    expect(tracks[srcIdx].id).toBe("trkB");
    expect(tracks[srcIdx].kind).toBe("text");
    expect(tracks[srcIdx + 1].placements.some((p) => p.id === "a")).toBe(true);
    const a = tracks[srcIdx + 1].placements.find((p) => p.id === "a")!, b = tracks[srcIdx].placements[0];
    expect(b.id).toBe("b");
    expect([b.startTicks, b.durationTicks, b.text?.text]).toEqual([a.startTicks, a.durationTicks, "Hi"]);
    expect(b.transform?.x).toBeCloseTo((a.transform?.x ?? 0) + 0.02);
    expect(b.transform?.y).toBeCloseTo((a.transform?.y ?? 0) + 0.01);
    e.undo();
    expect(comp().tracks).toHaveLength(before);
  });
});
