/** P51: insert-after ripple, and paste placement (after the current clip / end of the chain) as one undo step. */
import { describe, expect, it } from "vitest";
import { createProject, findPlacement, type Asset, type Project } from "./model";
import * as chain from "./chain";
import * as edit from "./edit";
import * as ops from "./ops";
import { cmd, Engine } from "../engine";

const S = 120_000;
const root = (p: Project) => p.compositions[p.rootCompositionId];
const asset = (id: string, sec: number): Asset => ({ id, kind: "video", name: id, selectedVersionId: "v", versions: [{ id: "v", createdAt: "", media: { blobKey: id, mime: "video/mp4", durationTicks: sec * S }, provenance: { source: "import", inputs: [] } }] });
const at = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement.startTicks / S;

function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("a", 10)), cmd.importAsset(asset("b", 10)), cmd.importAsset(asset("w", 4))]);
  const main = ops.mainTrack(root(e.getState().project))!.id;
  e.dispatch(cmd.addAssetToTimeline("a", 0, main, "A"));
  e.dispatch(cmd.trimPlacement("A", "right", 2 * S));
  e.dispatch(cmd.addAssetToTimeline("b", 2 * S, main, "B"));
  e.dispatch(cmd.trimPlacement("B", "right", 4 * S));
  e.dispatch(cmd.addAssetToTimeline("a", 8 * S, main, "C"));
  e.dispatch(cmd.trimPlacement("C", "right", 10 * S));
  e.dispatch(cmd.addTextClip(2 * S, { text: "on B" }, "T"));
  e.dispatch(cmd.addTextClip(8 * S, { text: "on C" }, "U"));
  return e;
}
const link = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement.link?.parent;

describe("current clip and current chain", () => {
  it("prefers the selected main clip, then the playhead, then the clip that already ended", () => {
    const e = setup();
    const c = root(e.getState().project);
    expect(chain.currentMainClip(c, { time: 3 * S })?.id).toBe("B");
    expect(chain.currentMainClip(c, { selectedIds: ["A"], time: 3 * S })?.id).toBe("A");
    expect(chain.currentMainClip(c, { selectedIds: ["A", "C"], time: 9 * S })?.id).toBe("C");
    expect(chain.currentMainClip(c, { selectedIds: ["A", "C"], time: 3 * S })?.id).toBe("A");
    expect(chain.currentMainClip(c, { time: 6 * S })?.id).toBe("B"); // gap: the clip that ended at 4s
    expect(chain.currentMainClip(c, { time: 0 })?.id).toBe("A");
    expect(chain.insertAfterTicks(c, { selectedIds: ["A"] })).toBe(2 * S);
    expect(chain.chainEndTicks(c, { selectedIds: ["A"] })).toBe(4 * S); // A–B are one chain; C is after a gap
    expect(chain.chainOf(c, "C")!.clips.map((p) => p.id)).toEqual(["C"]);
    const shifted = structuredClone(c);
    for (const p of ops.mainTrack(shifted)!.placements) p.startTicks += 2 * S;
    expect(chain.currentMainClip(shifted, { time: 0 })).toBeUndefined();
    expect(chain.chainEndTicks(shifted, { time: 0 })).toBe(0);
    const empty = root(new Engine(createProject("e")).getState().project);
    expect(chain.insertAfterTicks(empty, { time: 0 })).toBeUndefined();
    expect(chain.chainEndTicks(empty, { time: 0 })).toBe(0);
  });
});

describe("insert after the current clip", () => {
  it("ripples later main clips and their linked subtitles, keeps the gap, and is one undo step", () => {
    const e = setup();
    expect(link(e, "T")).toBe("B");
    expect(link(e, "U")).toBe("C");
    expect(e.dispatch(cmd.insertClipAfter({ at: 2 * S, main: ["w"] }, ["N"]))).toBe(true);
    expect(at(e, "N")).toBe(2);
    expect(findPlacement(root(e.getState().project), "N")!.placement.durationTicks).toBe(4 * S);
    expect(at(e, "A")).toBe(0);
    expect(at(e, "B")).toBe(6);
    expect(at(e, "C")).toBe(12);
    expect(at(e, "T")).toBe(6);
    expect(at(e, "U")).toBe(12);
    expect(link(e, "T")).toBe("B");
    expect(link(e, "U")).toBe("C");
    // The 4s gap between B's end and C stays 4s.
    expect(at(e, "C") - (at(e, "B") + 2)).toBe(4);
    expect(e.undo()).toBe(true);
    expect(at(e, "B")).toBe(2);
    expect(at(e, "C")).toBe(8);
    expect(at(e, "T")).toBe(2);
    expect(at(e, "U")).toBe(8);
    expect(findPlacement(root(e.getState().project), "N")).toBeUndefined();
    expect(e.undo()).toBe(true); // the text clip, not a second insert
    expect(findPlacement(root(e.getState().project), "U")).toBeUndefined();
  });
});

