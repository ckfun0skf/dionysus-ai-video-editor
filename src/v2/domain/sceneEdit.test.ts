/**
 * P76 (Phase 2 step 2.3): the scene editor's pure edit operations and read models. Every operation returns a new scene
 * (its input is frozen here, so a mutation throws), keeps the scene valid, and leaves unrelated parts untouched.
 */
import { describe, expect, it } from "vitest";
import {
  addSceneEvent, addSceneLight, addSceneObject, callTweens, defaultCallArgs, duplicateSceneEvent, freeObjectId, objectIdProblem, removeSceneEvent,
  removeSceneLight, removeSceneObject, renameSceneObject, SAMPLE_SCENE, SCENE_DEFAULT_LIGHTS, sceneCallArgs, sceneCalls, sceneCameraBase, sceneLights,
  sceneSpan, sceneTracks, setSceneEventArg, setSceneEventCall, stateAt, updateSceneEvent, updateSceneLight, updateSceneObject, updateSceneWorld,
  validateScene, type SceneDoc,
} from ".";
import { bytesToDataUrl, makeAnimatedGlb } from "../ui/cubeGlb";
import { scenePage, scenePageKey } from "../render/scenePage";

const BOT = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); }
  return v;
}
const sample = (): SceneDoc => freeze(structuredClone(SAMPLE_SCENE));
const errors = (d: SceneDoc) => validateScene(d).filter((i) => i.level === "error");
const robot = (): SceneDoc => freeze({
  format: "dionysus.scene/1", files: { "bot.glb": BOT },
  objects: [{ id: "bot", model: "bot.glb", size: 1.6, animation: "Wave" }, { id: "ball", shape: "sphere", position: [1, 0.5, 0] }],
  events: [{ at: 1, obj: "ball", call: "lookAt", args: { target: "bot" } }, { at: 2, obj: "bot", call: "play", args: { clip: "Spin" }, dur: 0.5 }],
});

describe("scene edit: objects (P76)", () => {
  it("adds primitives with free ids, beside each other, valid", () => {
    let d = sample();
    const a = addSceneObject(d, "box"); d = freeze(a.doc);
    const b = addSceneObject(d, "box"); d = freeze(b.doc);
    const c = addSceneObject(d, "plane");
    expect([a.id, b.id, c.id]).toEqual(["box", "box-2", "plane"]);
    expect(c.doc.objects.at(-1)).toMatchObject({ id: "plane", shape: "plane", size: [2, 2], rotation: [-90, 0, 0], position: [expect.any(Number), 0, 0] });
    expect(a.doc.objects.at(-1)!.position).not.toEqual(b.doc.objects.at(-1)!.position);
    expect(errors(c.doc)).toEqual([]);
    expect(SAMPLE_SCENE.objects).toHaveLength(4);
    expect(freeObjectId(sample(), "camera")).toBe("camera-2");
    expect(freeObjectId(sample(), "3d")).toBe("obj-3d");
  });

  it("updates base properties; undefined removes a field; a new shape gets a fitting size; no change gives the same scene", () => {
    const d = sample();
    const n = updateSceneObject(d, "ball", { position: [0, 1, 0], color: undefined, opacity: 0.5 });
    expect(n.objects[1]).toMatchObject({ id: "ball", position: [0, 1, 0], opacity: 0.5 });
    expect("color" in n.objects[1]).toBe(false);
    expect(n.objects[1].functions).toBe(d.objects[1].functions);
    expect(n.objects[0]).toBe(d.objects[0]);
    expect(updateSceneObject(d, "cube", { shape: "cylinder" }).objects[2]).toMatchObject({ shape: "cylinder", size: [0.4, 1] });
    expect(errors(updateSceneObject(d, "cube", { shape: "torus" }))).toEqual([]);
    expect(updateSceneObject(d, "cube", { position: [1.4, 0.4, -0.5] })).toBe(d);
    expect(updateSceneObject(d, "nope", { opacity: 0 })).toBe(d);
  });

  it("renames an object: its events and lookAt targets follow; bad, reserved and taken ids are refused", () => {
    const d = robot();
    const r = renameSceneObject(d, "bot", "robot");
    expect(r.error).toBeUndefined();
    expect(r.doc.objects[0].id).toBe("robot");
    expect(r.doc.events).toEqual([{ at: 1, obj: "ball", call: "lookAt", args: { target: "robot" } }, { at: 2, obj: "robot", call: "play", args: { clip: "Spin" }, dur: 0.5 }]);
    expect(errors(r.doc)).toEqual([]);
    expect(renameSceneObject(d, "bot", "camera").error).toMatch(/reserved/);
    expect(renameSceneObject(d, "bot", "ball").error).toMatch(/already used/);
    expect(renameSceneObject(d, "bot", "9x").error).toMatch(/start with a letter/);
    expect(objectIdProblem(d, "bot", "bot")).toBeUndefined();
  });

  it("deletes an object with its events, the lookAts aimed at it and its model file when unused", () => {
    const r = removeSceneObject(robot(), "bot");
    expect(r.removedEvents).toBe(2);
    expect(r.doc.objects.map((o) => o.id)).toEqual(["ball"]);
    expect(r.doc.events).toEqual([]);
    expect(r.doc.files).toBeUndefined();
    expect(errors(r.doc)).toEqual([]);
    const s = removeSceneObject(sample(), "sign");
    expect(s.removedEvents).toBe(2);
    expect(s.doc.events!.map((e) => e.obj)).toEqual(["cube", "ball", "ball", "camera"]);
  });
});

