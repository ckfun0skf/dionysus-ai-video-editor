/**
 * P81a: what an Edit view gizmo drag writes (domain/sceneGizmo.ts). The input scene is frozen, so a mutation throws.
 */
import { describe, expect, it } from "vitest";
import { applyGizmo, gizmoArg, gizmoPropOfCall, gizmoTarget, gizmoTargetLabel, gizmoViewTime, SAMPLE_SCENE, stateAt, validateScene, type GizmoValue, type SceneDoc } from ".";

function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); }
  return v;
}
const sample = (): SceneDoc => freeze(structuredClone(SAMPLE_SCENE));
const val = (p: GizmoValue["position"], r: GizmoValue["rotation"] = [0, 0, 0], s: GizmoValue["scale"] = [1, 1, 1]): GizmoValue => ({ position: p, rotation: r, scale: s });
const errors = (d: SceneDoc) => validateScene(d).filter((i) => i.level === "error");

describe("P81a gizmo: where a drag writes", () => {
  it("maps calls to the gizmo property (lookAt is not writable by a drag)", () => {
    expect(["moveTo", "position", "rotation", "scale", "lookAt", "opacity"].map(gizmoPropOfCall)).toEqual(["position", "position", "rotation", "scale", undefined, undefined]);
  });

  it("without a matching selected event or Auto-key: the object's start value", () => {
    const d = sample();
    expect(gizmoTarget(d, "ball", "translate", { autoKey: false, at: 1 })).toEqual({ kind: "base" });
    // The selected event is ball.moveTo, but a rotate drag doesn't write it.
    expect(gizmoTarget(d, "ball", "rotate", { selEvent: 1, autoKey: false, at: 1 })).toEqual({ kind: "base" });
    // An event of another object doesn't count either.
    expect(gizmoTarget(d, "cube", "translate", { selEvent: 1, autoKey: true, at: 1 }).kind).toBe("newKey");
    const r = applyGizmo(d, "cube", "translate", val([2, 0.4, -0.5000004]), { autoKey: false, at: 1 });
    expect(r.doc.objects[2].position).toEqual([2, 0.4, -0.5]);
    expect(r.doc.events).toBe(d.events);
    expect(r.note).toMatch(/Moved “cube” \(its start position\)/);
    expect(errors(r.doc)).toEqual([]);
  });

  it("the selected event of that object and property: its end value (moveTo's position, rotation's value)", () => {
    const d = sample();
    expect(gizmoTarget(d, "ball", "translate", { selEvent: 1, autoKey: true, at: 0 })).toEqual({ kind: "event", index: 1, call: "moveTo" });
    const r = applyGizmo(d, "ball", "translate", val([1, 0.5, -0]), { selEvent: 1, autoKey: true, at: 0 });
    expect(r.doc.events![1]).toEqual({ ...d.events![1], args: { position: [1, 0.5, 0] } });
    expect(Object.is((r.doc.events![1].args!.position as number[])[2], 0)).toBe(true); // never -0
    expect(r.index).toBe(1);
    expect(r.doc.objects).toBe(d.objects);
    const rot = applyGizmo(d, "cube", "rotate", val([1.4, 0.4, -0.5], [0, 90.00004, 0]), { selEvent: 0, autoKey: false, at: 3 });
    expect(rot.doc.events![0].args).toEqual({ value: [0, 90, 0] });
    // The view shows the event's end, so the object is drawn where the drag puts it.
    expect(gizmoViewTime(d, "ball", "translate", { selEvent: 1, autoKey: false, at: 0.2 })).toBe(2);
    expect(gizmoViewTime(d, "ball", "rotate", { selEvent: 1, autoKey: false, at: 0.2 })).toBe(0.2);
    expect(gizmoViewTime(d, undefined, "translate", { autoKey: false, at: 0.7 })).toBe(0.7);
    expect(gizmoTargetLabel(d, "ball", "translate", { selEvent: 1, autoKey: false, at: 0 })).toBe("ball.moveTo at 0.5s (its end)");
  });

  it("Auto-key: updates the event of that property ending at the playhead, else adds a tween ending there", () => {
    const d = sample();
    // ball.moveTo runs 0.5 → 2: at 2 it is updated.
    expect(gizmoTarget(d, "ball", "translate", { autoKey: true, at: 2 })).toEqual({ kind: "key", index: 1, call: "moveTo" });
    const upd = applyGizmo(d, "ball", "translate", val([0, 1, 0]), { autoKey: true, at: 2 });
    expect(upd.doc.events).toHaveLength(6);
    expect(upd.doc.events![1].args).toEqual({ position: [0, 1, 0] });
    // At 3.25 a new moveTo from the previous one's end (2) to the playhead.
    const add = applyGizmo(d, "ball", "translate", val([0, 1, 0]), { autoKey: true, at: 3.25 });
    expect(add.doc.events).toHaveLength(7);
    expect(add.doc.events![6]).toEqual({ at: 2, obj: "ball", call: "moveTo", args: { position: [0, 1, 0] }, dur: 1.25 });
    expect(add.note).toMatch(/added ball\.moveTo at 2s for 1\.25s \(Auto-key\)/);
    expect(stateAt(add.doc, 3.25).objects.find((o) => o.id === "ball")!.position).toEqual([0, 1, 0]);
    expect(stateAt(add.doc, 2).objects.find((o) => o.id === "ball")!.position).toEqual(stateAt(d, 2).objects.find((o) => o.id === "ball")!.position);
    // With no earlier event of that property: from 0 s.
    const sc = applyGizmo(d, "sign", "scale", val([0, 1.9, -1.5], [0, 0, 0], [2, 2, 2]), { autoKey: true, at: 1 });
    expect(sc.doc.events!.at(-1)).toEqual({ at: 0, obj: "sign", call: "scale", args: { value: 2 }, dur: 1 });
    // At 0 s there is no time for a tween: an instant event.
    const zero = applyGizmo(d, "sign", "translate", val([0, 2, -1.5]), { autoKey: true, at: 0 });
    expect(zero.doc.events!.at(-1)).toEqual({ at: 0, obj: "sign", call: "moveTo", args: { position: [0, 2, -1.5] } });
    for (const x of [upd, add, sc, zero]) expect(errors(x.doc)).toEqual([]);
  });

  it("scale: one number when uniform, a vector otherwise, never zero or below", () => {
    expect(gizmoArg("scale", val([0, 0, 0], [0, 0, 0], [1.20004, 1.2, 1.2]))).toBe(1.2);
    expect(gizmoArg("scale", val([0, 0, 0], [0, 0, 0], [1, 2, -3]))).toEqual([1, 2, 0.001]);
    const r = applyGizmo(sample(), "cube", "scale", val([1.4, 0.4, -0.5], [0, 0, 0], [1, 2, 1]), { autoKey: false, at: 0 });
    expect(r.doc.objects[2].scale).toEqual([1, 2, 1]);
  });

  it("refuses the camera and unknown objects; an unchanged value keeps the same scene", () => {
    const d = sample();
    expect(applyGizmo(d, "camera", "translate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d);
    expect(applyGizmo(d, "nope", "translate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d);
    expect(applyGizmo(d, "cube", "translate", val([1.4, 0.4, -0.5]), { autoKey: false, at: 0 }).doc).toBe(d);
    expect(applyGizmo(d, "ball", "translate", val([0.2, 0.5, 0.8]), { selEvent: 1, autoKey: false, at: 0 }).doc).toBe(d);
  });
});