describe("paste placement", () => {
  it("insert after the current clip and the end of the chain are different cuts, each one undo step", () => {
    const e = setup();
    const c0 = root(e.getState().project);
    const items = edit.copyClips(c0, ["A"]);
    const after = chain.pasteOrigin(c0, "after", { selectedIds: ["A"] })!;
    const end = chain.pasteOrigin(c0, "end", { selectedIds: ["A"] })!;
    expect(after).toBe(2 * S);
    expect(end).toBe(4 * S);

    expect(e.dispatch(cmd.pasteClips(items, after, ["P"], true), "Paste clip")).toBe(true);
    expect(at(e, "P")).toBe(2);
    expect(at(e, "B")).toBe(4); // pushed by A's 2s
    expect(at(e, "T")).toBe(4); // subtitle stays with B
    expect(at(e, "C")).toBe(10);
    expect(at(e, "U")).toBe(10);
    expect(link(e, "T")).toBe("B");
    expect(e.undo()).toBe(true);
    expect(at(e, "B")).toBe(2);
    expect(at(e, "T")).toBe(2);
    expect(at(e, "C")).toBe(8);
    expect(findPlacement(root(e.getState().project), "P")).toBeUndefined();

    expect(e.dispatch(cmd.pasteClips(items, end, ["Q"], true), "Paste clip")).toBe(true);
    expect(at(e, "Q")).toBe(4);
    expect(at(e, "B")).toBe(2); // the chain end is after B, so B stays
    expect(at(e, "T")).toBe(2);
    expect(at(e, "C")).toBe(10);
    expect(at(e, "U")).toBe(10);
    expect(e.undo()).toBe(true);
    expect(at(e, "C")).toBe(8);
    expect(at(e, "U")).toBe(8);
    expect(findPlacement(root(e.getState().project), "Q")).toBeUndefined();
  });

  it("a pasted main clip and its subtitle stay together while the old subtitle follows its own clip", () => {
    const e = setup();
    const items = edit.copyClips(root(e.getState().project), ["B", "T"]);
    expect(e.dispatch(cmd.pasteClips(items, 2 * S, ["B2", "T2"], true))).toBe(true);
    expect(at(e, "B2")).toBe(2);
    expect(at(e, "T2")).toBe(2);
    expect(link(e, "T2")).toBe("B2");
    expect(at(e, "B")).toBe(4);
    expect(at(e, "T")).toBe(4);
    expect(link(e, "T")).toBe("B");
    e.undo();
    expect(findPlacement(root(e.getState().project), "B2")).toBeUndefined();
    expect(at(e, "T")).toBe(2);
  });
});

describe("P52 paste at the playhead and onto a chosen track", () => {
  it("places a copy at the playhead in a free gap without rippling, and reports overlap otherwise", () => {
    const e = setup();
    const c0 = root(e.getState().project);
    const items = edit.copyClips(c0, ["A"]);
    expect(chain.pasteOrigin(c0, "playhead", { time: 5 * S })).toBe(5 * S);
    expect(chain.pasteOverlaps(c0, items, 5 * S)).toBe(false);
    expect(chain.pasteOverlaps(c0, items, 1 * S)).toBe(true);
    expect(e.dispatch(cmd.pasteClips(items, 5 * S, ["G"], false, { exact: true }), "Paste clip")).toBe(true);
    expect(at(e, "G")).toBe(5);
    expect(at(e, "A")).toBe(0);
    expect(at(e, "B")).toBe(2);
    expect(at(e, "C")).toBe(8);
    expect(findPlacement(root(e.getState().project), "G")!.track.id).toBe(ops.mainTrack(root(e.getState().project))!.id);
    expect(e.dispatch(cmd.pasteClips(items, 1 * S, ["X"], false, { exact: true }))).toBe(false);
    expect(findPlacement(root(e.getState().project), "X")).toBeUndefined();
    expect(e.undo()).toBe(true);
    expect(findPlacement(root(e.getState().project), "G")).toBeUndefined();
    expect(at(e, "C")).toBe(8);
  });

  it("pastes onto a chosen overlay track or a new overlay without moving main clips", () => {
    const e = setup();
    expect(e.dispatch(cmd.addTrack("video"))).toBe(true);
    const c0 = root(e.getState().project);
    const overlay = c0.tracks.find((t) => ops.groupOf(c0, t) === "overlay")!;
    expect(overlay).toBeTruthy();
    const items = edit.copyClips(c0, ["A"]);
    expect(chain.pasteTrackOptions(c0, items).map((t) => t.id)).toEqual(expect.arrayContaining([ops.mainTrack(c0)!.id, overlay.id]));
    expect(chain.pasteOverlaps(c0, items, 5 * S, { trackId: overlay.id })).toBe(false);
    expect(e.dispatch(cmd.pasteClips(items, 5 * S, ["O"], false, { target: { trackId: overlay.id }, exact: true }))).toBe(true);
    const placed = findPlacement(root(e.getState().project), "O")!;
    expect(placed.track.id).toBe(overlay.id);
    expect(placed.placement.startTicks).toBe(5 * S);
    expect(at(e, "A")).toBe(0);
    expect(at(e, "B")).toBe(2);
    expect(at(e, "C")).toBe(8);
    expect(e.undo()).toBe(true);
    expect(e.dispatch(cmd.pasteClips(items, 3 * S, ["N"], false, { target: { newTrack: true, trackId: "trk_N" }, exact: true }))).toBe(true);
    const neu = findPlacement(root(e.getState().project), "N")!;
    expect(neu.track.id).toBe("trk_N");
    expect(ops.groupOf(root(e.getState().project), neu.track)).toBe("overlay");
    expect(neu.placement.startTicks).toBe(3 * S);
    expect(at(e, "A")).toBe(0);
    expect(at(e, "C")).toBe(8);
  });
});
