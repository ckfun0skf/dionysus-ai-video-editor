/**
 * P77 (Phase 2 step 2.4): retiming scene events by dragging. Every operation is pure (inputs are frozen here), works
 * from the scene the drag started on with the total offset, clamps to the clip range and snaps when asked.
 */
import { describe, expect, it } from "vitest";
import { moveEventProblem, moveSceneEventTo, retimeSceneEvent, sceneSnapTargets, validateScene, type SceneDoc } from ".";
import { bytesToDataUrl, makeAnimatedGlb } from "../ui/cubeGlb";

function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); }
  return v;
}
const doc = (): SceneDoc => freeze({
  format: "dionysus.scene/1",
  objects: [{ id: "a", shape: "box" }, { id: "b", shape: "sphere" }],
  events: [
    { at: 1, obj: "a", call: "moveTo", args: { position: [1, 0, 0] }, dur: 1 }, // 0: 1 → 2
    { at: 2.5, obj: "b", call: "moveTo", args: { position: [0, 1, 0] }, dur: 0.5 }, // 1: 2.5 → 3
    { at: 0.2, obj: "a", call: "visible", args: { value: false } }, // 2: instant
    { at: 0.5, obj: "camera", call: "fov", args: { value: 40 }, dur: 1 }, // 3
  ],
});

describe("scene retime: move (P77)", () => {
  it("moves at by the offset, keeps dur, rounds to whole frames when snapping, leaves the input alone", () => {
    const d = doc();
    const r = retimeSceneEvent(d, 0, "move", 0.512, { snap: [], fps: 30 });
    expect(r.doc.events![0]).toMatchObject({ at: 1.5, dur: 1 }); // 1.512 → frame 45 = 1.5
    expect(r.doc.events![1]).toBe(d.events![1]);
    expect(d.events![0].at).toBe(1);
    // Snapping off: only milliseconds.
    expect(retimeSceneEvent(d, 0, "move", 0.5123).doc.events![0].at).toBe(1.512);
  });

  it("snaps either edge to the nearest target within the tolerance; the closer edge wins", () => {
    const d = doc();
    const targets = sceneSnapTargets(d, 0, [1.7]);
    expect(targets).toEqual([0.2, 0.5, 1.5, 1.7, 2.5, 3]);
    // start 1.45 is 0.05 from 1.5; end 2.45 is 0.05 from 2.5 → tie goes to the start.
    const a = retimeSceneEvent(d, 0, "move", 0.45, { snap: targets, tol: 0.1 });
    expect(a).toMatchObject({ at: 1.5, dur: 1, snappedTo: 1.5 });
    // End lands on 3 (0.02 away) rather than start on 2.5 (0.02 + ... farther).
    const b = retimeSceneEvent(d, 0, "move", 0.98, { snap: targets, tol: 0.1 });
    expect(b).toMatchObject({ at: 2, snappedTo: 3 });
    // Out of tolerance: whole frame, no guide.
    const c = retimeSceneEvent(d, 0, "move", 0.31, { snap: targets, tol: 0.05, fps: 25 });
    expect(c.at).toBe(1.32);
    expect(c.snappedTo).toBeUndefined();
  });

  it("clamps to the clip range on the scene clock, widened to where the event already is", () => {
    const d = doc();
    expect(retimeSceneEvent(d, 0, "move", -5, { min: 0, max: 4 }).at).toBe(0);
    expect(retimeSceneEvent(d, 0, "move", 9, { min: 0, max: 4 }).at).toBe(3);
    // An event already past the clip's end can still move within where it is.
    const far = freeze({ ...d, events: [{ at: 6, obj: "a", call: "moveTo", args: { position: [0, 0, 0] }, dur: 1 }] }) as SceneDoc;
    expect(retimeSceneEvent(far, 0, "move", 0.5, { max: 4 }).at).toBe(6);
    expect(retimeSceneEvent(far, 0, "move", -1, { max: 4 }).at).toBe(5);
    // Instant events move too.
    expect(retimeSceneEvent(d, 2, "move", 1, { snap: [], fps: 30 }).doc.events![2]).toEqual({ at: 1.2, obj: "a", call: "visible", args: { value: false } });
  });

  it("returns the same scene when nothing changes", () => {
    const d = doc();
    expect(retimeSceneEvent(d, 0, "move", 0).doc).toBe(d);
    expect(retimeSceneEvent(d, 0, "move", -9, { min: 1 }).doc).toBe(d);
    expect(retimeSceneEvent(d, 99, "move", 1).doc).toBe(d);
  });
});

