import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { createProject, findPlacement, validateComposition, type Asset, type Project } from "../domain/model";
import { secondsToTicks as s } from "../domain/time";
import { snapMove, snapTicks } from "../domain/ops";

function asset(id: string, kind: Asset["kind"], seconds?: number): Asset {
  return { id, kind, name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "x", durationTicks: seconds ? s(seconds) : undefined }, provenance: { source: "import", inputs: [] } }] };
}
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", "video", 10)), cmd.importAsset(asset("a", "audio", 20)), cmd.importAsset(asset("i", "image"))]);
  return e;
}
const root = (p: Project) => p.compositions[p.rootCompositionId];

describe("v2 engine", () => {
  it("adds clips to compatible tracks without overlap", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    e.dispatch(cmd.addAssetToTimeline("i", 0, undefined, "p2"));
    e.dispatch(cmd.addAssetToTimeline("a", 0, undefined, "p3"));
    const c = root(e.getState().project);
    expect(findPlacement(c, "p2")!.placement.startTicks).toBe(s(10));
    expect(findPlacement(c, "p3")!.track.kind).toBe("audio");
    expect(validateComposition(c)).toEqual([]);
  });

  it("move, trim, split, delete with one undo step each", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    const tid = findPlacement(root(e.getState().project), "p1")!.track.id;
    e.dispatch(cmd.movePlacement("p1", tid, s(2)));
    e.dispatch(cmd.trimPlacement("p1", "left", s(4)));
    let p = findPlacement(root(e.getState().project), "p1")!.placement;
    expect([p.startTicks, p.durationTicks, p.sourceInTicks]).toEqual([s(4), s(8), s(2)]);
    e.dispatch(cmd.trimPlacement("p1", "right", s(100)));
    expect(findPlacement(root(e.getState().project), "p1")!.placement.durationTicks).toBe(s(8)); // clamped to source
    e.dispatch(cmd.splitPlacement("p1", s(6), "p1b"));
    const right = findPlacement(root(e.getState().project), "p1b")!.placement;
    expect([right.startTicks, right.durationTicks, right.sourceInTicks]).toEqual([s(6), s(6), s(4)]);
    e.dispatch(cmd.deletePlacement("p1b"));
    expect(findPlacement(root(e.getState().project), "p1b")).toBeUndefined();
    e.undo();
    expect(findPlacement(root(e.getState().project), "p1b")).toBeDefined();
    e.undo(); e.undo(); e.undo(); e.undo();
    p = findPlacement(root(e.getState().project), "p1")!.placement;
    expect(p.startTicks).toBe(0);
    e.redo();
    expect(findPlacement(root(e.getState().project), "p1")!.placement.startTicks).toBe(s(2));
    expect(e.getState().canRedo).toBe(true);
  });

  it("move onto occupied range pushes to next free slot; wrong track kind is rejected", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    e.dispatch(cmd.addAssetToTimeline("i", 0, undefined, "p2"));
    const c = root(e.getState().project);
    const vt = findPlacement(c, "p1")!.track.id;
    e.dispatch(cmd.movePlacement("p2", vt, s(5)));
    expect(findPlacement(root(e.getState().project), "p2")!.placement.startTicks).toBe(s(10));
    const at = c.tracks.find((t) => t.kind === "audio")!.id;
    expect(e.dispatch(cmd.movePlacement("p1", at, 0))).toBe(false);
  });

  it("image trim is unbounded by source, split keeps sourceIn 0", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("i", 0, undefined, "p"));
    e.dispatch(cmd.trimPlacement("p", "right", s(9)));
    expect(findPlacement(root(e.getState().project), "p")!.placement.durationTicks).toBe(s(9));
    e.dispatch(cmd.splitPlacement("p", s(3), "q"));
    expect(findPlacement(root(e.getState().project), "q")!.placement.sourceInTicks).toBe(0);
  });

  it("batch dispatch is atomic and coalescing merges history", () => {
    const e = setup();
    expect(e.getState().canUndo).toBe(true);
    e.undo();
    expect(Object.keys(e.getState().project.assets)).toHaveLength(0);
    e.redo();
    e.beginGesture();
    e.dispatch(cmd.renameProject("a"));
    e.dispatch(cmd.renameProject("ab"));
    e.endGesture();
    e.undo();
    expect(e.getState().project.name).toBe("t");
  });

  it("removing an asset removes its placements", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    e.dispatch(cmd.removeAsset("v"));
    expect(findPlacement(root(e.getState().project), "p1")).toBeUndefined();
  });

  it("snaps to clip edges and extra points", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    const c = root(e.getState().project);
    expect(snapTicks(c, s(10.1), s(0.2))).toBe(s(10));
    expect(snapTicks(c, s(5), s(0.2), [s(5.1)])).toBe(s(5.1));
    expect(snapMove(c, s(7.9), s(2), s(0.2), [s(10)])).toBe(s(8));
  });

  it("coalesces only inside a gesture; separate gestures are separate steps", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.renameProject("a"));
    e.dispatch(cmd.renameProject("ab")); // no gesture: two steps
    e.undo();
    expect(e.getState().project.name).toBe("a");
    e.beginGesture(); e.dispatch(cmd.renameProject("x")); e.dispatch(cmd.renameProject("xy")); e.endGesture();
    e.beginGesture(); e.dispatch(cmd.renameProject("xyz")); e.endGesture();
    e.undo();
    expect(e.getState().project.name).toBe("xy");
  });

  it("redo after coalescing restores the merged result and does not re-merge", () => {
    const e = new Engine(createProject("t"));
    e.beginGesture(); e.dispatch(cmd.renameProject("a")); e.dispatch(cmd.renameProject("ab"));
    e.undo();
    expect(e.getState().project.name).toBe("t");
    e.redo();
    expect(e.getState().project.name).toBe("ab");
    e.dispatch(cmd.renameProject("abc")); // gesture was closed by undo/redo
    e.undo();
    expect(e.getState().project.name).toBe("ab");
  });

  it("trim clamps to source length, minimum duration and neighbours", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    e.dispatch(cmd.trimPlacement("p1", "right", s(60)));
    expect(findPlacement(root(e.getState().project), "p1")!.placement.durationTicks).toBe(s(10));
    e.dispatch(cmd.trimPlacement("p1", "right", 5));
    expect(findPlacement(root(e.getState().project), "p1")!.placement.durationTicks).toBeGreaterThanOrEqual(1200);
    e.dispatch(cmd.addAssetToTimeline("v", s(12), undefined, "p2"));
    e.dispatch(cmd.trimPlacement("p1", "right", s(10)));
    e.dispatch(cmd.trimPlacement("p2", "left", 0));
    const p2 = findPlacement(root(e.getState().project), "p2")!.placement;
    expect(p2.startTicks).toBeGreaterThanOrEqual(s(10));
  });

  it("rounds fractional ticks and validation rejects non-integers", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    e.dispatch(cmd.splitPlacement("p1", s(2) + 0.4));
    e.dispatch(cmd.movePlacement("p1", root(e.getState().project).tracks[0].id, 10.6));
    for (const t of root(e.getState().project).tracks) for (const p of t.placements) expect(Number.isInteger(p.startTicks) && Number.isInteger(p.durationTicks)).toBe(true);
    const c = root(e.getState().project);
    const bad = { ...c, tracks: c.tracks.map((t, i) => (i ? t : { ...t, placements: t.placements.map((p) => ({ ...p, startTicks: p.startTicks + 0.5 })) })) };
    expect(validateComposition(bad).some((m) => m.includes("non-integer"))).toBe(true);
  });

  it("removeAsset also cleans nested compositions", () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "p1"));
    const p = e.getState().project;
    const nested = { ...root(p), id: "nested" };
    e.reset({ ...p, compositions: { ...p.compositions, nested } });
    e.dispatch(cmd.removeAsset("v"));
    expect(findPlacement(e.getState().project.compositions.nested, "p1")).toBeUndefined();
  });
});
