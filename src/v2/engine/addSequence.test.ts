import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import * as ops from "../domain/ops";
import { createProject, type Asset, type Project } from "../domain/model";
import { secondsToTicks as s } from "../domain/time";

const asset = (id: string, kind: Asset["kind"], seconds?: number): Asset => ({ id, kind, name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "x", durationTicks: seconds ? s(seconds) : undefined }, provenance: { source: "import", inputs: [] } }] });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const setup = () => { const e = new Engine(createProject("t")); e.dispatch([cmd.importAsset(asset("v", "video", 10)), cmd.importAsset(asset("w", "video", 4))]); return e; };

describe("addAssetsInSequence", () => {
  it("appends picked items end-to-end on the main track from the playhead, one undo", () => {
    const e = setup();
    const before = root(e.getState().project).tracks.length;
    e.dispatch(cmd.addAssetsInSequence(["v", "w"], s(2)));
    const main = ops.mainTrack(root(e.getState().project))!;
    expect(main.placements.map((p) => [p.startTicks, p.durationTicks])).toEqual([[s(2), s(10)], [s(12), s(4)]]);
    expect(root(e.getState().project).tracks.length).toBe(before);
    e.undo();
    expect(ops.mainTrack(root(e.getState().project))!.placements).toHaveLength(0);
  });
  it("overlay puts items on a new track above the main track", () => {
    const e = setup();
    e.dispatch(cmd.addAssetsInSequence(["w"], s(3), "ov"));
    const c = root(e.getState().project);
    expect(c.tracks[0].id).toBe("ov");
    expect(c.tracks[0].placements[0].startTicks).toBe(s(3));
    expect(ops.mainTrack(c)!.id).not.toBe("ov");
    e.undo();
    expect(root(e.getState().project).tracks.some((t) => t.id === "ov")).toBe(false);
  });
});
