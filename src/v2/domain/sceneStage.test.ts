import { describe, expect, it } from "vitest";
import { stateAt, validateScene, type SceneDoc } from "./scene";
import {
  applyScenePreset, blockAction, briefFromText, checkScene, draftSceneFromShot, emptyScene, lumaStats, lumaVerdict, mergeSceneDraft, parseBlocking,
  projectPoint, reviewTimes, SCENE_LOOK_PRESETS, SCENE_PRESETS, SCENE_RIG_PRESETS, setMood, splitClauses, stageScene, type StageBrief,
} from "./sceneStage";
import { BENCHMARK_BRIEF, BENCHMARK_BLOCKING, buildBenchmarkFromBrief } from "./__fixtures__/benchmarkBrief";

const errors = (d: SceneDoc) => validateScene(d).filter((i) => i.level === "error");
const ok = <T,>(r: T | { error: string }): T => { if (r && typeof r === "object" && "error" in r) throw new Error((r as { error: string }).error); return r as T; };

const brief: StageBrief = {
  name: "Village", durationSec: 8, mood: { preset: "dusk-village" },
  set: [{ id: "house", kind: "house", at: "back" }, { id: "door", kind: "door", at: { near: "house", side: "front" } }, { id: "lamp", kind: "lamp", at: "right" }, { id: "bench", kind: "bench", at: "left" }],
  characters: [{ id: "ana", name: "Ana", at: "front-left" }, { id: "ben", name: "Ben", at: "front-right" }],
  cameras: [{ subject: "ana", shot: "wide" }],
};

describe("Scene Phase 4: presets", () => {
  it("every look preset gives a valid scene, every rig compiles", () => {
    for (const p of SCENE_LOOK_PRESETS) {
      const r = ok(applyScenePreset(emptyScene(), p.id));
      expect(errors(r.doc), p.id).toEqual([]);
    }
    const staged = ok(stageScene(emptyScene(), brief)).doc;
    for (const p of SCENE_RIG_PRESETS) {
      const r = ok(applyScenePreset(staged, p.id, { at: 1, subject: "ana" }));
      expect(errors(r.doc), p.id).toEqual([]);
      expect(r.doc.events!.length).toBeGreaterThan(staged.events!.length);
    }
    expect(SCENE_PRESETS.map((p) => p.id)).toContain("rainy-night");
    expect(SCENE_PRESETS.map((p) => p.id)).toContain("interior-lamp");
  });
  it("presets are plain JSON (round-trip unchanged)", () => {
    expect(JSON.parse(JSON.stringify(SCENE_PRESETS))).toEqual(SCENE_PRESETS);
  });
  it("a custom preset object applies; an unknown id lists the presets", () => {
    const r = ok(applyScenePreset(emptyScene(), { kind: "look", world: { background: "#112233" } }));
    expect(r.doc.world?.background).toBe("#112233");
    expect(applyScenePreset(emptyScene(), "nope")).toMatchObject({ error: expect.stringContaining("dusk-village") });
  });
  it("orbit-reveal turns 60° from the camera's current angle around the subject", () => {
    const staged = ok(stageScene(emptyScene(), brief)).doc;
    const r = ok(applyScenePreset(staged, "orbit-reveal", { at: 1, subject: "ana" }));
    const e = r.doc.events!.at(-1)!;
    expect(e.call).toBe("orbit");
    expect(typeof e.args!.to).toBe("number");
    expect(e.args!.turn).toBeUndefined();
  });
});

describe("Scene Phase 4: set_mood", () => {
  it("time of day sets the sun, fill, sky and exposure", () => {
    const r = ok(setMood(emptyScene(), { timeOfDay: "dusk", palette: "teal-orange", post: "cinematic" }));
    const w = r.doc.world!;
    expect(w.lights!.find((l) => l.id === "sun")).toMatchObject({ type: "directional", color: "#ff7a4a" });
    expect(w.lights!.find((l) => l.id === "fill")).toMatchObject({ type: "hemisphere" });
    expect(w.sky).toMatchObject({ elevation: 1.5, light: "sun" });
    expect(w.post).toMatchObject({ toneMapping: "aces", saturation: 1.15, vignette: 0.3 });
    expect(errors(r.doc)).toEqual([]);
  });
  it("with at, the time of day changes over time as events", () => {
    const r = ok(setMood(emptyScene(), { timeOfDay: "night", at: 2, dur: 5 }));
    expect(r.doc.events!.map((e) => `${e.obj}.${e.call}`)).toEqual(["sky.sunElevation", "sky.sunAzimuth", "sun.color", "sun.intensity", "fill.color", "fill.intensity", "post.exposure"]);
    expect(errors(r.doc)).toEqual([]);
    expect(stateAt(r.doc, 7.5).sky!.elevation).toBeCloseTo(-8);
  });
  it("refuses nothing to do and bad values", () => {
    expect(setMood(emptyScene(), {})).toHaveProperty("error");
    expect(setMood(emptyScene(), { palette: "rainbow" as never })).toHaveProperty("error");
  });
});

