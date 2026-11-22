/**
 * P78 (Phase 2 step 2.5): the pure operations behind the scene agent tools. Each one leaves its input alone, refuses
 * unknown objects, calls and arguments with the valid ones listed, refuses edits that would make the scene invalid
 * (nothing changes), and reports the warnings it touches.
 */
import { describe, expect, it } from "vitest";
import { applySceneTool, argHint, newSceneFromInput, SAMPLE_SCENE, sceneForAgent, sceneObjectsForAgent, validateScene, type SceneDoc } from ".";
import { bytesToDataUrl, makeAnimatedGlb } from "../ui/cubeGlb";

function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); }
  return v;
}
const sample = (): SceneDoc => freeze(structuredClone(SAMPLE_SCENE));
const ok = (r: ReturnType<typeof applySceneTool>) => { if (!r.ok) throw new Error(r.error); return r; };
const err = (r: ReturnType<typeof applySceneTool>) => { if (r.ok) throw new Error("expected an error"); return r.error; };
const errors = (d: SceneDoc) => validateScene(d).filter((i) => i.level === "error");
const BOT = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");

describe("scene agent: objects (P78)", () => {
  it("adds a shape with an id and fields, a GLB model from a file, or a model from a file already there", () => {
    const a = ok(applySceneTool("add_scene_object", sample(), { shape: "torus", id: "ring", props: { position: [0, 1, 0], color: "#ff00ff" } }));
    expect(a.info.objectId).toBe("ring");
    expect(a.doc.objects.at(-1)).toMatchObject({ id: "ring", shape: "torus", position: [0, 1, 0], color: "#ff00ff" });
    expect(errors(a.doc)).toEqual([]);
    const m = ok(applySceneTool("add_scene_object", sample(), { file: { name: "bot.glb", dataUrl: BOT }, id: "bot" }));
    expect(m.doc.objects.at(-1)).toMatchObject({ id: "bot", model: "bot.glb" });
    expect(m.doc.files!["bot.glb"]).toBe(BOT);
    const again = ok(applySceneTool("add_scene_object", freeze(m.doc), { model: "bot.glb", id: "bot2", props: { animation: "Spin" } }));
    expect(again.doc.objects.at(-1)).toMatchObject({ id: "bot2", model: "bot.glb", animation: "Spin" });
    expect(Object.keys(again.doc.files!)).toEqual(["bot.glb"]);
  });

  it("refuses bad shapes, ids, files and fields with the valid choices", () => {
    expect(err(applySceneTool("add_scene_object", sample(), { shape: "star" }))).toMatch(/box, sphere, cylinder, cone, torus, plane/);
    expect(err(applySceneTool("add_scene_object", sample(), { shape: "box", id: "ball" }))).toMatch(/"id":.*ball/);
    expect(err(applySceneTool("add_scene_object", sample(), { file: { name: "x.gltf", dataUrl: "data:x" } }))).toMatch(/\.glb/);
    expect(err(applySceneTool("add_scene_object", sample(), { model: "nope.glb" }))).toMatch(/No file "nope\.glb".*Files: none/);
    expect(err(applySceneTool("add_scene_object", sample(), { props: { colour: "#fff" } }))).toMatch(/Unknown object field "colour". Fields: name, shape, size, color/);
    expect(err(applySceneTool("add_scene_object", sample(), { props: { color: "red" } }))).toMatch(/would not be valid, nothing changed: objects\[4\]\.color/);
  });

  it("sets fields (null removes), renames with references, replaces functions; removes with events", () => {
    const d = sample();
    const s = ok(applySceneTool("set_scene_object", d, { objectId: "ball", rename: "orb", props: { color: "#000000", opacity: null } }));
    expect(s.doc.objects[1]).toMatchObject({ id: "orb", color: "#000000" });
    expect(s.doc.events!.filter((e) => e.obj === "orb")).toHaveLength(2);
    const f = ok(applySceneTool("set_scene_object", d, { objectId: "cube", props: { functions: { spin: { params: { turns: { type: "number", default: 1 } }, set: { rotation: [0, 360, 0] } } } } }));
    expect(f.doc.objects[2].functions).toHaveProperty("spin");
    const none = ok(applySceneTool("set_scene_object", d, { objectId: "cube", props: {} }));
    expect(none.doc).toBe(d);
    expect(none.info.unchanged).toBe(true);
    expect(err(applySceneTool("set_scene_object", d, { objectId: "ghost", props: {} }))).toBe('No object "ghost". Objects: camera, floor, ball, cube, sign. Add one with add_scene_object.');
    expect(err(applySceneTool("set_scene_object", d, { objectId: "camera", props: {} }))).toMatch(/set_scene_world/);
    const r = ok(applySceneTool("remove_scene_object", d, { objectId: "ball" }));
    expect(r.info).toMatchObject({ removed: "ball", removedEvents: 2 });
    expect(r.doc.objects.map((o) => o.id)).toEqual(["floor", "cube", "sign"]);
  });
});