describe("scene edit: world, camera and lights (P76)", () => {
  it("edits the background and the camera's start values", () => {
    const d = sample();
    const n = updateSceneWorld(d, { background: "#000000", camera: { fov: 55 } });
    expect(n.world).toMatchObject({ background: "#000000", camera: { fov: 55, position: [0, 1.6, 6], lookAt: [0, 0.8, 0] } });
    expect(n.world!.lights).toBe(d.world!.lights);
    expect(sceneCameraBase(n)).toEqual({ fov: 55, position: [0, 1.6, 6], lookAt: [0, 0.8, 0], background: "#000000" });
    expect(sceneCameraBase({ format: "dionysus.scene/1", objects: [] })).toEqual({ fov: 40, position: [0, 1.6, 6], lookAt: [0, 1, 0], background: "#101018" });
    expect(updateSceneWorld(d, { camera: { fov: 40 } })).toBe(d);
  });

  it("adding a light to a scene lit by the defaults keeps them; removing the last one goes back to the defaults", () => {
    const bare = freeze({ format: "dionysus.scene/1", objects: [] } as SceneDoc);
    expect(sceneLights(bare)).toEqual({ lights: [...SCENE_DEFAULT_LIGHTS], defaults: true });
    const one = addSceneLight(bare);
    expect(one.world!.lights).toEqual([...SCENE_DEFAULT_LIGHTS, { type: "point", color: "#ffffff", intensity: 1, position: [0, 3, 2] }]);
    const edited = updateSceneLight(bare, 1, { intensity: 2 });
    expect(edited.world!.lights![1]).toEqual({ type: "directional", position: [3, 5, 2], intensity: 2 });
    let d: SceneDoc = freeze(one);
    for (let i = 0; i < 3; i++) d = freeze(removeSceneLight(d, 0));
    expect(d.world!.lights).toEqual([]);
    expect(sceneLights(d).defaults).toBe(true);
    expect(errors(d)).toEqual([]);
  });
});