describe("scene retime: resize (P77)", () => {
  it("end changes dur; start moves at and keeps the end; at least one frame long", () => {
    const d = doc();
    expect(retimeSceneEvent(d, 0, "end", 0.5, { snap: [], fps: 30 }).doc.events![0]).toMatchObject({ at: 1, dur: 1.5 });
    expect(retimeSceneEvent(d, 0, "start", 0.4, { snap: [], fps: 30 }).doc.events![0]).toMatchObject({ at: 1.4, dur: 0.6 });
    expect(retimeSceneEvent(d, 0, "end", -5, { fps: 25 }).doc.events![0]).toMatchObject({ at: 1, dur: 0.04 });
    expect(retimeSceneEvent(d, 0, "start", 5, { fps: 25 }).doc.events![0]).toMatchObject({ at: 1.96, dur: 0.04 });
  });

  it("clamps the end to the clip and the start to its beginning; snaps edges to other events and the playhead", () => {
    const d = doc();
    expect(retimeSceneEvent(d, 0, "end", 10, { max: 3.2 }).dur).toBe(2.2);
    expect(retimeSceneEvent(d, 0, "start", -10, { min: 0.6 }).at).toBe(0.6);
    const targets = sceneSnapTargets(d, 0, [1.25]);
    expect(retimeSceneEvent(d, 0, "end", 0.47, { snap: targets, tol: 0.05 })).toMatchObject({ dur: 1.5, snappedTo: 2.5 });
    expect(retimeSceneEvent(d, 0, "start", 0.27, { snap: targets, tol: 0.05 })).toMatchObject({ at: 1.25, dur: 0.75, snappedTo: 1.25 });
  });

  it("a moment (no dur) can't be resized from its start, nor from its end unless its call tweens", () => {
    const d = doc();
    expect(retimeSceneEvent(d, 2, "start", 0.5).doc).toBe(d);
    expect(retimeSceneEvent(d, 2, "end", 0.5).doc).toBe(d); // visible never tweens
    const m = freeze({ ...d, events: [{ at: 1, obj: "a", call: "moveTo", args: { position: [0, 0, 0] } }] }) as SceneDoc;
    expect(retimeSceneEvent(m, 0, "end", 0.5).doc.events![0]).toMatchObject({ at: 1, dur: 0.5 });
  });

  it("results stay valid scenes", () => {
    const d = doc();
    for (const edge of ["move", "start", "end"] as const) for (const dx of [-3, -0.3, 0.3, 3]) {
      const r = retimeSceneEvent(d, 0, edge, dx, { snap: sceneSnapTargets(d, 0), tol: 0.1, max: 4 });
      expect(validateScene(r.doc).filter((i) => i.level === "error")).toEqual([]);
    }
  });
});

describe("scene retime: another object's track (P77)", () => {
  it("moves an event to an object that offers the call and keeps its index", () => {
    const d = doc();
    const r = moveSceneEventTo(d, 0, "b");
    expect(r.error).toBeUndefined();
    expect(r.doc.events![0]).toEqual({ ...d.events![0], obj: "b" });
    expect(r.doc.events!.slice(1)).toEqual(d.events!.slice(1));
    expect(moveSceneEventTo(d, 0, "a").doc).toBe(d);
  });

  it("refuses the camera, objects without the call, and arguments that don't hold there", () => {
    const d = doc();
    expect(moveEventProblem(d, 3, "a")).toMatch(/Scene track/);
    expect(moveEventProblem(d, 0, "camera")).toMatch(/Scene track/);
    const bot = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    const m = freeze({
      format: "dionysus.scene/1", files: { "bot.glb": bot },
      objects: [{ id: "bot", model: "bot.glb" }, { id: "ball", shape: "sphere" }, { id: "bot2", model: "bot.glb" }],
      events: [{ at: 0, obj: "bot", call: "play", args: { clip: "Spin" }, dur: 1 }],
    }) as SceneDoc;
    expect(moveEventProblem(m, 0, "ball")).toMatch(/no play/);
    expect(moveSceneEventTo(m, 0, "ball").doc).toBe(m);
    expect(moveSceneEventTo(m, 0, "bot2").doc.events![0].obj).toBe("bot2");
    expect(moveEventProblem(m, 5, "bot2")).toMatch(/no such event/);
  });
});
