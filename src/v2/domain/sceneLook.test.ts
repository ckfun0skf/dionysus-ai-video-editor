import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applySceneTool, callTweens, defaultCallArgs, lookTargetOf, SAMPLE_SCENE, sceneCallArgs, sceneCalls, sceneObjectsForAgent, sceneTracks,
  stateAt, sunDirection, SUN_DISTANCE, updateSceneLook, validateScene, type SceneDoc,
} from ".";
import { BENCHMARK_SHOT } from "./__fixtures__/benchmarkShot";

const errors = (raw: unknown) => validateScene(raw).filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`);
const warnings = (raw: unknown) => validateScene(raw).filter((i) => i.level === "warning").map((i) => `${i.path}: ${i.message}`);
const base = (extra: Partial<SceneDoc> = {}): SceneDoc => ({
  format: "dionysus.scene/1",
  world: { lights: [{ id: "key", type: "directional", position: [0, 5, 0], intensity: 1 }, { id: "fill", type: "hemisphere" }, { id: "bulb", type: "point", position: [1, 1, 1] }], ...(extra.world ?? {}) },
  objects: [{ id: "ball", shape: "sphere", position: [2, 0, 0] }],
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "world")),
});

describe("Scene Phase 1 (#350): old scenes are unchanged", () => {
  it("the sample scene has no look fields in its state; lights are the drawn ones, as the page drew them", () => {
    const s = stateAt(SAMPLE_SCENE, 2);
    expect(s.post).toBeUndefined(); expect(s.fog).toBeUndefined(); expect(s.sky).toBeUndefined();
    expect(s.lights).toEqual([{ type: "hemisphere", color: "#ffffff", intensity: 1.1, groundColor: "#303040" }, { type: "directional", color: "#ffffff", intensity: 1.6, position: [3, 5, 2], target: [0, 0, 0] }]);
    expect(stateAt({ format: "dionysus.scene/1", objects: [] }, 0).lights).toEqual([{ type: "hemisphere", color: "#ffffff", intensity: 1, groundColor: "#303040" }, { type: "directional", color: "#ffffff", intensity: 1.5, position: [3, 5, 2], target: [0, 0, 0] }]);
    expect(validateScene(SAMPLE_SCENE)).toEqual([]);
  });

  it("an object called post, fog or sky keeps its events (and the world's one is warned about)", () => {
    const d = base({ world: { fog: {} }, objects: [{ id: "fog", shape: "box" }], events: [{ at: 0, obj: "fog", call: "opacity", args: { value: 0 }, dur: 2 }] });
    expect(errors(d)).toEqual([]);
    expect(warnings(d).join(" ")).toMatch(/An object is called "fog"/);
    expect(lookTargetOf(d, "fog")).toBeUndefined();
    expect(stateAt(d, 1).objects[0].opacity).toBe(0.5);
    expect(stateAt(d, 1).fog!.near).toBe(10);
  });
});

describe("Scene Phase 1: validation", () => {
  it("materials: names or objects with checked fields", () => {
    const obj = (material: unknown) => base({ objects: [{ id: "a", material } as never] });
    expect(errors(obj("toon"))).toEqual([]);
    expect(errors(obj({ type: "toon", steps: 4, outline: { color: "#000000", width: 0.03 }, rim: true, emissive: "#ff8800", emissiveIntensity: 2 }))).toEqual([]);
    expect(errors(obj("shiny"))[0]).toMatch(/^objects\[0\].material: must be one of "standard", "toon", "unlit", "keep"/);
    expect(errors(obj({ steps: 9 }))).toEqual(["objects[0].material.steps: must be a whole number from 2 to 8."]);
    expect(errors(obj({ outline: { width: 3 } }))).toEqual(["objects[0].material.outline.width: must be a number from 0 to 1."]);
    expect(errors(obj({ glow: 1 }))[0]).toMatch(/material.glow: is not a field here/);
  });

  it("lights: groundColor, lookAt and shadow, with warnings where they do nothing", () => {
    const d = base({ world: { lights: [{ type: "point", shadow: { mapSize: 1024, radius: 2 }, lookAt: [0, 0, 0] }, { type: "ambient", shadow: true }, { type: "directional", shadow: { mapSize: 1000 } }] } });
    expect(errors(d)).toEqual(["world.lights[2].shadow.mapSize: must be 256, 512, 1024, 2048 or 4096."]);
    expect(warnings(d)).toEqual(["world.lights[0].lookAt: only a directional light is aimed (others light all around).", "world.lights[1].shadow: only directional and point lights cast shadows."]);
  });

  it("world.post / fog / sky / environment / export", () => {
    expect(errors(base({ world: { post: { toneMapping: "filmic" as never, bloom: { strength: 9 }, aa: "msaa" as never }, export: { supersample: 8 } } }))).toEqual([
      'world.post.toneMapping: must be one of "none", "linear", "reinhard", "cineon", "aces", "agx".',
      "world.post.bloom.strength: must be a number from 0 to 5.",
      'world.post.aa: must be one of "none", "fxaa", "smaa".',
      "world.export.supersample: must be 1, 2, 3 or 4.",
    ]);
    expect(errors(base({ world: { sky: { light: "nope" } } }))).toEqual(['world.sky.light: There is no light "nope".']);
    expect(errors(base({ world: { sky: { light: "fill" } } }))).toEqual(['world.sky.light: "fill" is a hemisphere light; the sun drives a directional light.']);
    expect(warnings(base({ world: { environment: { file: "studio.hdr" } } }))).toEqual(['world.environment.file: "studio.hdr" is not in "files"; there is no environment map.']);
    expect(warnings(base({ world: { fog: { near: 20, far: 10 } } }))).toEqual(["world.fog: far is not beyond near, so the fog is full from near."]);
  });

  it("events on lights, post, fog and sky: calls, values and warnings", () => {
    const ev = (e: Record<string, unknown>, world: Record<string, unknown> = {}) => base({ world: world as never, events: [{ at: 0, ...e } as never] });
    expect(errors(ev({ obj: "key", call: "intensity", args: { value: 2 }, dur: 1 }))).toEqual([]);
    expect(errors(ev({ obj: "key", call: "lookAt", args: { target: "ball" } }))).toEqual([]);
    expect(errors(ev({ obj: "key", call: "intensity", args: { value: -1 } }))).toEqual(["events[0].args.value: must be a number ≥ 0."]);
    expect(errors(ev({ obj: "key", call: "spin" }))[0]).toMatch(/The light "key" has no function "spin" \(intensity, color, position, moveTo, lookAt\)/);
    expect(errors(ev({ obj: "key", call: "color", args: { value: "#ff0000", extra: 1 } }))).toEqual(['events[0].args.extra: "color" takes "value" only.']);
    expect(warnings(ev({ obj: "fill", call: "moveTo", args: { position: [0, 1, 0] } })).join(" ")).toMatch(/hemisphere light: it lights from everywhere/);
    expect(errors(ev({ obj: "post", call: "dofFocus", args: { value: 3 } }))).toEqual([]);
    expect(warnings(ev({ obj: "post", call: "dofFocus", args: { value: 3 } }))).toEqual(["events[0].obj: The scene has no world.post, so this event changes nothing."]);
    expect(warnings(ev({ obj: "post", call: "dofFocus", args: { value: 3 } }, { post: {} }))).toEqual(['events[0].call: world.post.dof is off, so "dofFocus" changes nothing.']);
    expect(errors(ev({ obj: "sky", call: "sunElevation", args: { value: 120 } }, { sky: {} }))).toEqual(["events[0].args.value: must be a number from -90 to 90."]);
    expect(errors(ev({ obj: "nowhere", call: "intensity", args: { value: 1 } }))).toEqual(['events[0].obj: There is no object "nowhere".']);
    // A light without an id can't be named; overlapping tweens of one light property are warned like objects'.
    const two = base({ events: [{ at: 0, obj: "key", call: "intensity", args: { value: 2 }, dur: 4 }, { at: 1, obj: "key", call: "intensity", args: { value: 0 }, dur: 1 }] });
    expect(warnings(two).join(" ")).toMatch(/still changes key.intensity/);
  });
});

describe("Scene Phase 1: evaluation (a pure function of the document and t)", () => {
  it("light events tween intensity, colour, position and aim (an object's position where the event ends)", () => {
    const d = base({ events: [
      { at: 1, obj: "key", call: "intensity", args: { value: 3 }, dur: 2 },
      { at: 0, obj: "key", call: "color", args: { value: "#000000" }, dur: 2 },
      { at: 0, obj: "bulb", call: "moveTo", args: { position: [3, 1, 1] }, dur: 2 },
      { at: 0, obj: "key", call: "lookAt", args: { target: "ball" }, dur: 2 },
      { at: 0, obj: "ball", call: "moveTo", args: { position: [4, 0, 0] }, dur: 2 },
    ] });
    const s = stateAt(d, 2);
    expect(s.lights[0]).toMatchObject({ id: "key", intensity: 2, color: "#000000", target: [4, 0, 0] });
    expect(stateAt(d, 1).lights[0].color).toBe("#808080");
    expect(stateAt(d, 1).lights[2].position).toEqual([2, 1, 1]);
    expect(stateAt(d, 9).lights[0].intensity).toBe(3);
    expect(stateAt(d, 0.5)).toEqual(stateAt(d, 0.5));
  });

  it("post, fog and sky resolve with defaults and tween; the sun places its directional light", () => {
    const d = base({
      world: { post: { dof: { focus: 10 }, bloom: true }, fog: { type: "exp2", density: 0.02 }, sky: { elevation: 30, azimuth: 90, light: "key" } },
      events: [
        { at: 0, obj: "post", call: "dofFocus", args: { value: 2 }, dur: 4 },
        { at: 0, obj: "post", call: "lift", args: { value: [0.2, 0, 0] }, dur: 2 },
        { at: 0, obj: "fog", call: "density", args: { value: 0.06 }, dur: 2 },
        { at: 0, obj: "sky", call: "sunElevation", args: { value: 0 }, dur: 2 },
        { at: 0, obj: "key", call: "moveTo", args: { position: [9, 9, 9] } },
      ],
    });
    const s = stateAt(d, 1);
    expect(s.post).toMatchObject({ toneMapping: "aces", exposure: 1, aa: "fxaa", dof: { focus: 8, aperture: 0.01, maxblur: 0.01 }, bloom: { strength: 0.6, radius: 0.4, threshold: 0.85 }, lift: [0.1, 0, 0] });
    expect(s.post!.ssao).toBeUndefined();
    expect(s.fog!.type).toBe("exp2"); expect(s.fog!.density).toBeCloseTo(0.04, 9);
    expect(s.sky!.elevation).toBe(15);
    const dir = sunDirection(15, 90);
    expect(s.lights[0].position!.map((x) => +x.toFixed(6))).toEqual(dir.map((x) => +(x * SUN_DISTANCE).toFixed(6)));
    expect(sunDirection(90, 0).map((x) => +x.toFixed(6))).toEqual([0, 1, 0]);
    // Without a sky the tone mapping default is "none" (the old picture).
    expect(stateAt(base({ world: { post: {} } }), 0).post!.toneMapping).toBe("none");
  });
});

describe("Scene Phase 1: editing (editor and agents)", () => {
  it("calls, arguments, defaults and tweening for lights and the world's look", () => {
    const d = base({ world: { post: { bloom: true } } });
    expect(sceneCalls(d, "key").map((c) => c.call)).toEqual(["intensity", "color", "position", "moveTo", "lookAt"]);
    expect(sceneCalls(d, "post").map((c) => c.call)).toEqual(["exposure", "contrast", "saturation", "lift", "gamma", "gain", "vignette", "grain", "bloomStrength", "bloomRadius", "bloomThreshold"]);
    expect(sceneCallArgs(d, "post", "vignette")).toEqual([{ name: "value", kind: "number", label: "Vignette", min: 0, max: 1, step: 0.05 }]);
    expect(sceneCallArgs(d, "key", "lookAt")).toEqual([{ name: "target", kind: "target", label: "Aim at" }]);
    expect(defaultCallArgs(d, "key", "intensity", 0)).toEqual({ value: 1 });
    expect(defaultCallArgs(d, "post", "bloomStrength", 0)).toEqual({ value: 0.6 });
    expect(defaultCallArgs(d, "bulb", "moveTo", 0)).toEqual({ position: [1, 1, 1] });
    expect(callTweens(d, "key", "color")).toBe(true);
    expect(sceneCalls(d, "fog")).toEqual([]);
  });

  it("tracks: lights with an id and the world's post / fog / sky take events", () => {
    const d = base({ world: { post: {}, sky: {} }, events: [{ at: 1, obj: "key", call: "intensity", args: { value: 2 }, dur: 1 }, { at: 2, obj: "post", call: "exposure", args: { value: 2 } }] });
    const tracks = sceneTracks(d);
    const key = tracks.find((t) => t.label === "key")!;
    expect(key).toMatchObject({ kind: "light", obj: "key" });
    expect(key.blocks.map((b) => b.call)).toEqual(["intensity"]);
    expect(tracks.filter((t) => t.kind === "look").map((t) => [t.id, t.blocks.length])).toEqual([["post", 1], ["sky", 0]]);
    expect(tracks.some((t) => t.kind === "missing")).toBe(false);
  });

  it("updateSceneLook merges, removes fields and entries", () => {
    let d = updateSceneLook(base(), "post", { bloom: true, vignette: 0.2 });
    expect(d.world!.post).toEqual({ bloom: true, vignette: 0.2 });
    d = updateSceneLook(d, "post", { vignette: undefined, grain: 0.1 });
    expect(d.world!.post).toEqual({ bloom: true, grain: 0.1 });
    expect(updateSceneLook(d, "post", undefined).world!.post).toBeUndefined();
    expect(updateSceneLook(d, "fog", undefined)).toBe(d);
  });

  it("agent tools: set_scene_world look, set_scene_light shadow and aim, material on objects, events on lights and post", () => {
    const ok = (r: ReturnType<typeof applySceneTool>) => { if (!r.ok) throw new Error(r.error); return r; };
    let d = ok(applySceneTool("set_scene_world", base(), { post: { bloom: true, dof: { focus: 5 } }, fog: true, sky: { light: "key" }, export: { supersample: 2 } })).doc;
    expect(d.world).toMatchObject({ post: { bloom: true, dof: { focus: 5 } }, fog: {}, sky: { light: "key" }, export: { supersample: 2 } });
    const bad = applySceneTool("set_scene_world", d, { post: { aa: "msaa" } });
    expect(!bad.ok && bad.error).toMatch(/world.post.aa: must be one of/);
    d = ok(applySceneTool("set_scene_light", d, { light: "key", shadow: { mapSize: 1024 }, lookAt: [0, 1, 0] })).doc;
    expect(d.world!.lights![0]).toMatchObject({ shadow: { mapSize: 1024 }, lookAt: [0, 1, 0] });
    d = ok(applySceneTool("set_scene_object", d, { objectId: "ball", props: { material: { type: "toon", outline: true } } })).doc;
    expect(d.objects[0].material).toEqual({ type: "toon", outline: true });
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 1, obj: "post", call: "dofFocus", args: { value: 2 }, dur: 1 } })).doc;
    d = ok(applySceneTool("add_scene_event", d, { event: { at: 0, obj: "key", call: "color", dur: 2 } })).doc;
    expect(d.events![1].args).toEqual({ value: "#ffffff" });
    const noFog = applySceneTool("add_scene_event", base(), { event: { at: 0, obj: "fog", call: "near", args: { value: 1 } } });
    expect(!noFog.ok && noFog.error).toMatch(/The scene has no world.fog; add it with set_scene_world first/);
    const listed = sceneObjectsForAgent(d);
    expect(Object.keys(listed.look)).toEqual(["post", "fog", "sky"]);
    expect(listed.lights[0].calls!.map((c) => c.call)).toContain("intensity");
  });
});

describe("Scene Phase 1: the benchmark shot (epic #349)", () => {
  const SAMPLE = resolve(__dirname, "../../../public/samples/scenes/benchmark-shot.scene.json");
  it("is valid, deterministic and published as a sample", () => {
    expect(errors(BENCHMARK_SHOT)).toEqual([]);
    expect(warnings(BENCHMARK_SHOT)).toEqual([]);
    for (const t of [0, 3.3, 7.25, 10.5, 12, 15]) expect(JSON.stringify(stateAt(BENCHMARK_SHOT, t))).toBe(JSON.stringify(stateAt(structuredClone(BENCHMARK_SHOT), t)));
    const text = `${JSON.stringify(BENCHMARK_SHOT, null, 1)}\n`;
    if (process.env.UPDATE_SCENE_GOLDEN) { mkdirSync(dirname(SAMPLE), { recursive: true }); writeFileSync(SAMPLE, text); }
    expect(readFileSync(SAMPLE, "utf8").replace(/\r\n/g, "\n")).toBe(text);
  });

  it("goes warm to dusk, lights the lantern, cuts and pulls focus", () => {
    const at = (t: number) => stateAt(BENCHMARK_SHOT, t);
    expect(at(0).sky!.elevation).toBe(10);
    expect(at(14).sky!.elevation).toBe(-1.5);
    expect(at(0).lights.find((l) => l.id === "lantern")!.intensity).toBe(0);
    expect(at(8).lights.find((l) => l.id === "lantern")!.intensity).toBe(0.9);
    expect(at(14).lights.find((l) => l.id === "sun")!.color).toBe("#ff7a4a");
    expect(at(9.99).camera.position).not.toEqual(at(10).camera.position);
    expect(at(10).camera.position).toEqual([3.4, 1.65, 3.6]);
    expect(at(10.3).post!.dof!.focus).toBe(6.2);
    expect(at(12).post!.dof!.focus).toBe(3.3);
    expect(at(15).fog!.far).toBe(50);
  });
});