describe("Scene Phase 4: stage_scene", () => {
  it("places pieces, characters, lights and a framed camera; the scene is valid and nothing overlaps", () => {
    const { doc, report } = ok(stageScene(emptyScene(), brief));
    expect(errors(doc)).toEqual([]);
    expect(report.added).toEqual(expect.arrayContaining(["ground", "house", "house-roof", "door", "lamp", "lamp-light", "bench", "ana", "ben"]));
    expect(doc.world!.lights!.some((l) => l.id === "lamp-glow")).toBe(true);
    // The door sits on the house's front face.
    const house = doc.objects.find((o) => o.id === "house")!, door = doc.objects.find((o) => o.id === "door")!;
    expect(door.position![2]).toBeCloseTo(house.position![2] + 1.25 + 0.03, 2);
    const checks = checkScene(doc, { times: [0] });
    expect(checks.filter((c) => c.kind === "overlap")).toEqual([]);
    expect(checks.filter((c) => c.kind === "out-of-frame")).toEqual([]);
  });
  it("two pieces asked for the same spot are nudged apart", () => {
    const { doc } = ok(stageScene(emptyScene(), { set: [{ id: "a", kind: "crate", at: "center" }, { id: "b", kind: "crate", at: "center" }] }));
    expect(checkScene(doc, { times: [0] }).filter((c) => c.kind === "overlap")).toEqual([]);
    expect(doc.objects.find((o) => o.id === "a")!.position).not.toEqual(doc.objects.find((o) => o.id === "b")!.position);
  });
  it("re-staging keeps objects the user moved (ids match) unless replace", () => {
    const first = ok(stageScene(emptyScene(), brief)).doc;
    const moved = { ...first, objects: first.objects.map((o) => (o.id === "ana" ? { ...o, position: [3, 0, 3] as [number, number, number] } : o)) };
    const again = ok(stageScene(moved, brief));
    expect(again.report.kept).toEqual(expect.arrayContaining(["house", "ana", "ben"]));
    expect(again.doc.objects.find((o) => o.id === "ana")!.position).toEqual([3, 0, 3]);
    const replaced = ok(stageScene(moved, brief, { replace: true }));
    expect(replaced.doc.objects.find((o) => o.id === "ana")!.position).not.toEqual([3, 0, 3]);
  });
  it("errors name what to fix", () => {
    expect(stageScene(emptyScene(), { set: [{ kind: "spaceship" }] })).toMatchObject({ error: expect.stringContaining("Kinds:") });
    expect(stageScene(emptyScene(), { set: [{ kind: "crate", at: "upstage" as never }] })).toMatchObject({ error: expect.stringContaining("Spots:") });
    expect(stageScene(emptyScene(), { cameras: [{ subject: "nobody" }] })).toMatchObject({ error: expect.stringContaining("no object") });
  });
  it("several cameras become shots over the length", () => {
    const { doc } = ok(stageScene(emptyScene(), { ...brief, cameras: [{ subject: "ana", shot: "wide" }, { subject: "ben", shot: "closeup" }] }));
    expect(doc.shots).toEqual([{ at: 0, camera: "camera", name: "wide ana" }, { at: 4, camera: "cam-closeup-ben", name: "closeup ben" }]);
    expect(errors(doc)).toEqual([]);
  });
});

