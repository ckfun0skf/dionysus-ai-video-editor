import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "./model";
import * as ops from "./ops";

const pl = (id: string, clipType: Placement["clipType"], start = 0, dur = 100): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType, source: { assetId: id, versionId: id } } as Placement);
const base = () => { const p = createProject("t"); return p.compositions[p.rootCompositionId]; };

describe("track groups", () => {
  it("orders Text & Stickers above Overlay above Main above Audio", () => {
    let c = base();
    c = ops.addTrack(c, "text", "tx");
    c = ops.addTrack(c, "video", "ov");
    c = ops.addTrack(c, "video", "st", "text");
    const groups = c.tracks.map((t) => ops.groupOf(c, t));
    expect(groups.indexOf("text")).toBeLessThan(groups.indexOf("overlay"));
    expect(groups.indexOf("overlay")).toBeLessThan(groups.indexOf("main"));
    expect(groups.lastIndexOf("text")).toBeLessThan(groups.indexOf("overlay"));
    expect(c.tracks[0].id).toBe("st");
    expect(ops.mainTrack(c)!.id).not.toBe("st");
  });
  it("reorders a layer within its group only", () => {
    let c = base();
    c = ops.insertPlacement(c, ops.mainTrack(c)!.id, pl("m", "video"));
    c = ops.addTrack(c, "video", "o1"); c = ops.insertPlacement(c, "o1", pl("a", "image"));
    c = ops.addTrack(c, "video", "o2"); c = ops.insertPlacement(c, "o2", pl("b", "image"));
    c = ops.addTrack(c, "text", "tx");
    const ov = () => ops.tracksInGroup(c, "overlay").map((t) => t.id);
    expect(ov()).toEqual(["o2", "o1"]);
    c = ops.reorderTrack(c, "o2", 1);
    expect(ov()).toEqual(["o1", "o2"]);
    expect(c.tracks[0].id).toBe("tx");
    expect(ops.mainTrack(c)!.placements[0].id).toBe("m");
    expect(ops.reorderTrack(c, "o1", 0)).toBe(c);
  });
  it("never moves the main track's clips between layers", () => {
    let c = base();
    const main = ops.mainTrack(c)!;
    c = ops.insertPlacement(c, main.id, pl("m", "video"));
    expect(ops.reorderTrack(c, ops.mainTrack(c)!.id, 0)).toBe(c);
  });
});
