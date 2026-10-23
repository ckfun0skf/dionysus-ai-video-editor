import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "../domain/model";
import * as ops from "../domain/ops";
import { Engine } from "../engine/engine";
import * as cmd from "../engine/commands";
import { activeAt } from "./frame";
import { audioPlan } from "./export/plan";

const T = 120_000;
const pl = (id: string, clipType: Placement["clipType"]): Placement => ({ id, startTicks: 0, durationTicks: 2 * T, sourceInTicks: 0, clipType, source: { kind: "assetVersion", assetId: "a", versionId: "v" } } as Placement);
function setup() {
  const p = createProject("x");
  p.assets.a = { id: "a", kind: "video", name: "a", versions: [{ id: "v", createdAt: "", media: { blobKey: "b1", mime: "video/mp4" }, provenance: { source: "import", inputs: [] } }] };
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "video", "ov");
  c = ops.addTrack(c, "audio", "au");
  const main = ops.mainTrack(c)!.id;
  c = { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.id === main ? [pl("m", "video")] : t.id === "ov" ? [pl("o", "video")] : t.id === "au" ? [pl("s", "audio")] : [] })) };
  p.compositions[p.rootCompositionId] = c;
  return new Engine(p);
}
const root = (e: Engine) => { const p = e.getState().project; return p.compositions[p.rootCompositionId]; };

describe("layer hide/delete", () => {
  it("hidden layers are excluded from frames (preview + export) and from the export audio mix; undoable", () => {
    const e = setup();
    expect(activeAt(root(e), T).map((l) => l.placement.id).sort()).toEqual(["m", "o", "s"]);
    e.dispatch([cmd.toggleTrackHidden("ov"), cmd.toggleTrackHidden("au")], "hide");
    expect(activeAt(root(e), T).map((l) => l.placement.id)).toEqual(["m"]);
    expect(audioPlan(e.getState().project).length).toBe(1); // only the main video's own sound
    e.undo();
    expect(audioPlan(e.getState().project).length).toBe(3);
  });
  it("deletes a layer with its clips in one undo step, never the main track", () => {
    const e = setup();
    const main = ops.mainTrack(root(e))!.id;
    e.dispatch(cmd.deleteTrack("ov"));
    expect(root(e).tracks.some((t) => t.id === "ov")).toBe(false);
    e.dispatch(cmd.deleteTrack(main));
    expect(ops.mainTrack(root(e))!.id).toBe(main);
    e.undo();
    expect(root(e).tracks.find((t) => t.id === "ov")?.placements.length).toBe(1);
  });
  it("SRT import adds a new Text & Stickers layer and keeps existing ones", () => {
    const e = setup();
    e.dispatch(cmd.importSrtLayer([{ id: "1", startTicks: 0, durationTicks: T, text: "hi" }], "s1"));
    e.dispatch(cmd.importSrtLayer([{ id: "2", startTicks: 0, durationTicks: T, text: "yo" }], "s2"));
    const c = root(e);
    const s1 = c.tracks.find((t) => t.id === "s1")!, s2 = c.tracks.find((t) => t.id === "s2")!;
    expect(s1.placements[0].text?.text).toBe("hi");
    expect(s2.placements[0].text?.text).toBe("yo");
    expect(ops.groupOf(c, s1)).toBe("text");
    expect(c.tracks.some((t) => t.id === "ov")).toBe(true);
  });
});
