import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import {
  addSceneAnimation, addSceneCharacter, applySceneTool, audioVisemeFrames, autoRig, blendYaw, blinkAt, BUILTIN_CLIPS, callTweens, defaultCallArgs, floorPath,
  readManifest, removeSceneAnimation, sceneCallArgs, sceneCalls, sceneClipInfo, sceneObjectsForAgent, sceneTracks, stateAt, validateScene,
  visemesAt, visemesFromEnergy, visemesFromText, walkProfile, type SceneDoc,
} from ".";
import { BENCHMARK_SHOT } from "./__fixtures__/benchmarkShot";
import { bytesToDataUrl, makeAnimatedGlb } from "../ui/cubeGlb";
import { scenePage, scenePageKey } from "../render/scenePage";
import { sceneEditPage } from "../render/sceneEditPage";
import { libById } from "../render/htmlLibs";

const errors = (raw: unknown) => validateScene(raw).filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`);
const warnings = (raw: unknown) => validateScene(raw).filter((i) => i.level === "warning").map((i) => `${i.path}: ${i.message}`);
const doc = (events: SceneDoc["events"] = [], extra: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "dionysus.scene/1",
  objects: [
    { id: "bob", character: {} },
    { id: "ann", character: { body: { height: 1.5 } }, position: [-2, 0, 0] },
    { id: "bench", shape: "box", size: [1.2, 0.45, 0.4], position: [3, 0.22, 0], rotation: [0, -90, 0] },
    { id: "cup", shape: "sphere", size: 0.08, position: [0, 0.9, 1] },
  ],
  events,
  ...extra,
});
const bob = (d: SceneDoc, t: number) => stateAt(d, t).objects.find((o) => o.id === "bob")!;

describe("Scene Phase 2 (#351): helpers", () => {
  it("auto-detects Mixamo and common humanoid bone names", () => {
    const mixamo = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck", "mixamorig:Head", "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
      "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot", "mixamorig:RightUpLeg", "mixamorig:RightLeg", "mixamorig:RightFoot"];
    const r = autoRig(mixamo);
    expect(r.missing).toEqual([]);
    expect(r.rig).toMatchObject({ hips: "mixamorig:Hips", chest: "mixamorig:Spine1", upperChest: "mixamorig:Spine2", leftUpperArm: "mixamorig:LeftArm", leftLowerArm: "mixamorig:LeftForeArm", leftUpperLeg: "mixamorig:LeftUpLeg", leftLowerLeg: "mixamorig:LeftLeg" });
    expect(autoRig(["pelvis", "spine_01", "head", "upperarm_l", "lowerarm_l", "hand_l", "thigh_r", "calf_r", "foot_r"]).rig).toMatchObject({ hips: "pelvis", leftUpperArm: "upperarm_l", leftLowerArm: "lowerarm_l", rightUpperLeg: "thigh_r", rightLowerLeg: "calf_r" });
    expect(autoRig(["Cube"]).missing).toContain("hips");
  });

  it("walks a trapezoid speed profile and a floor path with rounded corners", () => {
    const p = walkProfile(10, 2, 0.4);
    expect(p.total).toBeCloseTo(5.4, 9);
    expect(p.at(0).d).toBe(0);
    expect(p.at(2.7).speed).toBe(2);
    expect(p.at(5.4).d).toBeCloseTo(10, 9);
    const short = walkProfile(0.2, 2, 0.4); // a triangle
    expect(short.at(short.total).d).toBeCloseTo(0.2, 9);
    const path = floorPath([0, 0, 0], [[2, 5, 0], [2, 0, 2]]);
    expect(path.len).toBe(4);
    expect(path.at(1)).toEqual({ p: [1, 0, 0], yaw: 90 });
    expect(path.at(4).p).toEqual([2, 0, 2]);
    expect(path.at(2).yaw).toBeCloseTo(45, 6); // halfway round the corner
    expect(blendYaw(350, 10, 0.5)).toBe(360);
  });

  it("visemes from text (any script), bells over time, blinks seeded by id, and from audio energy", () => {
    const v = visemesFromText("Hello there!", 1);
    expect(v.map((x) => x[1])).toEqual(["ee", "oh", "ee", "ee"]);
    expect(v[0][0]).toBe(0.125);
    expect(visemesFromText("こんにちは", 1).length).toBe(5);
    expect(visemesAt(v, 0.125, 1).ee).toBeCloseTo(1, 6);
    expect(visemesAt(v, 5, 1)).toEqual({});
    expect(blinkAt("bob", 1.2)).toBe(blinkAt("bob", 1.2));
    const blinks = Array.from({ length: 2000 }, (_, i) => blinkAt("bob", i / 100)).filter((x) => x > 0.5).length;
    expect(blinks).toBeGreaterThan(20); // a few blinks in 20 s, each ~0.16 s
    expect(blinks).toBeLessThan(120);
    // A 1 s 220 Hz tone that is loud for its first half: the mouth opens there only.
    const sr = 8000, s = new Float32Array(sr);
    for (let i = 0; i < sr; i++) s[i] = (i < sr / 2 ? 0.8 : 0.01) * Math.sin((2 * Math.PI * 220 * i) / sr);
    const keys = visemesFromEnergy(audioVisemeFrames(s, sr), 0.01);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.every((k) => k[0] < 0.55)).toBe(true);
    expect(["oh", "ou"]).toContain(keys[3][1]); // a low tone: rounded lips
    expect(visemesFromEnergy(audioVisemeFrames(s, sr), 0.01)).toEqual(keys);
  });
});

describe("Scene Phase 2: validation", () => {
  it("characters, their events and the animation library", () => {
    expect(errors(doc())).toEqual([]);
    expect(errors({ ...doc(), objects: [{ id: "x", character: { body: { height: 9, glow: 1 }, blink: "yes" } }] })).toEqual([
      "objects[0].character.body.height: must be a number of units from 0.3 to 4.", "objects[0].character.body.glow: is not a body field (height, skin, cloth, pants, hair, shoes).", "objects[0].character.blink: must be true or false.",
    ]);
    expect(errors({ ...doc(), objects: [{ id: "x", character: {}, script: { file: "a.js" } }] })).toContain("objects[0].character: A Script object can't be a character (use the mannequin, a .vrm or a humanoid .glb).");
    const ev = (e: Record<string, unknown>) => errors(doc([{ at: 0, obj: "bob", ...e } as never]));
    expect(ev({ call: "walkTo", args: { path: [[1, 0, 0], [2, 0, 1]], speed: 2 } })).toEqual([]);
    expect(ev({ call: "walkTo", args: { path: "there" } })).toEqual(["events[0].args.path: must be a point [x, y, z] or a list of points (at most 256)."]);
    expect(ev({ call: "lookAt", args: { target: "camera", weight: 0.5 } })).toEqual([]);
    expect(ev({ call: "lookAt", args: { target: "bob" } })).toEqual(['events[0].args.target: must be another object id, [x, y, z] or "camera".']);
    expect(ev({ call: "turnTo", args: { target: 90 } })).toEqual([]);
    expect(ev({ call: "sit", args: { seat: "bench" } })).toEqual([]);
    expect(ev({ call: "gesture", args: { clip: "moonwalk" } })[0]).toMatch(/"moonwalk" is not a built-in clip/);
    expect(ev({ call: "expression", args: { value: { happy: 2 } } })).toEqual(["events[0].args.value: has happy that is not a number from 0 to 1."]);
    expect(ev({ call: "speak", args: {} })).toEqual(["events[0].args: speak needs text or visemes."]);
    expect(ev({ call: "speak", args: { visemes: [[0.1, "aa", 1], [0.2, "zz", 1]] } })[0]).toMatch(/visemes: has an item that is not/);
    expect(ev({ call: "pickUp", args: { object: "ann" } })).toEqual(["events[0].args.object: A character can't be picked up."]);
    expect(ev({ call: "play", args: { clip: "talk", loop: "once" } })).toEqual([]);
    expect(ev({ call: "walkTo", args: { path: [1, 0, 0], extra: 1 } })).toEqual(["events[0].args.extra: walkTo takes path, speed."]);
    // A non-character keeps the old rules: lookAt turns the object, play needs a model.
    expect(errors(doc([{ at: 0, obj: "cup", call: "play", args: { clip: "wave" } }]))[0]).toMatch(/has no model/);
    // The library: a readable GLB with animations.
    const glb = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    const lib = addSceneAnimation(doc(), "dance.glb", glb, "dance", { clip: "Wave", stride: 1.2 }).doc;
    expect(errors(lib)).toEqual([]);
    expect(warnings({ ...lib, animations: { dance: { file: "dance.glb", clip: "Nope" } } })[0]).toMatch(/has no animation "Nope"/);
    expect(errors({ ...lib, animations: { dance: { file: "dance.glb", stride: -1 } } })).toEqual(["animations.dance.stride: must be metres per cycle above 0."]);
    expect(errors(doc([{ at: 0, obj: "bob", call: "gesture", args: { clip: "dance" } }], { files: lib.files, animations: lib.animations }))).toEqual([]);
  });

  it("a humanoid GLB without the bones the rig needs is warned about; a .vrm character is a model", () => {
    const glb = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    const d: SceneDoc = { format: "dionysus.scene/1", files: { "bot.glb": glb, "girl.vrm": glb }, objects: [{ id: "bot", model: "bot.glb", character: {} }, { id: "girl", model: "girl.vrm", character: {} }] };
    expect(warnings(d).join(" ")).toMatch(/"bot.glb" has no hips, spine, leftUpperArm/);
    expect(warnings(d).join(" ")).not.toMatch(/girl.vrm/);
  });
});

describe("Scene Phase 2: evaluation (from the document and t alone)", () => {
  const walk = doc([{ at: 1, obj: "bob", call: "walkTo", args: { path: [[4, 0, 0]], speed: 1.3 } }]);
  it("walkTo moves along the path with a speed-matched cycle (no foot sliding) and turns along it", () => {
    expect(bob(walk, 0).character!.layers).toEqual([{ clip: "idle", time: 0, weight: 1, loop: "repeat", mask: "full" }]);
    const mid = bob(walk, 3);
    expect(mid.position[0]).toBeCloseTo(0.5 * 1.3 * 0.4 + 1.3 * (2 - 0.4), 9);
    expect(mid.rotation[1]).toBe(90);
    const w = mid.character!.layers.find((l) => l.clip === "walk")!;
    // The cycle's time is the distance walked over the stride (1.3 m per 1 s cycle at 1.7 m tall).
    expect(w.time).toBeCloseTo(mid.position[0] / 1.3, 9);
    expect(w.weight).toBe(1);
    const end = 1 + 4 / 1.3 + 0.4;
    expect(bob(walk, end + 1).position).toEqual([4, 0, 0]);
    expect(bob(walk, end + 1).character!.layers.map((l) => l.clip)).toEqual(["idle"]);
    // A shorter character takes shorter strides (more cycles for the same distance).
    const ann = stateAt(doc([{ at: 0, obj: "ann", call: "walkTo", args: { path: [[2, 0, 0]] } }]), 1).objects[1];
    const aw = ann.character!.layers.find((l) => l.clip === "walk")!;
    expect(aw.time).toBeCloseTo((ann.position[0] + 2) / (1.3 * 1.5 / 1.7), 9);
    // A later move cuts the walk.
    const cut = doc([...walk.events!, { at: 2, obj: "bob", call: "moveTo", args: { position: [0, 0, 5] } }]);
    expect(bob(cut, 2.5).character!.layers.map((l) => l.clip)).toEqual(["idle"]);
  });

  it("turnTo, sit / stand, gestures on the upper body, play / stop", () => {
    const d = doc([
      { at: 0, obj: "bob", call: "turnTo", args: { target: "bench" }, dur: 1 },
      { at: 2, obj: "bob", call: "sit", args: { seat: "bench" }, dur: 1 },
      { at: 2.5, obj: "bob", call: "gesture", args: { clip: "wave" } },
      { at: 6, obj: "bob", call: "stand", dur: 1 },
      { at: 8, obj: "bob", call: "play", args: { clip: "talk" }, dur: 0.5 },
      { at: 10, obj: "bob", call: "stop", dur: 0.5 },
    ]);
    expect(bob(d, 1).rotation).toEqual([0, 90, 0]);
    expect(bob(d, 3).position).toEqual([3, 0, 0]);
    expect(bob(d, 3).rotation).toEqual([0, -90, 0]); // the seat's facing
    const sitting = bob(d, 3.2).character!.layers;
    expect(sitting.find((l) => l.clip === "sit")!.weight).toBe(1);
    expect(sitting.find((l) => l.clip === "wave")).toMatchObject({ mask: "upper", weight: 1 });
    expect(bob(d, 7.5).character!.layers.map((l) => l.clip)).toEqual(["idle"]);
    expect(bob(d, 9).character!.layers).toEqual([{ clip: "talk", time: 1, weight: 1, loop: "repeat", mask: "full" }]);
    expect(bob(d, 10.25).character!.layers.map((l) => [l.clip, l.weight])).toEqual([["talk", 0.5], ["idle", 0.5]]);
  });

  it("lookAt follows the camera or a character's head; expressions, blinks and speech", () => {
    const d = doc([
      { at: 0, obj: "bob", call: "lookAt", args: { target: "camera" }, dur: 1 },
      { at: 0, obj: "camera", call: "moveTo", args: { position: [4, 2, 4] }, dur: 4 },
      { at: 3, obj: "bob", call: "lookAt", args: { target: "ann" } },
      { at: 5, obj: "bob", call: "lookAt", args: { target: "ann", weight: 0 }, dur: 1 },
      { at: 0, obj: "bob", call: "expression", args: { value: { happy: 1 } }, dur: 2 },
      { at: 1, obj: "bob", call: "speak", args: { text: "Ahh" }, dur: 1 },
    ], { world: { camera: { position: [0, 1.6, 6] } } });
    expect(bob(d, 0.5).character!.look!.weight).toBeCloseTo(0.5, 9);
    expect(bob(d, 2).character!.look!.target).toEqual(stateAt(d, 2).camera.position);
    expect(bob(d, 3).character!.look!.target).toEqual([-2, 1.5 * 0.92, 0]);
    expect(bob(d, 7).character!.look).toBeUndefined();
    expect(bob(d, 1).character!.expressions.happy).toBe(0.5);
    expect(bob(d, 1.5).character!.expressions.aa).toBeCloseTo(1, 3);
    expect(bob(d, 4).character!.expressions.aa).toBeUndefined();
    const noBlink = { ...d, objects: d.objects.map((o) => (o.id === "bob" ? { ...o, character: { blink: false } } : o)) };
    expect(Array.from({ length: 300 }, (_, i) => bob(noBlink, i / 30).character!.expressions.blink ?? 0).every((x) => x === 0)).toBe(true);
  });

  it("pickUp holds an object in a hand until drop puts it down in front", () => {
    const d = doc([
      { at: 1, obj: "bob", call: "pickUp", args: { object: "cup", hand: "left" } },
      { at: 2, obj: "bob", call: "drop", args: { object: "cup" } },
    ]);
    const cup = (t: number) => stateAt(d, t).objects.find((o) => o.id === "cup")!;
    expect(cup(0.5).held).toBeUndefined();
    expect(cup(1.5).held).toEqual({ by: "bob", hand: "left" });
    expect(cup(2.5).held).toBeUndefined();
    expect(cup(2.5).position).toEqual([0, 0.9, 0.45]);
  });
});

describe("Scene Phase 2: editing, agents and pages", () => {
  it("the editor lists character calls and fields; tracks show characters", () => {
    const d = addSceneCharacter(doc()).doc;
    expect(d.objects.at(-1)).toMatchObject({ id: "character", character: { body: { height: 1.7 } } });
    const calls = sceneCalls(d, "bob").map((c) => c.call);
    expect(calls).toEqual(expect.arrayContaining(["walkTo", "runTo", "turnTo", "lookAt", "sit", "stand", "gesture", "expression", "speak", "pickUp", "drop", "play", "stop", "moveTo"]));
    expect(calls).not.toContain("color");
    expect(sceneCalls(d, "cup").map((c) => c.call)).toContain("lookAt");
    expect(sceneCallArgs(d, "bob", "walkTo").map((f) => f.kind)).toEqual(["points", "number"]);
    expect(sceneCallArgs(d, "bob", "lookAt")[0]).toMatchObject({ kind: "target", camera: true });
    expect(defaultCallArgs(d, "bob", "walkTo", 0)).toEqual({ path: [[0, 0, 2]] });
    expect(defaultCallArgs(d, "bob", "lookAt", 0)).toEqual({ target: "camera" });
    expect(callTweens(d, "bob", "walkTo")).toBe(false);
    expect(callTweens(d, "bob", "speak")).toBe(true);
    expect(sceneTracks(d).find((t) => t.id === "bob")).toMatchObject({ kind: "character", detail: "character" });
    expect(sceneClipInfo(d, "walk")).toMatchObject({ stride: 1.3, length: 1, known: true });
    expect(Object.keys(BUILTIN_CLIPS)).toEqual(["idle", "walk", "run", "wave", "nod", "point", "talk", "sit"]);
  });

  it("agent tools: a mannequin from add_scene_object, character events, the animation library", () => {
    const ok = (r: ReturnType<typeof applySceneTool>) => { if (!r.ok) throw new Error(r.error); return r; };
    let d: SceneDoc = { format: "dionysus.scene/1", objects: [] };
    d = ok(applySceneTool("add_scene_object", d, { id: "hero", props: { character: { body: { cloth: "#cc3333" } } } })).doc;
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "hero", call: "walkTo", args: { path: [[3, 0, 0]] } } })).doc;
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 4, obj: "hero", call: "speak", args: { text: "Hi" }, dur: 0.6 } })).doc;
    const refused = applySceneTool("add_scene_event", d, { event: { at: 0, obj: "hero", call: "fly" } });
    expect(!refused.ok && refused.error).toMatch(/has no call "fly".*walkTo/);
    const glb = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    d = ok(applySceneTool("set_scene_animation", d, { name: "spin", file: { name: "spin.glb", dataUrl: glb }, clip: "Spin", loop: "repeat" })).doc;
    expect(d.animations).toEqual({ spin: { file: "spin.glb", clip: "Spin", loop: "repeat" } });
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 5, obj: "hero", call: "play", args: { clip: "spin" } } })).doc;
    const listed = sceneObjectsForAgent(d);
    expect(listed.clips.library).toEqual(["spin"]);
    expect(listed.characterCalls).toContain("walkTo");
    expect(validateScene(d).filter((i) => i.level === "error")).toEqual([]);
    // Removing a clip an event still plays is refused (the scene would not be valid).
    const inUse = applySceneTool("set_scene_animation", d, { name: "spin", remove: true });
    expect(!inUse.ok && inUse.error).toMatch(/"spin" is not a built-in clip/);
    d = ok(applySceneTool("remove_scene_event", d, { index: 2 })).doc;
    d = ok(applySceneTool("set_scene_animation", d, { name: "spin", remove: true })).doc;
    expect(d.animations).toBeUndefined();
    expect(d.files).toBeUndefined();
    expect(removeSceneAnimation(d, "spin")).toBe(d);
  });

  it("pages: character data embedded, libraries only when used, code compiles, structure keys the page", () => {
    const html = scenePage(BENCHMARK_SHOT);
    expect(html).toContain('id="dionysus-character"');
    expect(readManifest(html).libs).toEqual(["three", "three-look"]);
    expect(scenePage({ format: "dionysus.scene/1", objects: [{ id: "a" }] })).not.toContain('id="dionysus-character"');
    const glb = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    const vrm: SceneDoc = { format: "dionysus.scene/1", files: { "girl.vrm": glb }, objects: [{ id: "girl", model: "girl.vrm", character: {} }] };
    expect(readManifest(scenePage(vrm)).libs).toEqual(["three", "three-gltf", "three-vrm"]);
    const lib = addSceneAnimation(doc(), "dance.glb", glb, "dance").doc;
    expect(readManifest(scenePage(lib)).libs).toEqual(["three", "three-gltf"]);
    expect(readManifest(sceneEditPage(vrm)).libs).toEqual(["three", "three-orbit", "three-transform", "three-gltf", "three-vrm"]);
    expect(libById("three-vrm")).toMatchObject({ version: "3.4.5", requires: ["three", "three-gltf"], editorOnly: true });
    for (const page of [html, sceneEditPage(BENCHMARK_SHOT), scenePage(vrm)]) {
      const js = page.split('<script type="module">')[1].split("</script>")[0];
      expect(() => transformSync(js, { format: "esm", loader: "js", target: "es2022" })).not.toThrow();
    }
    const k = scenePageKey(BENCHMARK_SHOT);
    expect(scenePageKey({ ...BENCHMARK_SHOT, events: [] })).toBe(k);
    expect(scenePageKey({ ...BENCHMARK_SHOT, objects: BENCHMARK_SHOT.objects.map((o) => (o.id === "hero" ? { ...o, character: { body: { height: 1.4 } } } : o)) })).not.toBe(k);
  });
});
