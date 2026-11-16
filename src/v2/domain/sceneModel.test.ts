/**
 * P75 (Phase 2 step 2.2): GLB models in scene documents. `glbInfo` reads clip names and lengths without three.js; the
 * validator checks files, models and animations; `stateAt` gives each model object the clips that play at `t` with
 * their local time and weight, from the document and `t` alone (cross-fades included).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { addSceneModel, glbInfo, glbInfoOfDataUrl, sceneSummary, stateAt, validateScene, SAMPLE_SCENE, type SceneDoc, type SceneState } from ".";
import { bytesToDataUrl, makeAnimatedGlb, makeCubeGlb } from "../ui/cubeGlb";
import { scenePage } from "../render/scenePage";
import { selectedLibraries } from "../render/htmlLibs";
import { readManifest } from "./htmlClipPackage";

const BOT = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
const CUBE = bytesToDataUrl(makeCubeGlb(), "model/gltf-binary");

const robotDoc = (over: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "dionysus.scene/1",
  files: { "bot.glb": BOT, "cube.glb": CUBE },
  objects: [
    { id: "bot", model: "bot.glb", size: 1.6, animation: "Wave",
      functions: { setState: { params: { state: { type: "select", options: ["idle", "spin", "hop"], default: "idle" } },
        states: { param: "state", table: { idle: { animation: "Wave" }, spin: { animation: { clip: "Spin", speed: 0.5 } }, hop: { animation: { clip: "Bounce", loop: "pingpong" }, color: "#ff0000" } } } } } },
    { id: "crate", model: "cube.glb", position: [1, 0, 0] },
    { id: "ball", shape: "sphere" },
  ],
  ...over,
});
const anim = (s: SceneState, id: string) => s.objects.find((o) => o.id === id)!.animation;

describe("glbInfo (P75)", () => {
  it("reads animation names and lengths from the GLB JSON chunk", () => {
    expect(glbInfo(makeAnimatedGlb())).toEqual({ animations: [{ name: "Wave", duration: 1 }, { name: "Spin", duration: 2 }, { name: "Bounce", duration: expect.closeTo(0.8, 6) }], meshes: 3, nodes: 4, skinned: false, nodeNames: ["Bot", "Body", "Head", "Arm"] });
    expect(glbInfo(makeCubeGlb())?.animations).toEqual([]);
    expect(glbInfo(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(glbInfoOfDataUrl("data:text/plain,hello")).toBeUndefined();
    expect(glbInfoOfDataUrl(BOT)?.animations.map((a) => a.name)).toEqual(["Wave", "Spin", "Bounce"]);
  });
});

describe("validation of models and animations (P75)", () => {
  const issues = (d: unknown) => validateScene(d);
  it("a valid robot scene has no errors and no warnings", () => {
    const d = robotDoc({ events: [
      { at: 1, obj: "bot", call: "play", args: { clip: "Spin", speed: 2, loop: "once", from: 0.5, fade: 0.3 } },
      { at: 3, obj: "bot", call: "setState", args: { state: "hop" }, dur: 0.4 },
      { at: 4, obj: "bot", call: "stop", args: { fade: 0.2 } },
    ] });
    expect(issues(d)).toEqual([]);
  });
  it("reports files, models, clips and play/stop problems with JSON paths", () => {
    const d = {
      format: "dionysus.scene/1",
      files: { "bot.glb": BOT, "bad file?.glb": "nope", "note.txt": "data:text/plain,hi" },
      objects: [
        { id: "bot", model: "bot.glb", animation: { clip: "Run" } },
        { id: "ghost", model: "missing.glb" },
        { id: "txt", model: "note.txt" },
        { id: "ball", shape: "sphere", animation: "Wave", functions: { f: { set: { animation: "Wave" } } } },
        { id: "bot2", model: "bot.glb", animation: { clip: "Wave", loop: "forever", speed: -1 } },
      ],
      events: [
        { at: 0, obj: "ball", call: "play", args: { clip: "Wave" } },
        { at: 0, obj: "bot", call: "play", args: { clip: "Jump" } },
        { at: 0, obj: "bot", call: "play", args: {} },
        { at: 0, obj: "bot", call: "stop", args: { fade: -1 } },
      ],
    };
    const got = issues(d).map((i) => `${i.level} ${i.path}: ${i.message}`);
    const has = (re: RegExp) => expect(got.some((g) => re.test(g)), `${re} in\n${got.join("\n")}`).toBe(true);
    has(/^error files\.bad file\?\.glb: File names/);
    has(/^error files\.bad file\?\.glb: must be a data: URL/);
    has(/^warning objects\[0\]\.animation: "bot\.glb" has no animation "Run" \(it has "Wave", "Spin", "Bounce"\)/);
    has(/^warning objects\[1\]\.model: "missing\.glb" is not in "files"; the object is drawn as a box/);
    has(/^warning objects\[2\]\.model: "note\.txt" is not a \.glb or \.gltf file/);
    has(/^error objects\[3\]\.animation: only a model object/);
    has(/^error objects\[3\]\.functions\.f\.set\.animation: only a model object/);
    has(/^error objects\[4\]\.animation: has a speed that is not a number ≥ 0/);
    has(/^error events\[0\]\.call: "ball" has no model, so it can't play/);
    has(/^warning events\[1\]\.args\.clip: "bot\.glb" has no animation "Jump"/);
    has(/^error events\[2\]\.args: must be a clip name/);
    has(/^error events\[3\]\.args\.fade: must be a number of seconds ≥ 0/);
  });
  it("a readable .glb without animations says so; an unreadable one draws the shape", () => {
    expect(validateScene({ format: "dionysus.scene/1", files: { "c.glb": CUBE }, objects: [{ id: "c", model: "c.glb", animation: "Wave" }] }).map((i) => i.message))
      .toEqual(['"c.glb" has no animations.']);
    expect(validateScene({ format: "dionysus.scene/1", files: { "x.glb": "data:model/gltf-binary;base64,AAAA" }, objects: [{ id: "x", model: "x.glb", shape: "sphere" }] }).map((i) => i.message))
      .toEqual(['"x.glb" is not a readable GLB; the object is drawn as a sphere.']);
  });
});

describe("stateAt: model animation from t (P75)", () => {
  it("plays the object's animation from 0 s; shapes get no animation field (P74 states unchanged)", () => {
    const s = stateAt(robotDoc(), 2.5);
    expect(anim(s, "bot")).toEqual([{ clip: "Wave", time: 2.5, loop: "repeat", weight: 1 }]);
    expect(anim(s, "crate")).toEqual([]);
    expect("animation" in s.objects.find((o) => o.id === "ball")!).toBe(false);
    expect(JSON.stringify(stateAt(SAMPLE_SCENE, 2.5))).not.toContain("animation");
  });
  it("play cross-fades over fade (else dur), the old clip keeps its own time; stop fades to the rest pose", () => {
    const d = robotDoc({ events: [
      { at: 2, obj: "bot", call: "play", args: { clip: "Spin", speed: 2, from: 0.25 }, dur: 0.5 },
      { at: 4, obj: "bot", call: "play", args: { clip: "Bounce", loop: "pingpong", fade: 1 }, ease: "inQuad" },
      { at: 6, obj: "bot", call: "stop", args: { fade: 0.5 } },
    ] });
    expect(anim(stateAt(d, 1.9), "bot")).toEqual([{ clip: "Wave", time: 1.9, loop: "repeat", weight: 1 }]);
    expect(anim(stateAt(d, 2), "bot")).toEqual([{ clip: "Wave", time: 2, loop: "repeat", weight: 1 }]);
    expect(anim(stateAt(d, 2.25), "bot")).toEqual([{ clip: "Wave", time: 2.25, loop: "repeat", weight: 0.5 }, { clip: "Spin", time: 0.75, loop: "repeat", weight: 0.5 }]);
    expect(anim(stateAt(d, 3), "bot")).toEqual([{ clip: "Spin", time: 2.25, loop: "repeat", weight: 1 }]);
    const mid = anim(stateAt(d, 4.5), "bot")!;
    expect(mid.map((a) => [a.clip, +a.time.toFixed(6), +a.weight.toFixed(6)])).toEqual([["Spin", 5.25, 0.75], ["Bounce", 0.5, 0.25]]);
    expect(anim(stateAt(d, 6.25), "bot")).toEqual([{ clip: "Bounce", time: 2.25, loop: "pingpong", weight: 0.5 }]);
    expect(anim(stateAt(d, 7), "bot")).toEqual([]);
  });
  it("custom function rows switch the clip (with dur as the fade) and still tween other properties", () => {
    const d = robotDoc({ events: [{ at: 1, obj: "bot", call: "setState", args: { state: "spin" }, dur: 0.5 }, { at: 3, obj: "bot", call: "setState", args: { state: "hop" } }] });
    expect(anim(stateAt(d, 1.25), "bot")).toEqual([{ clip: "Wave", time: 1.25, loop: "repeat", weight: 0.5 }, { clip: "Spin", time: 0.125, loop: "repeat", weight: 0.5 }]);
    expect(anim(stateAt(d, 3.5), "bot")).toEqual([{ clip: "Bounce", time: 0.5, loop: "pingpong", weight: 1 }]);
    expect(stateAt(d, 3.5).objects[0].color).toBe("#ff0000");
  });
  it("shows and hides model parts by node name: object nodes, the nodes call and function rows switch at at", () => {
    const d = robotDoc({ events: [
      { at: 1, obj: "bot", call: "nodes", args: { value: { Arm: true, Head: false } }, dur: 0.5 },
      { at: 2, obj: "bot", call: "setState", args: { state: "idle" } },
    ] });
    d.objects[0] = { ...d.objects[0], nodes: { Arm: false } };
    (d.objects[0].functions!.setState.states!.table.idle as Record<string, unknown>).nodes = { Head: true };
    expect(validateScene(d)).toEqual([]);
    expect(stateAt(d, 0.5).objects[0].nodes).toEqual({ Arm: false });
    expect(stateAt(d, 1).objects[0].nodes).toEqual({ Arm: true, Head: false });
    expect(stateAt(d, 3).objects[0].nodes).toEqual({ Arm: true, Head: true });
    expect("nodes" in stateAt(d, 3).objects[1]).toBe(false);
    const bad = validateScene({ ...d, objects: [{ ...d.objects[0], nodes: { Tail: false } }, { id: "s", nodes: { A: true } }], events: [{ at: 0, obj: "bot", call: "nodes", args: { value: { A: "yes" } } }, { at: 0, obj: "s", call: "nodes", args: { value: { A: true } } }] })
      .map((i) => `${i.level} ${i.path}: ${i.message}`);
    expect(bad).toEqual(expect.arrayContaining([
      'warning objects[0].nodes.Tail: "bot.glb" has no node "Tail".',
      'error objects[1].nodes: only a model object (with "model") has nodes.',
      "error events[0].args.value: must be an object of node name → true or false.",
      'error events[1].call: "s" has no model, so it has no nodes.',
    ]));
  });
  it("any seek order gives the same states", () => {
    const d = robotDoc({ events: [{ at: 0.5, obj: "bot", call: "play", args: { clip: "Spin" }, dur: 1 }, { at: 1, obj: "bot", call: "moveTo", args: { position: [1, 0, 0] }, dur: 2 }] });
    const ts = Array.from({ length: 31 }, (_, i) => i / 10);
    const fwd = ts.map((t) => JSON.stringify(stateAt(d, t)));
    const shuffled = [...ts].reverse().map((t) => JSON.stringify(stateAt(d, t))).reverse();
    expect(shuffled).toEqual(fwd);
  });
});

describe("addSceneModel and the scene page (P75)", () => {
  it("embeds the file under a free name and adds an object that plays the first clip", () => {
    const a = addSceneModel(SAMPLE_SCENE, "My Bot!.glb", BOT);
    expect(a.id).toBe("My-Bot_");
    expect(a.doc.files).toEqual({ "My Bot_.glb": BOT });
    expect(a.doc.objects.at(-1)).toEqual({ id: "My-Bot_", model: "My Bot_.glb", size: 1.6, position: [0, 0, 0.6], animation: "Wave" });
    const b = addSceneModel(a.doc, "My Bot!.glb", CUBE);
    expect(Object.keys(b.doc.files!)).toEqual(["My Bot_.glb", "My Bot_-2.glb"]);
    expect(b.id).toBe("My-Bot_-2");
    expect(b.doc.objects.at(-1)).not.toHaveProperty("animation");
    expect(b.doc.objects.at(-1)!.position).toEqual([-1.2, 0, 0.6]);
    expect(validateScene(b.doc).filter((i) => i.level === "error")).toEqual([]);
    expect(SAMPLE_SCENE.files).toBeUndefined();
    expect(sceneSummary(b.doc).objects.slice(-2).map((o) => o.animations)).toEqual([["Wave", "Spin", "Bounce"], []]);
  });
  it("puts the files in the page manifest (blob: URLs in the host) and adds GLTFLoader only for models", () => {
    const page = scenePage(robotDoc());
    const m = readManifest(page);
    expect(m.libs).toEqual(["three", "three-gltf"]);
    expect(Object.keys(m.files ?? {})).toEqual(["bot.glb", "cube.glb"]);
    expect(selectedLibraries(page).map((l) => l.id)).toEqual(["three", "three-gltf"]);
    const embedded = JSON.parse(/id="dionysus-scene">([^<]*)</.exec(page)![1]);
    expect(embedded.files).toBeUndefined();
    expect(embedded.objects[0].model).toBe("bot.glb");
    const plain = scenePage(SAMPLE_SCENE);
    expect(readManifest(plain)).toEqual({});
    expect(selectedLibraries(plain).map((l) => l.id)).toEqual(["three"]);
  });
});

/** Golden for the model evaluator: a robot scene's state at 30 fps over 8 s, numbers rounded to 1e-6 (stable across Node versions). */
describe("stateAt golden with models (P75)", () => {
  const GOLDEN = resolve(__dirname, "__golden__/sceneModelState.json");
  const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  it("the robot scene's 241 frame states match the golden", () => {
    const d = robotDoc({ events: [
      { at: 1, obj: "bot", call: "setState", args: { state: "spin" }, dur: 0.6, ease: "inOutSine" },
      { at: 2, obj: "bot", call: "moveTo", args: { position: [1.2, 0, 0.4] }, dur: 2, ease: "inOutCubic" },
      { at: 3.5, obj: "bot", call: "play", args: { clip: "Bounce", loop: "pingpong", fade: 0.5 } },
      { at: 5, obj: "crate", call: "lookAt", args: { target: "bot" }, dur: 1 },
      { at: 6, obj: "bot", call: "stop", args: { fade: 1 }, ease: "out" },
      { at: 7, obj: "bot", call: "setState", args: { state: "hop" } },
    ] });
    const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 + 0 : v);
    const frames = Array.from({ length: 241 }, (_, i) => JSON.stringify(stateAt(d, i / 30), round));
    const got = { frames: frames.length, all: fnv(frames.join("\n")), at0: fnv(frames[0]), at120: fnv(frames[120]), at240: fnv(frames[240]) };
    if (process.env.UPDATE_SCENE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(got, null, 1)}\n`);
    expect(got).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
