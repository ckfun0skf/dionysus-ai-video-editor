import { describe, expect, it } from "vitest";
import type { Composition, Placement } from "./model";
import * as edit from "./edit";
import { clipAtInGroup } from "./ops";

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
  it("P27: a ripple left-edge drag earlier reveals earlier source, bounded by the source only (even at timeline 0)", () => {
    const c = comp();
    c.tracks[0].placements[0] = clip("a", 0, 2, 3); // first clip at 0, 3 s of earlier source available
    const ext = edit.rippleTrim(c, "a", "left", -2 * S, 10 * S);
    expect(starts(ext)).toEqual([["a", 0, 4], ["b", 4, 3], ["c", 8, 2]]);
    expect(ext.tracks[0].placements[0].sourceInTicks).toBe(S);
    // Past the source start it stops at source 0.
    const capped = edit.rippleTrim(c, "a", "left", -9 * S, 10 * S);
    expect(starts(capped)[0]).toEqual(["a", 0, 5]);
    expect(capped.tracks[0].placements[0].sourceInTicks).toBe(0);
    // A middle clip may grow by more than its own start time.
    const c2 = comp();
    c2.tracks[0].placements[1] = clip("b", 2, 3, 5);
    expect(starts(edit.rippleTrim(c2, "b", "left", -2 * S, 10 * S))[1]).toEqual(["b", 2, 7]);
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

describe("P27 mode auto-select", () => {
  it("finds the clip under the playhead in a group, preferring the selected clip's track", () => {
    const c = { tracks: [
      { id: "a1", kind: "audio", name: "A1", placements: [clip("x", 0, 4)] },
      { id: "a2", kind: "audio", name: "A2", placements: [clip("y", 2, 4)] },
    ] } as unknown as Composition;
    expect(clipAtInGroup(c, "audio", 3 * S)?.id).toBe("x");
    expect(clipAtInGroup(c, "audio", 3 * S, "a2")?.id).toBe("y");
    expect(clipAtInGroup(c, "audio", 5 * S, "a1")?.id).toBe("y");
    expect(clipAtInGroup(c, "audio", 7 * S)).toBeUndefined();
  });
});
