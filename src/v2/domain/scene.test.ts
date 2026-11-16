import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_SCENE, SCENE_EASE, SCENE_EASES, lookRotation, parseScene, sceneSummary, stateAt, validateScene, type SceneDoc } from "./scene";

const doc = (over: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "dionysus.scene/1",
  objects: [
    { id: "a", position: [0, 0, 0], color: "#000000" },
    { id: "b", shape: "sphere", size: 0.5, position: [4, 0, 0],
      functions: { mood: { params: { m: { type: "select", options: ["calm", "alert"], default: "calm" }, level: { type: "number", min: 0, max: 1, default: 0.5 } },
        states: { param: "m", table: { calm: { color: "#00ff00" }, alert: { color: "#ff0000", scale: 2 } } }, set: { opacity: "$level" } } } },
  ],
  ...over,
});
const obj = (s: ReturnType<typeof stateAt>, id: string) => s.objects.find((o) => o.id === id)!;
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

describe("dionysus.scene/1 validation (P74)", () => {
  it("accepts the sample scene with no problems", () => {
    expect(validateScene(SAMPLE_SCENE)).toEqual([]);
    expect(parseScene(JSON.stringify(SAMPLE_SCENE)).doc).toEqual(SAMPLE_SCENE);
  });
  it("reports bad JSON, format, world and objects with JSON paths", () => {
    expect(parseScene("{").issues[0].message).toMatch(/Not valid JSON/);
    expect(parseScene("{}").doc).toBeUndefined();
    const issues = validateScene({
      format: "dionysus.scene/2", durationSec: -1,
      world: { background: "red", camera: { fov: 200, position: [0, 1] }, lights: [{ type: "laser" }, { type: "point", intensity: -1 }] },
      objects: [{ id: "a" }, { id: "a" }, { id: "camera" }, { id: "1x" }, { id: "s", shape: "blob" }, { id: "t", shape: "sphere", size: [1, 2] },
        { id: "u", opacity: 2, scale: 0, visible: "yes", color: "#fff", position: [0, 0] }],
    }).map((i) => `${i.path}: ${i.message}`);
    for (const p of ["format", "durationSec", "world.background", "world.camera.fov", "world.camera.position", "world.lights[0].type", "world.lights[1].intensity",
      "objects[1].id", "objects[2].id", "objects[3].id", "objects[4].shape", "objects[5].size", "objects[6].opacity", "objects[6].scale", "objects[6].visible", "objects[6].color", "objects[6].position"])
      expect(issues.some((i) => i.startsWith(`${p}: `)), p).toBe(true);
  });
  it("checks custom function declarations", () => {
    const issues = validateScene({ format: "dionysus.scene/1", objects: [{ id: "a", functions: {
      opacity: { set: { opacity: 1 } }, empty: {}, bad: { params: { x: { type: "number", default: "1" } }, set: { glow: 1, color: "$nope" } },
      tbl: { params: { s: { type: "number", default: 1 } }, states: { param: "s", table: { x: { color: "#00ff00" } } } },
      sel: { params: { s: { type: "select", options: ["a"], default: "a" } }, states: { param: "s", table: { b: { opacity: 3 } } } },
    } }] }).map((i) => `${i.path}: ${i.message}`);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/^objects\[0\]\.functions\.opacity: .*base function/),
      expect.stringMatching(/^objects\[0\]\.functions\.empty: .*needs "set" or "states"/),
      expect.stringMatching(/^objects\[0\]\.functions\.bad\.params: /),
      expect.stringMatching(/^objects\[0\]\.functions\.bad\.set\.glow: is not a property/),
      expect.stringMatching(/^objects\[0\]\.functions\.bad\.set\.color: names an undeclared param "nope"/),
      expect.stringMatching(/^objects\[0\]\.functions\.tbl\.states\.param: "s" must be a select param/),
      expect.stringMatching(/^objects\[0\]\.functions\.sel\.states\.table\.b: "b" is not an option/),
      expect.stringMatching(/^objects\[0\]\.functions\.sel\.states\.table\.b\.opacity: must be a number from 0 to 1/),
    ]));
  });
  it("checks events: times, objects, functions, args, easing; warns on overlapping tweens and models", () => {
    const d = doc({ events: [
      { at: -1, obj: "a", call: "opacity", args: { value: 0 } },
      { at: 0, obj: "zz", call: "opacity", args: { value: 0 } },
      { at: 0, obj: "a", call: "fly", args: {} },
      { at: 0, obj: "a", call: "position", args: { value: [1, 2] } },
      { at: 0, obj: "a", call: "opacity", args: { value: 0 }, dur: -1, ease: "bouncy" as never },
      { at: 0, obj: "b", call: "mood", args: { m: "angry", x: 1 } },
      { at: 0, obj: "a", call: "lookAt", args: { target: "a" } },
      { at: 0, obj: "camera", call: "zoom", args: {} },
      { at: 1, obj: "a", call: "moveTo", args: { position: [1, 0, 0] }, dur: 2 },
      { at: 2, obj: "a", call: "position", args: { value: [2, 0, 0] }, dur: 1 },
    ] });
    d.objects.push({ id: "m", model: "robot.glb" });
    const issues = validateScene(d);
    const at = (p: string, level = "error") => issues.filter((i) => i.path.startsWith(p) && i.level === level).map((i) => i.message).join(" | ");
    expect(at("events[0].at")).toMatch(/≥ 0/);
    expect(at("events[1].obj")).toMatch(/no object "zz"/);
    expect(at("events[2].call")).toMatch(/no function "fly".*base:/);
    expect(at("events[3].args.value")).toMatch(/\[x, y, z\]/);
    expect(at("events[4].dur")).toMatch(/≥ 0/);
    expect(at("events[4].ease")).toMatch(/must be one of/);
    expect(at("events[5].args.m")).toBeTruthy();
    expect(at("events[5].args.x")).toMatch(/no param "x"/);
    expect(at("events[6].args.target")).toMatch(/another object/);
    expect(at("events[7].call")).toMatch(/camera has no function "zoom"/);
    expect(at("events[9]", "warning")).toMatch(/still changes a\.position.*later event wins/);
    expect(at("objects[2].model", "warning")).toMatch(/later version/);
  });
});