describe("scene edit: events (P76)", () => {
  it("adds an event at a time with the value the object has there (so nothing changes until it is edited)", () => {
    const d = sample();
    const { doc, index } = addSceneEvent(d, "ball", "moveTo", 1.25, 1);
    expect(index).toBe(6);
    const pos = stateAt(d, 1.25).objects.find((o) => o.id === "ball")!.position;
    expect(doc.events![6]).toEqual({ at: 1.25, obj: "ball", call: "moveTo", args: { position: pos.map((x) => Math.round(x * 1000) / 1000) }, dur: 1 });
    expect(errors(doc)).toEqual([]);
    expect(addSceneEvent(d, "sign", "visible", 0.5, 1).doc.events![6]).toEqual({ at: 0.5, obj: "sign", call: "visible", args: { value: false } });
    expect(addSceneEvent(d, "camera", "fov", 1).doc.events![6]).toEqual({ at: 1, obj: "camera", call: "fov", args: { value: 40 } });
    expect(defaultCallArgs(d, "ball", "setMood", 0)).toEqual({ mood: "calm" });
    expect(defaultCallArgs(robot(), "bot", "play", 0)).toEqual({ clip: "Spin" });
    expect(defaultCallArgs(robot(), "bot", "nodes", 0)).toEqual({ value: { Bot: false } });
  });

  it("retimes, lengthens, eases, sets args, changes call, duplicates and deletes", () => {
    const d = sample();
    const a = updateSceneEvent(d, 1, { at: 0.75004, dur: 2.0001, ease: "outBack" });
    expect(a.events![1]).toMatchObject({ at: 0.75, dur: 2, ease: "outBack" });
    expect(a.events![0]).toBe(d.events![0]);
    expect("dur" in updateSceneEvent(d, 1, { dur: 0 }).events![1]).toBe(false);
    expect(updateSceneEvent(d, 1, { at: 0.5 })).toBe(d);
    expect(setSceneEventArg(d, 2, "mood", "calm").events![2].args).toEqual({ mood: "calm" });
    const c = setSceneEventCall(d, 4, "visible");
    expect(c.events![4]).toEqual({ at: 3, obj: "sign", call: "visible", args: { value: false } });
    expect(setSceneEventCall(d, 1, "color").events![1]).toMatchObject({ call: "color", args: { value: "#5ad1c8" }, dur: 1.5, ease: "inOutCubic" });
    const dup = duplicateSceneEvent(d, 1);
    expect(dup.index).toBe(6);
    expect(dup.doc.events![6]).toEqual({ ...d.events![1], at: 2 });
    expect(removeSceneEvent(d, 0).events).toEqual(d.events!.slice(1));
    for (const x of [a, c, dup.doc]) expect(errors(x)).toEqual([]);
  });

  it("lists the calls of an object (animation calls for models only), of the camera, and their argument fields", () => {
    const r = robot();
    expect(sceneCalls(r, "ball").map((c) => c.call)).toEqual(["position", "moveTo", "rotation", "lookAt", "scale", "visible", "opacity", "color"]);
    expect(sceneCalls(r, "bot").map((c) => c.call)).toContain("play");
    expect(sceneCalls(sample(), "ball").at(-1)).toMatchObject({ call: "setMood", kind: "custom", description: "Colour and size for a mood." });
    expect(sceneCalls(r, "camera").map((c) => c.call)).toEqual(["position", "moveTo", "lookAt", "fov", "focalLength", "focus", "fStop", "rackFocus", "dolly", "truck", "crane", "orbit", "follow", "handheld", "frame"]);
    expect(sceneCallArgs(r, "bot", "play")[0]).toEqual({ name: "clip", kind: "select", label: "Animation", options: ["Wave", "Spin", "Bounce"], free: true });
    expect(sceneCallArgs(r, "bot", "nodes")[0]).toMatchObject({ kind: "nodes", nodes: ["Bot", "Body", "Head", "Arm"] });
    expect(sceneCallArgs(sample(), "ball", "setMood")).toEqual([{ name: "mood", kind: "param", label: "mood", param: { type: "select", options: ["calm", "alert"], default: "calm" } }]);
    expect(callTweens(r, "ball", "visible")).toBe(false);
    expect(callTweens(r, "camera", "lookAt")).toBe(true);
  });
});

describe("scene tracks (P76)", () => {
  it("P81b: the Scene track (no events), the Camera track, one per object, one per light, then unknown objects; overlapping blocks stack in rows", () => {
    const d = freeze({ ...structuredClone(SAMPLE_SCENE), events: [...SAMPLE_SCENE.events!, { at: 1, obj: "ball", call: "opacity", args: { value: 0.5 } }, { at: 1, obj: "ghost", call: "moveTo", args: { position: [0, 0, 0] } }] } as SceneDoc);
    const t = sceneTracks(d, 0.4);
    expect(t.map((x) => [x.id, x.kind, x.rows])).toEqual([["#scene", "scene", 1], ["camera", "camera", 1], ["floor", "shape", 1], ["ball", "shape", 2], ["cube", "shape", 1], ["sign", "shape", 1],
      ["#light-0", "light", 1], ["#light-1", "light", 1], ["", "missing", 1]]);
    expect(t.filter((x) => x.kind === "light").map((x) => [x.label, x.detail, x.light])).toEqual([["Light 1", "hemisphere light", 0], ["Light 2", "directional light", 1]]);
    expect(t[0].blocks).toEqual([]);
    expect(t[3].blocks).toEqual([
      { index: 1, at: 0.5, dur: 1.5, end: 2, call: "moveTo", row: 0 },
      { index: 6, at: 1, dur: 0, end: 1, call: "opacity", row: 1 },
      { index: 2, at: 2, dur: 0.4, end: 2.4, call: "setMood", row: 0 },
    ]);
    expect(t[5].blocks.map((b) => b.row)).toEqual([0, 0]);
    expect(sceneTracks(d, 1)[5].blocks.map((b) => b.row)).toEqual([0, 1]);
    expect(t[1].blocks.map((b) => b.call)).toEqual(["moveTo"]);
    expect(sceneSpan(d)).toBe(5);
    expect(sceneSpan(d, 7)).toBe(7);
  });

  it("the page key ignores events and properties (the preview keeps the page) but not objects, shapes, models or lights", () => {
    const d = sample();
    const k = scenePageKey(d);
    expect(scenePageKey(updateSceneEvent(d, 1, { at: 1 }))).toBe(k);
    expect(scenePageKey(updateSceneObject(d, "ball", { position: [0, 2, 0], color: "#000000" }))).toBe(k);
    expect(scenePageKey(updateSceneWorld(d, { background: "#000000", camera: { fov: 20 } }))).toBe(k);
    expect(scenePageKey(updateSceneObject(d, "ball", { shape: "box" }))).not.toBe(k);
    expect(scenePageKey(addSceneObject(d, "box").doc)).not.toBe(k);
    expect(scenePageKey(updateSceneLight(d, 0, { intensity: 3 }))).not.toBe(k);
    expect(scenePageKey(robot())).not.toBe(scenePageKey({ ...robot(), files: { "bot.glb": `${BOT}A` } }));
    // Same key ⇒ the page reads the same: it only takes lights and id / shape / size / model from the embedded scene.
    const strip = (x: SceneDoc) => scenePage({ format: x.format, world: { lights: x.world?.lights }, objects: x.objects.map((o) => ({ id: o.id, shape: o.shape, size: o.size, model: o.model })), files: x.files });
    expect(strip(updateSceneObject(d, "ball", { position: [0, 2, 0] }))).toBe(strip(d));
  });
});