describe("Scene Phase 4: block_action", () => {
  const staged = () => ok(stageScene(emptyScene(), brief)).doc;
  it("splits clauses but keeps quoted lines whole", () => {
    expect(splitClauses('Ana walks to the door, turns to Ben and says "Hi, Ben. Ready?" then camera pushes in.')).toEqual(["Ana walks to the door", "turns to Ben", 'says "Hi, Ben. Ready?"', "camera pushes in"]);
  });
  it("compiles the issue's example into walk, turn and a dolly, one after another", () => {
    const r = ok(blockAction(staged(), { text: "Ana walks to the door, turns to Ben, camera pushes in", at: 0.5 }));
    expect(r.events.map((e) => `${e.obj}.${e.call}`)).toEqual(["ana.walkTo", "ana.turnTo", "camera.dolly"]);
    expect(r.events[1].at).toBeGreaterThan(r.events[0].at + 1);
    expect(r.events[2].at).toBeGreaterThan(r.events[1].at);
    expect(errors(r.doc)).toEqual([]);
    expect(r.skipped).toEqual([]);
    // Ana stops in front of the door, not inside the house.
    const end = stateAt(r.doc, r.events[1].at).objects.find((o) => o.id === "ana")!;
    expect(checkScene(r.doc, { times: [r.events[1].at] }).filter((c) => c.kind === "overlap")).toEqual([]);
    expect(end.position[2]).toBeGreaterThan(-1.5);
  });
  it("understands gestures, lines, sitting, expressions, camera cuts and 'as' beats", () => {
    const r = ok(blockAction(staged(), { text: 'Ben sits on the bench. Ana waves at Ben, smiles and says "Good evening!" As Ana talks, camera orbits Ana. Cut to a close-up of Ben.' }));
    const calls = r.events.map((e) => `${e.obj}.${e.call}`);
    expect(calls).toEqual(expect.arrayContaining(["ben.sit", "ana.lookAt", "ana.gesture", "ana.expression", "ana.speak", "camera.orbit"]));
    expect(r.doc.shots!.at(-1)!.camera).toMatch(/^cam-closeup-ben/);
    const talk = r.events.find((e) => e.call === "gesture" && (e.args as { clip: string }).clip === "talk")!;
    expect(r.events.find((e) => e.call === "orbit")!.at).toBe(talk.at);
    expect(errors(r.doc)).toEqual([]);
  });
  it("reports clauses it doesn't understand and keeps the rest", () => {
    const r = ok(blockAction(staged(), { text: "Ana juggles three torches, Ana walks to the lamp" }));
    expect(r.skipped).toHaveLength(1);
    expect(r.events.map((e) => e.call)).toEqual(["walkTo"]);
    expect(blockAction(staged(), { text: "Zed flies away" })).toHaveProperty("error");
  });
  it("structured beats work too, and the planned length grows to fit", () => {
    const r = ok(blockAction(staged(), { beats: [{ who: "ana", do: "walk", target: [4, 0, 2] }, { who: "camera", do: "follow", target: "ana", with: true }], at: 6 }));
    expect(r.doc.durationSec).toBeGreaterThanOrEqual(r.endSec);
    expect(r.events.map((e) => e.call)).toEqual(["walkTo", "follow"]);
  });
  it("parseBlocking resolves names, ids and 'the door'", () => {
    const p = parseBlocking(staged(), "Ben walks to the door");
    expect(p.beats[0]).toMatchObject({ who: "ben", do: "walk", target: "the door" });
  });
});

describe("Scene Phase 4: automatic checks", () => {
  it("finds an intersection, a character out of frame, the camera inside geometry", () => {
    const base = ok(stageScene(emptyScene(), brief)).doc;
    const bad: SceneDoc = {
      ...base,
      objects: base.objects.map((o) => (o.id === "ben" ? { ...o, position: [base.objects.find((x) => x.id === "bench")!.position![0], 0, base.objects.find((x) => x.id === "bench")!.position![2]] as [number, number, number] } : o.id === "ana" ? { ...o, position: [40, 0, 0] as [number, number, number] } : o)),
      world: { ...base.world, camera: { ...base.world!.camera, position: base.objects.find((o) => o.id === "house")!.position } },
    };
    const kinds = checkScene(bad, { times: [0] }).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["overlap", "camera-inside"]));
    const far = { ...bad, world: base.world, objects: bad.objects.map((o) => (o.id === "ben" ? { ...o, position: [-40, 0, 0] as [number, number, number] } : o)) };
    expect(checkScene(far, { times: [0] }).map((c) => `${c.kind}:${c.objects?.join(",")}`)).toContain("out-of-frame:ana");
  });
  it("finds a character hidden behind a wall from the camera", () => {
    const { doc } = ok(stageScene(emptyScene(), { set: [{ id: "wall", kind: "wall", at: { x: 0, z: 2 } }], characters: [{ id: "ana", at: { x: 0, z: 0 } }], cameras: [{ id: "camera", subject: "ana", shot: "full" }] }));
    expect(checkScene(doc, { times: [0] }).map((c) => `${c.kind}:${c.objects?.join(",")}`)).toContain("occluded:ana,wall");
    const moved = { ...doc, objects: doc.objects.map((o) => (o.id === "wall" ? { ...o, position: [6, 1.25, 2] as [number, number, number] } : o)) };
    expect(checkScene(moved, { times: [0] }).filter((c) => c.kind === "occluded")).toEqual([]);
  });
  it("a character sitting on a bench is not an intersection", () => {
    const r = ok(blockAction(ok(stageScene(emptyScene(), brief)).doc, { text: "Ben sits on the bench", at: 0 }));
    expect(checkScene(r.doc, { times: [2] }).filter((c) => c.kind === "overlap")).toEqual([]);
  });
  it("projects points like the camera sees them", () => {
    const cam = { fov: 40, position: [0, 1, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
    expect(projectPoint(cam, [0, 1, 0])).toMatchObject({ x: 0, y: 0, behind: false });
    expect(projectPoint(cam, [0, 1, 10]).behind).toBe(true);
    expect(Math.abs(projectPoint(cam, [20, 1, 0]).x)).toBeGreaterThan(1);
  });
  it("judges brightness from pixels", () => {
    const px = (v: number) => new Uint8ClampedArray(Array.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : v)));
    expect(lumaVerdict(lumaStats(px(5)), 1)?.kind).toBe("dark");
    expect(lumaVerdict(lumaStats(px(252)), 1)?.kind).toBe("bright");
    expect(lumaVerdict(lumaStats(px(120)), 1)).toBeUndefined();
  });
  it("reviews around every shot", () => {
    const t = reviewTimes({ ...emptyScene(10), shots: [{ at: 0, camera: "camera" }, { at: 5, camera: "camera" }] });
    expect(t).toEqual([0.2, 2.5, 4.8, 5.2, 7.5, 9.8]);
  });
});

