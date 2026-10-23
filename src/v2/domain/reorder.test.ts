import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "./model";
import * as ops from "./ops";

const pl = (id: string, start: number, dur: number): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "video", source: { assetId: id, versionId: id } } as Placement);
const mk = () => {
  const p = createProject("t");
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "video", "m");
  const m = ops.mainTrack(c)!;
  return { ...c, tracks: c.tracks.map((t) => t.id === m.id ? { ...t, placements: [pl("a", 0, 100), pl("b", 100, 50), pl("c", 150, 200)] } : t) };
};
const seq = (c: ReturnType<typeof mk>) => ops.mainTrack(c)!.placements.map((p) => `${p.id}@${p.startTicks}+${p.durationTicks}`);

describe("reorderMain", () => {
  it("moves a clip and repacks gaplessly keeping durations", () => {
    expect(seq(ops.reorderMain(mk(), "a", 2))).toEqual(["b@0+50", "c@50+200", "a@250+100"]);
    expect(seq(ops.reorderMain(mk(), "c", 0))).toEqual(["c@0+200", "a@200+100", "b@300+50"]);
  });
  it("is a no-op for the same slot or unknown ids", () => {
    const c = mk();
    expect(ops.reorderMain(c, "b", 1)).toBe(c);
    expect(ops.reorderMain(c, "zz", 0)).toBe(c);
  });
});
describe("reorderMain single clip", () => {
  it("is a no-op with one clip", () => {
    const p = createProject("t"); let c = p.compositions[p.rootCompositionId];
    const m = ops.mainTrack(c)!; c = { ...c, tracks: c.tracks.map((t) => t.id === m.id ? { ...t, placements: [pl("a", 0, 100)] } : t) };
    expect(ops.reorderMain(c, "a", 0)).toBe(c);
  });
});