describe("scene agent: events (P78)", () => {
  it("adds an event, filling missing arguments with the value at that time; drops dur on calls that never tween", () => {
    const d = sample();
    const a = ok(applySceneTool("add_scene_event", d, { event: { at: 1, obj: "cube", call: "moveTo", args: { position: [0, 0.4, 1] }, dur: 1, ease: "outBack" } }));
    expect(a.info).toMatchObject({ index: 6, event: { at: 1, obj: "cube", call: "moveTo", args: { position: [0, 0.4, 1] }, dur: 1, ease: "outBack" } });
    const b = ok(applySceneTool("add_scene_event", d, { event: { at: 2, obj: "camera", call: "fov" } }));
    expect(b.info).toMatchObject({ event: { args: { value: 40 } }, notes: [expect.stringMatching(/Filled value/)] });
    const c = ok(applySceneTool("add_scene_event", d, { event: { at: 2, obj: "sign", call: "visible", args: { value: false }, dur: 1 } }));
    expect((c.info.event as { dur?: number }).dur).toBeUndefined();
    expect(c.info.notes).toEqual([expect.stringMatching(/never tweens/)]);
    const custom = ok(applySceneTool("add_scene_event", d, { event: { at: 4, obj: "ball", call: "setMood", args: { mood: "calm" }, dur: 0.5 } }));
    expect(errors(custom.doc)).toEqual([]);
  });

  it("refuses unknown objects, calls, arguments and values, listing the valid ones", () => {
    const d = sample();
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "dog", call: "moveTo" } }))).toMatch(/No object "dog". Objects: camera, floor, ball, cube, sign/);
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "ball", call: "jump" } }))).toBe('"ball" has no call "jump". Its calls: position, moveTo, rotation, lookAt, scale, visible, opacity, color; its own functions: setMood.');
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "ball", call: "moveTo", args: { to: [0, 0, 0] } } }))).toBe('ball.moveTo has no argument "to". It takes position: [x, y, z].');
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "ball", call: "setMood", args: { mood: "sad" } } }))).toMatch(/would not be valid.*events\[6\]/);
    expect(err(applySceneTool("add_scene_event", d, { event: { at: -1, obj: "ball", call: "opacity" } }))).toMatch(/"at"/);
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "ball", call: "opacity", ease: "bouncy" } }))).toMatch(/linear, in, out/);
    expect(err(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "ball", call: "play" } }))).toMatch(/has no call "play"/);
    expect(err(applySceneTool("add_scene_event", d, {}))).toMatch(/"event" must be/);
    expect(argHint({ name: "mood", kind: "param", label: "mood", param: { type: "select", options: ["calm", "alert"], default: "calm" } })).toBe('select "calm" | "alert" (default "calm")');
  });

  it("updates (merge, null removes, new call resets args, another object), retimes and removes events", () => {
    const d = sample();
    const u = ok(applySceneTool("update_scene_event", d, { index: 1, ease: null, args: { position: [1, 1, 1] }, dur: 2 }));
    expect(u.doc.events![1]).toEqual({ at: 0.5, obj: "ball", call: "moveTo", args: { position: [1, 1, 1] }, dur: 2 });
    const c = ok(applySceneTool("update_scene_event", d, { index: 1, call: "opacity", args: { value: 0.5 } }));
    expect(c.doc.events![1]).toMatchObject({ call: "opacity", args: { value: 0.5 } });
    const o = ok(applySceneTool("update_scene_event", d, { index: 1, obj: "cube" }));
    expect(o.doc.events![1].obj).toBe("cube");
    expect(err(applySceneTool("update_scene_event", d, { index: 2, obj: "cube" }))).toMatch(/no setMood/);
    expect(err(applySceneTool("update_scene_event", d, { index: 9 }))).toBe('"index" must be an event index 0..5 (list_scene_objects lists them).');
    const t = ok(applySceneTool("retime_scene_event", d, { index: 1, shiftSec: 0.25, dur: 1 }));
    expect(t.doc.events![1]).toMatchObject({ at: 0.75, dur: 1 });
    expect(ok(applySceneTool("retime_scene_event", d, { index: 1, at: 3 })).doc.events![1].at).toBe(3);
    expect(err(applySceneTool("retime_scene_event", d, { index: 1, shiftSec: -1 }))).toMatch(/-0\.5 s/);
    expect(err(applySceneTool("retime_scene_event", d, { index: 5, dur: 1 }))).toMatch(/sign\.visible never tweens/);
    expect(err(applySceneTool("retime_scene_event", d, { index: 1, at: 1, shiftSec: 1 }))).toMatch(/not both/);
    const r = ok(applySceneTool("remove_scene_event", d, { index: 0 }));
    expect(r.doc.events).toHaveLength(5);
    expect(r.info.removed).toMatchObject({ obj: "cube", call: "rotation" });
  });
});