describe("Scene Phase 4: storyboard shot → scene", () => {
  const shot = { title: "Arrival", durationSec: 8, camera: "wide, slow push in", prompt: "At dusk, Ana walks to the lamp by the old house and waves at Ben, who sits on the bench.", refs: [{ id: "ana", name: "Ana", type: "character" }, { id: "ben", name: "Ben", type: "character" }] };
  it("drafts a set, characters, mood, camera and blocking from the prompt and references", () => {
    const { brief: b } = briefFromText(shot);
    expect(b.mood).toEqual({ preset: "dusk-village" });
    expect(b.set!.map((s) => s.kind)).toEqual(expect.arrayContaining(["lamp", "house", "bench"]));
    expect(b.characters!.map((c) => c.id)).toEqual(["ana", "ben"]);
    const d = draftSceneFromShot(shot);
    expect(errors(d.doc)).toEqual([]);
    expect(d.doc.events!.map((e) => `${e.obj}.${e.call}`)).toEqual(expect.arrayContaining(["ana.walkTo", "ana.gesture", "ben.sit", "camera.dolly"]));
    expect(d.doc.durationSec).toBe(8);
  });
  it("regenerating keeps the user's edits where ids match and adds what is new", () => {
    const first = draftSceneFromShot(shot).doc;
    const edited: SceneDoc = { ...first, objects: [...first.objects.map((o) => (o.id === "house" ? { ...o, color: "#123456" } : o)), { id: "cart", shape: "box", position: [2, 0.5, 2] }] };
    const next = draftSceneFromShot({ ...shot, prompt: `${shot.prompt} A well stands in the square.` }).doc;
    const m = mergeSceneDraft(edited, next);
    expect(m.doc.objects.find((o) => o.id === "house")!.color).toBe("#123456");
    expect(m.doc.objects.some((o) => o.id === "cart")).toBe(true);
    expect(m.added).toContain("well");
    expect(m.kept).toContain("house");
    expect(errors(m.doc)).toEqual([]);
  });
});

describe("Scene Phase 4: acceptance — the benchmark shot from a one-paragraph brief", () => {
  it("staging + mood + blocking give the benchmark shot; review finds a problem; one correction clears it", () => {
    const run = buildBenchmarkFromBrief();
    expect(errors(run.draft)).toEqual([]);
    expect(run.firstReview.length).toBeGreaterThan(0);
    expect(errors(run.fixed)).toEqual([]);
    expect(run.secondReview.filter((c) => c.level === "warning")).toEqual([]);
    expect(run.corrections.length).toBeGreaterThanOrEqual(1);
    // Round 2 finds the first fix wanting: the orbit camera sees the hero through the house; the next angle clears it.
    expect(run.reviews[1].some((c) => c.kind === "occluded" && c.objects!.includes("house"))).toBe(true);
    expect(run.corrections).toEqual(expect.arrayContaining(["frame orbit three-quarter-left", "frame orbit front", "frame close front"]));
    expect(BENCHMARK_BRIEF.length).toBeGreaterThan(100);
    expect(BENCHMARK_BLOCKING).toContain("waves");
  });
});
