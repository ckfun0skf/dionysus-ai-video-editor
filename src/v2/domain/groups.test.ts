import { describe, expect, it } from "vitest";
import { createProject, type Composition, type Placement } from "./model";
import * as ops from "./ops";

const pl = (id: string, clipType: Placement["clipType"], start = 0, dur = 100): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType, source: { assetId: id, versionId: id } } as Placement);
const base = () => { const p = createProject("t"); return p.compositions[p.rootCompositionId]; };
const g = (c: Composition) => c.tracks.map((t) => `${ops.groupOf(c, t)}:${t.placements.map((p) => p.id).join(",")}`);

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
  it("moves an HTML clip into Text & Stickers and back", () => {
    let c = ops.addTrack(base(), "video", "ov");
    c = ops.insertPlacement(c, "ov", pl("h", "html"));
    c = ops.moveToGroup(c, "h", "text", "st");
    expect(g(c)[0]).toBe("text:h");
    expect(c.tracks.some((t) => t.id === "ov")).toBe(false);
    c = ops.moveToGroup(c, "h", "overlay", "ov2");
    expect(ops.groupOf(c, c.tracks.find((t) => t.id === "ov2")!)).toBe("overlay");
  });
  it("interleaves a sticker with text via layer up/down without leaving the group", () => {
    let c = ops.addTrack(base(), "text", "tx");
    c = ops.insertPlacement(c, "tx", pl("t1", "text"));
    c = ops.addTrack(c, "video", "st", "text");
    c = ops.insertPlacement(c, "st", pl("s", "image"));
    expect(g(c).slice(0, 2)).toEqual(["text:s", "text:t1"]);
    c = ops.moveLayer(c, "s", "down", "n1");
    expect(g(c).slice(0, 2)).toEqual(["text:t1", "text:s"]);
    const same = ops.moveLayer(c, "s", "down", "n2");
    expect(same).toBe(c); // bottom of group: doesn't drop into Overlay
    c = ops.moveLayer(c, "s", "up", "n3");
    expect(g(c).slice(0, 2)).toEqual(["text:s", "text:t1"]);
  });
  it("never moves the main track's clips between layers", () => {
    let c = base();
    const main = ops.mainTrack(c)!;
    c = ops.insertPlacement(c, main.id, pl("m", "video"));
    expect(ops.moveLayer(c, "m", "up")).toBe(c);
  });
});
