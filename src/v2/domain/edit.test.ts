import { describe, expect, it } from "vitest";
import type { Composition, Placement } from "./model";
import * as edit from "./edit";

const S = 120000;
const clip = (id: string, start: number, dur: number, src = 0): Placement => ({ id, clipType: "video", source: { assetId: "a", versionId: "v" }, startTicks: start * S, durationTicks: dur * S, sourceInTicks: src * S } as Placement);
const comp = (): Composition => ({ id: "c", name: "c", tracks: [
  { id: "v1", kind: "video", name: "V1", placements: [clip("a", 0, 2), clip("b", 2, 3), clip("c", 6, 2)] },
  { id: "a1", kind: "audio", name: "A1", placements: [] },
] } as unknown as Composition);
const starts = (c: Composition) => c.tracks[0].placements.map((p) => [p.id, p.startTicks / S, p.durationTicks / S]);

describe("ripple and clipboard edits", () => {
  it("delete without ripple leaves a gap; ripple closes it (keeping pre-existing gaps)", () => {
    expect(starts(edit.deleteMany(comp(), ["b"]))).toEqual([["a", 0, 2], ["c", 6, 2]]);
    expect(starts(edit.deleteMany(comp(), ["b"], true))).toEqual([["a", 0, 2], ["c", 3, 2]]);
    expect(starts(edit.deleteMany(comp(), ["a", "b"], true))).toEqual([["c", 1, 2]]);
  });
  it("ripple trim shortens and pulls later clips; extending pushes them", () => {
    expect(starts(edit.rippleTrim(comp(), "b", "right", 4 * S, 10 * S))).toEqual([["a", 0, 2], ["b", 2, 2], ["c", 5, 2]]);
    expect(starts(edit.rippleTrim(comp(), "b", "right", 8 * S, 10 * S))).toEqual([["a", 0, 2], ["b", 2, 6], ["c", 9, 2]]);
    const left = edit.rippleTrim(comp(), "b", "left", 3 * S, 10 * S);
    expect(starts(left)).toEqual([["a", 0, 2], ["b", 2, 2], ["c", 5, 2]]);
    expect(left.tracks[0].placements[1].sourceInTicks).toBe(S);
  });
  it("copy/paste keeps relative layout and slides past overlaps", () => {
    const items = edit.copyClips(comp(), ["a", "c"]);
    expect(items.map((i) => i.offset / S)).toEqual([0, 6]);
    let n = 0;
    const { comp: c, ids } = edit.pasteClips(comp(), items, 8 * S, () => `p${n++}`);
    expect(ids).toEqual(["p0", "p1"]);
    expect(starts(c).slice(3)).toEqual([["p0", 8, 2], ["p1", 14, 2]]);
  });
  it("duplicate places copies after the selection", () => {
    const { comp: c } = edit.duplicateClips(comp(), ["b"], () => "d");
    expect(starts(c).find((r) => r[0] === "d")).toEqual(["d", 8, 3]);
  });
});
