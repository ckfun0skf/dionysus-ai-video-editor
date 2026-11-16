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

  it("refuses what can't be dragged that way and unknown objects; an unchanged value keeps the same scene", () => {
    const d = sample();
    expect(applyGizmo(d, "camera", "rotate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d); // the camera only moves
    expect(applyGizmo(d, "light:0", "translate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d); // a hemisphere light has no position
    expect(applyGizmo(d, "nope", "translate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d);
    expect(applyGizmo(d, "cube", "translate", val([1.4, 0.4, -0.5]), { autoKey: false, at: 0 }).doc).toBe(d);
    expect(applyGizmo(d, "ball", "translate", val([0.2, 0.5, 0.8]), { selEvent: 1, autoKey: false, at: 0 }).doc).toBe(d);
  });
});

describe("P81b gizmo: camera, look-at point and lights; rotations unwrapped", () => {
  it("the camera's position: its start value, the selected camera move, or an Auto-key", () => {
    const d = sample();
    const base = applyGizmo(d, "camera", "translate", val([0.5, 2, 7.0004]), { autoKey: false, at: 1 });
    expect(base.doc.world!.camera).toEqual({ fov: 40, position: [0.5, 2, 7], lookAt: [0, 0.8, 0] });
    expect(base.note).toBe("Moved the camera (its start position).");
    expect(gizmoTargetLabel(d, "camera", "translate", { autoKey: false, at: 1 })).toBe("the camera's start position");
    // Event 3 is camera.moveTo 2.5 s → 4.5 s.
    const ev = applyGizmo(d, "camera", "translate", val([2, 2, 4]), { selEvent: 3, autoKey: false, at: 0 });
    expect(ev.doc.events![3].args).toEqual({ position: [2, 2, 4] });
    expect(ev.doc.world).toBe(d.world);
    expect(gizmoViewTime(d, "camera", "translate", { selEvent: 3, autoKey: false, at: 0 })).toBe(4.5);
    // Auto-key at 1 s: a new camera.moveTo from 0 s; at 4.5 s the existing move is updated.
    const add = applyGizmo(d, "camera", "translate", val([1, 1, 5]), { autoKey: true, at: 1 });
    expect(add.doc.events!.at(-1)).toMatchObject({ at: 0, dur: 1, obj: "camera", call: "moveTo", args: { position: [1, 1, 5] } });
    const upd = applyGizmo(d, "camera", "translate", val([1, 1, 5]), { autoKey: true, at: 4.5 });
    expect(upd.index).toBe(3);
    // Rotate or scale never write the camera; an object event selected doesn't count for it.
    expect(gizmoTarget(d, "camera", "translate", { selEvent: 1, autoKey: false, at: 0 })).toEqual({ kind: "base" });
    for (const x of [base, ev, add, upd]) expect(errors(x.doc)).toEqual([]);
  });

  it("the camera's look-at point: world.camera.lookAt or a camera lookAt event (an object target becomes a point)", () => {
    const d = sample();
    const base = applyGizmo(d, "camera:target", "translate", val([0, 1, -1]), { autoKey: false, at: 0 });
    expect(base.doc.world!.camera!.lookAt).toEqual([0, 1, -1]);
    expect(base.note).toBe("Moved the camera's look-at point (its start look-at point).");
    const withLook = freeze({ ...structuredClone(SAMPLE_SCENE), events: [...structuredClone(SAMPLE_SCENE.events!), { at: 1, obj: "camera", call: "lookAt", args: { target: "ball" }, dur: 1 }] } as SceneDoc);
    const i = withLook.events!.length - 1;
    const r = applyGizmo(withLook, "camera:target", "translate", val([1, 1, 1]), { selEvent: i, autoKey: false, at: 0 });
    expect(r.doc.events![i].args).toEqual({ target: [1, 1, 1] });
    expect(r.note).toMatch(/aimed at “ball”; now a point/);
    // Selecting the camera.moveTo doesn't make a target drag write it.
    expect(gizmoTarget(withLook, "camera:target", "translate", { selEvent: 3, autoKey: false, at: 0 })).toEqual({ kind: "base" });
    expect(applyGizmo(d, "camera:target", "translate", val([0, 0, 0]), { autoKey: true, at: 2 }).doc.events!.at(-1)).toMatchObject({ obj: "camera", call: "lookAt", at: 0, dur: 2, args: { target: [0, 0, 0] } });
    expect(errors(r.doc)).toEqual([]);
  });

  it("a light with a position: always its position (lights are static), defaults written out first", () => {
    const d = sample();
    const r = applyGizmo(d, "light:1", "translate", val([1, 4, 2]), { autoKey: true, at: 2 });
    expect(r.doc.world!.lights).toEqual([{ type: "hemisphere", intensity: 1.1 }, { type: "directional", position: [1, 4, 2], intensity: 1.6 }]);
    expect(r.doc.events).toBe(d.events);
    expect(r.note).toBe("Moved “Light 2” (its start position).");
    expect(gizmoTargetLabel(d, "light:1", "translate", { autoKey: true, at: 2 })).toBe("Light 2's position (lights don't animate)");
    const bare = freeze({ format: "dionysus.scene/1", objects: [] } as SceneDoc);
    const def = applyGizmo(bare, "light:1", "translate", val([0, 2, 0]), { autoKey: false, at: 0 });
    expect(def.doc.world!.lights).toEqual([{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [0, 2, 0], intensity: 1.5 }]);
    expect(applyGizmo(d, "light:1", "rotate", val([0, 0, 0]), { autoKey: false, at: 0 }).doc).toBe(d);
  });

  it("rotations come back next to where the drag started: 360° + 10° stays 370°", () => {
    expect(gizmoArg("rotation", val([0, 0, 0], [0, 10, 0]), val([0, 0, 0], [0, 360, 0]))).toEqual([0, 370, 0]);
    expect(gizmoArg("rotation", val([0, 0, 0], [-170, 0, 179]), val([0, 0, 0], [180, 0, -180]))).toEqual([190, 0, -181]);
    expect(gizmoArg("rotation", val([0, 0, 0], [0, 10, 0]))).toEqual([0, 10, 0]);
    // Event 0 is cube.rotation to [0, 360, 0]: a small drag from there keeps the full turn.
    const r = applyGizmo(sample(), "cube", "rotate", val([1.4, 0.4, -0.5], [0, 15, 0]), { selEvent: 0, autoKey: false, at: 0, from: val([1.4, 0.4, -0.5], [0, 360, 0]) });
    expect(r.doc.events![0].args).toEqual({ value: [0, 375, 0] });
  });
});