describe("stateAt: pure state from t (P74)", () => {
  it("uses base values and world defaults with no events", () => {
    const s = stateAt(doc(), 3);
    expect(s.background).toBe("#101018");
    expect(s.camera).toEqual({ fov: 40, position: [0, 1.6, 6], target: [0, 1, 0] });
    expect(obj(s, "a")).toEqual({ id: "a", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, opacity: 1, color: "#000000" });
  });
  it("sets without dur and tweens with dur and a named ease", () => {
    const d = doc({ events: [
      { at: 1, obj: "a", call: "moveTo", args: { position: [10, 0, 0] }, dur: 2 },
      { at: 0.5, obj: "a", call: "opacity", args: { value: 0.25 } },
      { at: 1, obj: "a", call: "scale", args: { value: 3 }, dur: 2, ease: "inOutCubic" },
    ] });
    expect(obj(stateAt(d, 0.4), "a").opacity).toBe(1);
    expect(obj(stateAt(d, 0.5), "a").opacity).toBe(0.25);
    close(obj(stateAt(d, 1), "a").position, [0, 0, 0]);
    close(obj(stateAt(d, 2), "a").position, [5, 0, 0]);
    close(obj(stateAt(d, 99), "a").position, [10, 0, 0]);
    const k = SCENE_EASE.inOutCubic(0.25);
    close(obj(stateAt(d, 1.5), "a").scale, [1 + 2 * k, 1 + 2 * k, 1 + 2 * k]);
  });
  it("is deterministic and seek-anywhere: any order of t gives the same states", () => {
    const ts = Array.from({ length: 61 }, (_, i) => i / 12);
    const forward = ts.map((t) => JSON.stringify(stateAt(SAMPLE_SCENE, t)));
    const shuffled = [...ts].sort((a, b) => Math.sin(a * 97) - Math.sin(b * 97));
    const fresh = () => JSON.parse(JSON.stringify(SAMPLE_SCENE)) as SceneDoc;
    const back = new Map(shuffled.map((t) => [t, JSON.stringify(stateAt(fresh(), t))]));
    ts.forEach((t, i) => expect(back.get(t)).toBe(forward[i]));
    expect(new Set(forward).size).toBeGreaterThan(30);
  });
  it("conflict rule: the event that started last wins from its start; a running tween is cut and the next starts from there", () => {
    const d = doc({ events: [
      { at: 0, obj: "a", call: "position", args: { value: [10, 0, 0] }, dur: 10 },
      { at: 5, obj: "a", call: "position", args: { value: [5, 10, 0] }, dur: 5 },
      { at: 0, obj: "a", call: "opacity", args: { value: 0 }, dur: 10 },
    ] });
    close(obj(stateAt(d, 5), "a").position, [5, 0, 0]);
    close(obj(stateAt(d, 7.5), "a").position, [5, 5, 0]);
    close(obj(stateAt(d, 10), "a").position, [5, 10, 0]);
    expect(obj(stateAt(d, 7.5), "a").opacity).toBeCloseTo(0.25, 6); // other properties never conflict
  });
  it("same at: array order breaks ties (stable sort)", () => {
    const d = doc({ events: [
      { at: 1, obj: "a", call: "color", args: { value: "#ff0000" } },
      { at: 1, obj: "a", call: "color", args: { value: "#0000ff" } },
    ] });
    expect(obj(stateAt(d, 1), "a").color).toBe("#0000ff");
    expect(obj(stateAt({ ...d, events: [...d.events!].reverse() }, 1), "a").color).toBe("#ff0000");
  });
  it("tweens colours in RGB and snaps visible at the start", () => {
    const d = doc({ events: [
      { at: 0, obj: "a", call: "color", args: { value: "#ffffff" }, dur: 2 },
      { at: 1, obj: "a", call: "visible", args: { value: false }, dur: 5 },
    ] });
    expect(obj(stateAt(d, 1), "a").color).toBe("#808080");
    expect(obj(stateAt(d, 0.99), "a").visible).toBe(true);
    expect(obj(stateAt(d, 1), "a").visible).toBe(false);
  });
  it("custom functions expand into base properties (states table + $param set) and tween like base calls", () => {
    const d = doc({ events: [{ at: 1, obj: "b", call: "mood", args: { m: "alert", level: 0.2 }, dur: 1 }] });
    expect(obj(stateAt(d, 0), "b")).toMatchObject({ color: "#cccccc", scale: [1, 1, 1], opacity: 1 });
    const mid = obj(stateAt(d, 1.5), "b");
    close(mid.scale, [1.5, 1.5, 1.5]);
    expect(mid.opacity).toBeCloseTo(0.6, 6);
    expect(obj(stateAt(d, 2), "b")).toMatchObject({ color: "#ff0000", scale: [2, 2, 2], opacity: 0.2 });
    // Defaults for missing args.
    const def = doc({ events: [{ at: 0, obj: "b", call: "mood" }] });
    expect(obj(stateAt(def, 0), "b")).toMatchObject({ color: "#00ff00", opacity: 0.5 });
  });
  it("lookAt turns towards an object where both are when the event ends; camera moves and looks", () => {
    expect(lookRotation([0, 0, 0], [1, 0, 0], [0, 0, 0])).toEqual([-0, 90, 0]);
    close(lookRotation([0, 0, 0], [0, 1, 1], [0, 0, 0]), [-45, 0, 0]);
    const d = doc({ events: [
      { at: 0, obj: "b", call: "moveTo", args: { position: [4, 0, 4] }, dur: 2 },
      { at: 1, obj: "a", call: "lookAt", args: { target: "b" }, dur: 1 },
      { at: 0, obj: "camera", call: "moveTo", args: { position: [0, 0, 10] }, dur: 2 },
      { at: 0, obj: "camera", call: "lookAt", args: { target: "b" } },
      { at: 0, obj: "camera", call: "fov", args: { value: 60 }, dur: 2 },
    ] });
    close(obj(stateAt(d, 1), "a").rotation, [0, 0, 0]);
    close(obj(stateAt(d, 1.5), "a").rotation, [0, 22.5, 0]);
    close(obj(stateAt(d, 2), "a").rotation, [0, 45, 0]);
    const s = stateAt(d, 1);
    close(s.camera.position, [0, 1.6 * 0.5, 8]);
    expect(s.camera.fov).toBeCloseTo(50, 6);
    // An instant lookAt resolves the target where it is at the event's time (0), and keeps that point.
    close(s.camera.target, [4, 0, 0]);
    close(stateAt(d, 0).camera.target, [4, 0, 0]);
  });
  it("skips invalid events and fields instead of throwing", () => {
    const d = doc({ events: [
      { at: 0, obj: "nope", call: "opacity", args: { value: 0 } },
      { at: 0, obj: "a", call: "opacity", args: { value: 7 } },
      { at: "x" as never, obj: "a", call: "opacity", args: { value: 0 } },
      { at: 0, obj: "a", call: "fly" },
    ] });
    expect(obj(stateAt(d, 1), "a").opacity).toBe(1);
    expect(() => stateAt({ format: "dionysus.scene/1", objects: [null as never, { id: "x", scale: -1 as never }] }, NaN)).not.toThrow();
  });
  it("easings start at 0 and end at 1", () => {
    for (const e of SCENE_EASES) { expect(SCENE_EASE[e](0)).toBeCloseTo(0, 9); expect(SCENE_EASE[e](1)).toBeCloseTo(1, 9); }
  });
  it("summarises objects and events for the inspector", () => {
    const s = sceneSummary(SAMPLE_SCENE);
    expect(s.objects.map((o) => o.id)).toEqual(["floor", "ball", "cube", "sign"]);
    expect(s.objects[1].functions).toEqual(["setMood"]);
    expect(s.events.map((e) => e.at)).toEqual([0, 0.5, 2, 2.5, 3, 3.8]);
  });
});

/**
 * Regression golden for the evaluator (P74): the sample scene's state at every frame (30 fps, 0–5 s) hashed. Any change
 * to the event model shows up here; re-record on purpose with UPDATE_SCENE_GOLDEN=1 and explain it in the PR.
 */
describe("stateAt golden (P74)", () => {
  const GOLDEN = resolve(__dirname, "__golden__/sceneState.json");
  const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  it("the sample scene's 151 frame states match the golden", () => {
    // Rounded to 1e-6: Math.sin/pow/atan2 may differ in the last ulp between Node/V8 versions (local 24 vs CI 20).
    const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 + 0 : v);
    const frames = Array.from({ length: 151 }, (_, i) => JSON.stringify(stateAt(SAMPLE_SCENE, i / 30), round));
    const got = { frames: frames.length, all: fnv(frames.join("\n")), at0: fnv(frames[0]), at75: fnv(frames[75]), at150: fnv(frames[150]) };
    if (process.env.UPDATE_SCENE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(got, null, 1)}\n`);
    expect(got).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
