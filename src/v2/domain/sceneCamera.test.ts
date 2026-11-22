import { describe, expect, it } from "vitest";
import {
  addSceneCamera, applySceneTool, callTweens, defaultCallArgs, focalToFov, framePose, fStopToAperture, removeSceneCamera, SAMPLE_SCENE, sceneCallArgs, sceneCalls,
  sceneCameraDefs, sceneObjectsForAgent, sceneShots, sceneTracks, setSceneShots, shake, splineAt, stateAt, updateSceneCamera, validateScene, type SceneDoc,
} from ".";
import { BENCHMARK_SHOT } from "./__fixtures__/benchmarkShot";

const errors = (raw: unknown) => validateScene(raw).filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`);
const warnings = (raw: unknown) => validateScene(raw).filter((i) => i.level === "warning").map((i) => `${i.path}: ${i.message}`);
const base = (extra: Partial<SceneDoc> = {}, cameras: unknown[] = [{ id: "side", position: [6, 1.6, 0], lookAt: [0, 1, 0] }]): SceneDoc => ({
  format: "dionysus.scene/1",
  world: { camera: { position: [0, 1.6, 6], lookAt: [0, 1, 0] }, cameras: cameras as never, post: { dof: true } },
  objects: [{ id: "ball", shape: "sphere", size: 0.5, position: [0, 0.5, 0] }, { id: "hero", character: {}, position: [2, 0, 0] }],
  ...extra,
});
const close = (a: number[], b: number[], d = 6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], d));

describe("Scene Phase 3 (#352): helpers", () => {
  it("lens maths, a spline through points, seeded shake, a framed pose", () => {
    expect(focalToFov(35)).toBeCloseTo(32.27, 2);
    expect(focalToFov(50, 36)).toBeLessThan(focalToFov(24, 36));
    expect(fStopToAperture(1.4)).toBeCloseTo(0.02, 6);
    expect(splineAt([[0, 0, 0], [2, 0, 0], [4, 0, 0]], 0.5)).toEqual([2, 0, 0]);
    expect(splineAt([[0, 0, 0], [2, 0, 0]], 1)).toEqual([2, 0, 0]);
    expect(shake("cam", 1.25, 1.2)).toEqual(shake("cam", 1.25, 1.2));
    expect(shake("cam", 1.25, 1.2)).not.toEqual(shake("other", 1.25, 1.2));
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(shake("a", i / 20, 1)[0])))).toBeLessThanOrEqual(1);
    const f = framePose([0, 0, 0], 1.7, 0, 40, "medium", "front", "eye");
    expect(f.target).toEqual([0, 0.62 * 1.7 * (0.68 / 0.62), 0]);
    expect(f.position[2]).toBeGreaterThan(1); // in front (+z) of a subject facing +z
    expect(framePose([0, 0, 0], 1.7, 0, 40, "closeup", "left", "eye").position[0]).toBeGreaterThan(0); // its left is +x
    expect(framePose([0, 0, 0], 1.7, 0, 40, "wide", "front", "eye").position[2]).toBeGreaterThan(f.position[2]);
  });
});

describe("Scene Phase 3: validation", () => {
  it("cameras, lenses, shots and rig events", () => {
    expect(errors(base())).toEqual([]);
    expect(errors(base({}, [{ id: "camera" }, { id: "ball" }, { id: "side", lens: { focalLength: 2, fStop: 100, focus: "nope" } }, { id: "side" }]))).toEqual([
      'world.cameras[0].id: "camera" is the default camera (world.camera).',
      'world.cameras[1].id: "ball" is already the id of an object, a light or post / fog / sky.',
      "world.cameras[2].lens.focalLength: must be millimetres from 4 to 1200.",
      "world.cameras[2].lens.fStop: must be an f-stop from 0.7 to 64.",
      "world.cameras[2].lens.focus: must be a distance above 0 or an object id.",
      'world.cameras[3].id: "side" is used twice.',
    ]);
    expect(errors(base({ shots: [{ at: 0, camera: "side" }, { at: 2, camera: "nope" }] }))).toEqual(["shots[1].camera: must be a camera id (camera, side)."]);
    expect(warnings(base({ shots: [{ at: 3, camera: "side" }, { at: 1, camera: "camera" }] })).join(" ")).toMatch(/earlier than the shot before.*after 0 s/);
    const ev = (e: Record<string, unknown>) => errors(base({ events: [{ at: 0, obj: "side", ...e } as never] }));
    expect(ev({ call: "orbit", args: { to: 90, target: "ball" }, dur: 2 })).toEqual([]);
    expect(ev({ call: "follow", args: { target: "hero", offset: [0, 1, 3] } })).toEqual([]);
    expect(ev({ call: "frame", args: { subject: "hero", shot: "closeup", angle: "left", height: "low" } })).toEqual([]);
    expect(ev({ call: "frame", args: { subject: "hero", shot: "macro" } })[0]).toMatch(/shot: must be one of wide/);
    expect(ev({ call: "dolly", args: {} })).toEqual(["events[0].args: dolly needs path (points) or distance."]);
    expect(ev({ call: "rackFocus", args: { to: "hero" }, dur: 1 })).toEqual([]);
    expect(ev({ call: "zoom" })[0]).toMatch(/The camera "side" has no function "zoom"/);
    expect(ev({ call: "handheld", args: { amplitude: 5 } })).toEqual(["events[0].args.amplitude: must be units from 0 to 2."]);
    expect(warnings({ ...base(), world: { ...base().world, post: undefined }, events: [{ at: 0, obj: "side", call: "fStop", args: { value: 2 } }] })[0]).toMatch(/dof is off/);
    // Old scenes: the default camera keeps its calls and messages; no new state fields.
    expect(Object.keys(stateAt(SAMPLE_SCENE, 1))).toEqual(["t", "background", "camera", "objects", "lights"]);
  });
});

describe("Scene Phase 3: evaluation (from the document and t alone)", () => {
  it("shots cut between cameras; every camera's pose is reported; moves on any camera", () => {
    const d = base({ shots: [{ at: 1, camera: "side" }, { at: 3, camera: "camera" }], events: [{ at: 0, obj: "side", call: "moveTo", args: { position: [8, 1.6, 0] }, dur: 2 }] });
    expect(stateAt(d, 0.5).cameraId).toBe("camera");
    expect(stateAt(d, 1).cameraId).toBe("side");
    expect(stateAt(d, 1).camera.position).toEqual([7, 1.6, 0]);
    expect(stateAt(d, 3.5).cameraId).toBe("camera");
    expect(stateAt(d, 3.5).cameras!.map((c) => c.id)).toEqual(["camera", "side"]);
    expect(stateAt(d, 3.5).cameras![1].position).toEqual([8, 1.6, 0]);
  });

  it("rigs: orbit, follow (smoothed, continuous after), dolly path, truck / crane, handheld, focal length", () => {
    const orbit = base({ shots: [{ at: 0, camera: "side" }], events: [{ at: 0, obj: "side", call: "orbit", args: { target: [0, 1, 0], from: 90, to: 0, radius: 6, height: 0.6 }, dur: 2 }] });
    close(stateAt(orbit, 2).camera.position, [0, 1.6, 6]);
    close(stateAt(orbit, 2).camera.target, [0, 1, 0]);
    close(stateAt(orbit, 5).camera.position, [0, 1.6, 6]); // holds the end
    const walk = base({ shots: [{ at: 0, camera: "side" }], events: [
      { at: 0, obj: "hero", call: "walkTo", args: { path: [[6, 0, 0]] } },
      { at: 0, obj: "side", call: "follow", args: { target: "hero", offset: [0, 1.5, 4], damping: 0 } },
    ] });
    const s2 = stateAt(walk, 2), hero = s2.objects.find((o) => o.id === "hero")!;
    close(s2.camera.position, [hero.position[0], 1.5, 4]);
    close(s2.camera.target, [hero.position[0], 1.7 * 0.62, 0]);
    const smooth = { ...walk, events: walk.events!.map((e) => (e.call === "follow" ? { ...e, args: { ...e.args, damping: 0.6 } } : e)) };
    expect(stateAt(smooth, 2).camera.position[0]).toBeLessThan(hero.position[0]); // lags behind
    const dolly = base({ events: [{ at: 0, obj: "camera", call: "dolly", args: { path: [[2, 1.6, 4], [4, 1.6, 2]] }, dur: 2 }] });
    close(stateAt(dolly, 2).camera.position, [4, 1.6, 2]);
    const truck = base({ events: [{ at: 0, obj: "camera", call: "truck", args: { distance: 1 } }, { at: 1, obj: "camera", call: "crane", args: { distance: 2 } }] });
    close(stateAt(truck, 0.5).camera.position, [1, 1.6, 6]);
    close(stateAt(truck, 2).camera.target, [1, 3, 0]);
    const hand = base({ events: [{ at: 0, obj: "camera", call: "handheld", args: { amplitude: 0.05 } }] });
    expect(stateAt(hand, 2).camera.position).not.toEqual([0, 1.6, 6]);
    expect(stateAt(hand, 2).camera.position).toEqual(stateAt(hand, 2).camera.position);
    expect(Math.abs(stateAt(hand, 2).camera.position[0])).toBeLessThan(0.06);
    expect(stateAt(hand, 0).camera.position).toEqual([0, 1.6, 6]); // ramps in from 0
    const zoom = base({ events: [{ at: 0, obj: "camera", call: "focalLength", args: { value: 50 } }] });
    expect(stateAt(zoom, 0).camera.fov).toBeCloseTo(focalToFov(50), 9);
  });

  it("lens focus and f-stop drive the depth of field; rack focus pulls to a character's eyes", () => {
    const d = base({
      world: { ...base().world, cameras: [{ id: "side", position: [6, 1.6, 0], lookAt: [0, 1, 0], lens: { focalLength: 85, focus: "ball", fStop: 1.4 } }] },
      shots: [{ at: 0, camera: "side" }],
      events: [{ at: 1, obj: "side", call: "rackFocus", args: { to: "hero" }, dur: 1 }],
    });
    const s0 = stateAt(d, 0);
    expect(s0.camera.fov).toBeCloseTo(focalToFov(85), 9);
    expect(s0.post!.dof!.focus).toBeCloseTo(Math.hypot(6, 1.1, 0), 6);
    expect(s0.post!.dof!.aperture).toBeCloseTo(0.02, 6);
    expect(stateAt(d, 3).post!.dof!.focus).toBeCloseTo(Math.hypot(4, 1.6 - 1.7 * 0.92, 0), 6);
  });

  it("frame composes a shot from the subject's size and facing", () => {
    const d = base({ shots: [{ at: 0, camera: "side" }], events: [{ at: 0, obj: "side", call: "frame", args: { subject: "hero", shot: "closeup" } }] });
    const s = stateAt(d, 0);
    close(s.camera.target, [2, 1.7 * 0.88, 0]);
    expect(s.camera.position[2]).toBeGreaterThan(0.5);
    expect(s.camera.position[0]).toBeCloseTo(2, 6);
  });
});

describe("Scene Phase 3: editing, agents, the benchmark", () => {
  it("cameras and shots are edited purely; tracks and calls include them", () => {
    let d = addSceneCamera(base({}, []), 0, { name: "Top" }).doc;
    expect(sceneCameraDefs(d).map((c) => c.id)).toEqual(["camera", "cam2"]);
    expect(d.world!.cameras![0]).toMatchObject({ id: "cam2", name: "Top", position: [0, 1.6, 6] });
    d = updateSceneCamera(d, "cam2", { lens: { focalLength: 24 } });
    expect(sceneCameraDefs(d)[1].fov).toBeCloseTo(focalToFov(24), 9);
    d = setSceneShots(d, [{ at: 2, camera: "camera" }, { at: 0, camera: "cam2" }]);
    expect(d.shots).toEqual([{ at: 0, camera: "cam2" }, { at: 2, camera: "camera" }]);
    expect(sceneShots(d).map((x) => x.camera)).toEqual(["cam2", "camera"]);
    expect(sceneTracks(d).find((t) => t.id === "cam2")).toMatchObject({ kind: "camera", camera: "cam2", label: "Top" });
    expect(sceneCalls(d, "cam2").map((c) => c.call)).toEqual(expect.arrayContaining(["moveTo", "orbit", "follow", "frame", "rackFocus", "handheld", "dolly"]));
    expect(sceneCallArgs(d, "cam2", "frame").map((f) => f.name)).toEqual(["subject", "shot", "angle", "height"]);
    expect(defaultCallArgs(d, "cam2", "frame", 0)).toEqual({ subject: "hero", shot: "medium" });
    expect(callTweens(d, "cam2", "orbit")).toBe(true);
    const gone = removeSceneCamera({ ...d, events: [{ at: 0, obj: "cam2", call: "truck", args: { distance: 1 } }] }, "cam2");
    expect(gone.world!.cameras).toBeUndefined();
    expect(gone.events).toEqual([]);
    expect(gone.shots).toEqual([{ at: 2, camera: "camera" }]);
  });

  it("agent tools: set_scene_camera, set_scene_shots, events on a camera, listing", () => {
    const ok = (r: ReturnType<typeof applySceneTool>) => { if (!r.ok) throw new Error(r.error); return r; };
    let d = base({}, []);
    d = ok(applySceneTool("set_scene_camera", d, { id: "close", lens: { focalLength: 50, fStop: 2 } })).doc;
    d = ok(applySceneTool("set_scene_shots", d, { shots: [{ at: 0, camera: "camera" }, { at: 2, camera: "close" }] })).doc;
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 2, obj: "close", call: "frame", args: { subject: "hero", shot: "closeup" } } })).doc;
    const bad = applySceneTool("set_scene_shots", d, { shots: [{ at: 1, camera: "nope" }] });
    expect(!bad.ok && bad.error).toMatch(/shots\[0\]\.camera: must be a camera id/);
    const list = sceneObjectsForAgent(d);
    expect(list.cameras.map((c) => c.id)).toEqual(["camera", "close"]);
    expect(list.shots).toEqual([{ at: 0, camera: "camera" }, { at: 2, camera: "close" }]);
    expect(list.cameraRigCalls).toContain("orbit");
    const notObj = applySceneTool("set_scene_object", d, { objectId: "close", props: { opacity: 1 } });
    expect(!notObj.ok && notObj.error).toMatch(/"close" is a camera/);
    d = ok(applySceneTool("set_scene_camera", d, { camera: "close", remove: true })).doc;
    expect(d.shots).toEqual([{ at: 0, camera: "camera" }]);
    expect(d.events).toEqual([]);
  });

  it("the benchmark is cut into four camera angles inside one scene", () => {
    expect(errors(BENCHMARK_SHOT)).toEqual([]);
    expect([1.5, 4.8, 8, 12].map((t) => stateAt(BENCHMARK_SHOT, t).cameraId)).toEqual(["camera", "follow", "orbit", "close"]);
    expect(JSON.stringify(stateAt(BENCHMARK_SHOT, 5.3))).toBe(JSON.stringify(stateAt(structuredClone(BENCHMARK_SHOT), 5.3)));
  });
});