describe("P81b light ids", () => {
  it("are optional, unique among objects and lights, never \"camera\"; events can't name a light", async () => {
    const { lightIdProblem, sceneLightIndex, sceneLightLabel, objectIdProblem, addSceneObject } = await import(".");
    const d = freeze(structuredClone(SAMPLE_SCENE) as SceneDoc);
    const named = updateSceneLight(d, 1, { id: "key" });
    expect(named.world!.lights![1]).toEqual({ id: "key", type: "directional", position: [3, 5, 2], intensity: 1.6 });
    expect(validateScene(named).filter((i) => i.level === "error")).toEqual([]);
    expect(sceneLightIndex(named, "key")).toBe(1);
    expect(sceneLightIndex(named, 0)).toBe(0);
    expect(sceneLightIndex(named, "nope")).toBeUndefined();
    expect(sceneLightLabel(named.world!.lights![1], 1)).toBe("key");
    expect(lightIdProblem(named, 0, "key")).toMatch(/another light/);
    expect(lightIdProblem(named, 0, "ball")).toMatch(/an object/);
    expect(lightIdProblem(named, 0, "camera")).toMatch(/reserved/);
    expect(lightIdProblem(named, 0, "2x")).toMatch(/start with a letter/);
    expect(lightIdProblem(named, 1, "key")).toBeUndefined();
    expect(objectIdProblem(named, "ball", "key")).toMatch(/a light/);
    expect(addSceneObject(updateSceneLight(d, 1, { id: "box" }), "box").id).toBe("box-2");
    const bad = (raw: unknown) => validateScene(raw).filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`);
    const lights = (ls: unknown[]) => ({ ...structuredClone(SAMPLE_SCENE), world: { lights: ls } });
    expect(bad(lights([{ type: "point", id: "a" }, { type: "point", id: "a" }]))).toEqual(['world.lights[1].id: "a" is used twice.']);
    expect(bad(lights([{ type: "point", id: "camera" }]))).toEqual(['world.lights[0].id: "camera" is reserved for the camera.']);
    expect(bad(lights([{ type: "point", id: 3 }]))[0]).toMatch(/^world.lights\[0\].id: must start with a letter/);
    expect(bad(lights([{ type: "point", id: "ball" }]))).toEqual(['objects[1].id: "ball" is the id of a light (world.lights[0]).']);
    // Scene Phase 1 (#350): a light with an id takes events.
    expect(bad({ ...lights([{ type: "point", id: "key" }]), events: [{ at: 0, obj: "key", call: "moveTo", args: { position: [0, 0, 0] } }] })).toEqual([]);
    expect(bad({ ...lights([{ type: "point", id: "key" }]), events: [{ at: 0, obj: "key", call: "spin" }] })[0]).toMatch(/^events\[0\]\.call: The light "key" has no function "spin"/);
  });
});