describe("scene agent: world, new scenes, read models (P78)", () => {
  it("sets name, length, background, camera start and lights (null = defaults)", () => {
    const d = sample();
    const w = ok(applySceneTool("set_scene_world", d, { name: "Demo", durationSec: 3, background: "#000000", camera: { fov: 30 }, lights: [{ type: "point", position: [0, 3, 0] }] }));
    expect(w.doc).toMatchObject({ name: "Demo", durationSec: 3, world: { background: "#000000", camera: { fov: 30, position: [0, 1.6, 6] }, lights: [{ type: "point" }] } });
    expect(ok(applySceneTool("set_scene_world", d, { lights: null })).doc.world!.lights).toBeUndefined();
    expect(err(applySceneTool("set_scene_world", d, { camera: { zoom: 2 } }))).toMatch(/Unknown camera field "zoom"/);
    expect(err(applySceneTool("set_scene_world", d, { lights: [{ type: "laser" }] }))).toMatch(/would not be valid/);
  });

  it("new scenes: empty by default, an object or JSON text, validated", () => {
    const e = newSceneFromInput(undefined, 4);
    expect("doc" in e && e.doc).toMatchObject({ format: "dionysus.scene/1", durationSec: 4, objects: [] });
    expect("doc" in newSceneFromInput(JSON.stringify(SAMPLE_SCENE))).toBe(true);
    expect("doc" in newSceneFromInput({ objects: [{ id: "a", shape: "box" }] })).toBe(true);
    expect(newSceneFromInput("{")).toEqual({ error: '"scene" is not valid JSON.' });
    expect((newSceneFromInput({ objects: [{ id: "a", shape: "star" }] }) as { error: string }).error).toMatch(/not valid: objects\[0\]/);
  });

  it("read models list calls with argument hints and shorten embedded files", () => {
    const v = sceneObjectsForAgent(SAMPLE_SCENE);
    const ball = v.objects.find((o) => o.id === "ball")!;
    expect(ball.functions).toEqual(["setMood"]);
    expect(ball.calls.find((c) => c.call === "moveTo")).toMatchObject({ kind: "base", tweens: true, args: { position: "[x, y, z]" } });
    expect(ball.calls.find((c) => c.call === "setMood")).toMatchObject({ kind: "custom", args: { mood: 'select "calm" | "alert" (default "calm")' } });
    expect(v.camera.calls.map((c) => c.call)).toEqual(["position", "moveTo", "lookAt", "fov"]);
    expect(v.events.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    const withFile = ok(applySceneTool("add_scene_object", sample(), { file: { name: "bot.glb", dataUrl: BOT } })).doc;
    expect(sceneForAgent(withFile).files!["bot.glb"]).toMatch(/^<data:model\/gltf-binary;base64,… \d+ chars>$/);
    expect(sceneObjectsForAgent(withFile).objects.at(-1)!.calls.map((c) => c.call)).toContain("play");
  });
});

describe("scene agent: lights and the camera (P81b)", () => {
  it("set_scene_light changes one light by id or index, adds one, removes one; ids are checked; lights take no events", () => {
    const d = sample();
    const named = ok(applySceneTool("set_scene_light", d, { light: 1, id: "key", intensity: 2 }));
    expect(named.doc.world!.lights![1]).toEqual({ id: "key", type: "directional", position: [3, 5, 2], intensity: 2 });
    expect(named.info).toMatchObject({ lightIndex: 1 });
    const moved = ok(applySceneTool("set_scene_light", freeze(named.doc), { light: "key", position: [1, 4, 0], color: "#ffeecc" }));
    expect(moved.doc.world!.lights![1]).toMatchObject({ id: "key", position: [1, 4, 0], color: "#ffeecc" });
    const added = ok(applySceneTool("set_scene_light", d, { type: "point", id: "rim" }));
    expect(added.doc.world!.lights![2]).toEqual({ id: "rim", type: "point", color: "#ffffff", intensity: 1, position: [0, 3, 2] });
    expect(ok(applySceneTool("set_scene_light", freeze(named.doc), { light: "key", remove: true })).doc.world!.lights).toHaveLength(1);
    expect(ok(applySceneTool("set_scene_light", freeze(named.doc), { light: "key", id: null })).doc.world!.lights![1].id).toBeUndefined();
    expect(err(applySceneTool("set_scene_light", d, { light: "nope" }))).toMatch(/No light "nope". Lights: 0 \(hemisphere\), 1 \(directional\)/);
    expect(err(applySceneTool("set_scene_light", d, { light: 0, id: "ball" }))).toMatch(/"id": "ball" is the id of an object/);
    expect(err(applySceneTool("set_scene_light", d, { light: 0, type: "laser" }))).toMatch(/"type" must be one of/);
    expect(err(applySceneTool("set_scene_light", d, { light: 0, position: [1, 2] }))).toMatch(/"position" must be \[x, y, z\]/);
    // A scene on the default lights gets them written out first.
    const bare = freeze({ format: "dionysus.scene/1", objects: [] } as SceneDoc);
    expect(ok(applySceneTool("set_scene_light", bare, { light: 1, position: [0, 6, 0] })).doc.world!.lights).toEqual([{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [0, 6, 0], intensity: 1.5 }]);
    // Scene Phase 1 (#350): a light with an id takes events; set_scene_object on it points to set_scene_light.
    expect(ok(applySceneTool("add_scene_event", freeze(named.doc), { event: { at: 0, obj: "key", call: "intensity", args: { value: 2 }, dur: 1 } })).info.index).toBe(named.doc.events!.length);
    expect(err(applySceneTool("set_scene_object", freeze(named.doc), { objectId: "key", props: { opacity: 0.5 } }))).toMatch(/"key" is a light: change it with set_scene_light/);
  });

  it("list_scene_objects lists the camera's start and the lights with their index and id", () => {
    const v = sceneObjectsForAgent(ok(applySceneTool("set_scene_light", sample(), { light: 1, id: "key" })).doc);
    expect(v.camera.start).toEqual({ fov: 40, position: [0, 1.6, 6], lookAt: [0, 0.8, 0] });
    expect(v.lights).toEqual([{ index: 0, type: "hemisphere", intensity: 1.1 }, { index: 1, id: "key", type: "directional", position: [3, 5, 2], intensity: 1.6, calls: expect.any(Array) }]);
    expect(v.defaultLights).toBe(false);
    expect(sceneObjectsForAgent({ format: "dionysus.scene/1", objects: [] } as SceneDoc).defaultLights).toBe(true);
  });
});
