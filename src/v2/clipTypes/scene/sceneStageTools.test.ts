// @vitest-environment jsdom
/**
 * Scene Phase 4 (#353): the AI cooperation loop through the scene clip type's tools (runSceneTool with the app's
 * ClipAgentApi shape): stage_scene, set_mood, block_action, apply_scene_preset, list_scene_presets, check_scene,
 * review_scene (rendered contact sheet through `frames`, with the checks) and draft_scene_from_shot (storyboard → scene,
 * regenerating keeps the user's edits).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { board, createProject, parseScene, validateScene, type Project, type SceneDoc } from "../../domain";
import { validateStoryboard } from "../../domain/storyJson";
import { cmd, Engine } from "../../engine";
import type { ClipAgentApi } from "../types";
import { resetSceneAgentSession, runSceneTool } from "./agent";
import { BENCHMARK_BLOCKING, BENCHMARK_STAGE } from "../../domain/__fixtures__/benchmarkBrief";

const readBlob = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(b); });
function api(e: Engine, opts: { stills?: ClipAgentApi["stills"] } = {}) {
  const m = new Map<string, Blob>();
  const a: ClipAgentApi & { m: Map<string, Blob> } = {
    m, project: () => e.getState().project, edit: (label, apply) => e.dispatch({ label, apply }),
    // jsdom's Blob has no text(); give stored blobs one, like the browser's.
    blobs: { async get(k) { return m.get(k); }, async put(k, b) { Object.defineProperty(b, "text", { value: () => readBlob(b), configurable: true }); m.set(k, b); } },
    ...(opts.stills ? { stills: opts.stills } : {}),
  };
  return a;
}
const run = async (a: ClipAgentApi, name: string, input: Record<string, unknown>) => {
  const r = await runSceneTool(name, input, a);
  let json: Record<string, unknown> | undefined;
  try { json = JSON.parse(r.text); } catch { json = undefined; }
  return { ...r, json: json as Record<string, any> };
};
async function sceneOfClip(p: Project, a: { m: Map<string, Blob> }, clipId: string): Promise<SceneDoc> {
  const pl = Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements)).find((x) => x.id === clipId)!;
  const asset = p.assets[pl.source.assetId];
  const v = asset.versions.find((x) => x.id === (pl.source as { versionId?: string }).versionId)!;
  return parseScene(await readBlob(a.m.get(v.media.blobKey)!)).doc!;
}

beforeEach(() => resetSceneAgentSession());

describe("Scene Phase 4 tools", () => {
  it("the agent loop: stage, mood, block, check → fix → check clean; each edit one undo step", async () => {
    const e = new Engine(createProject("t")), a = api(e);
    const made = await run(a, "create_scene_clip", { name: "Benchmark", durationSec: 14 });
    const clipId = made.json.clip.id as string;
    const staged = await run(a, "stage_scene", { clipId, brief: BENCHMARK_STAGE });
    expect(staged.ok).toBe(true);
    expect(staged.json.added).toEqual(expect.arrayContaining(["house", "house-roof", "lantern", "hero", "elder"]));
    expect(staged.json.cameras).toEqual(["camera", "orbit", "close"]);
    const mood = await run(a, "set_mood", { clipId, timeOfDay: "night", at: 3, dur: 10 });
    expect(mood.ok).toBe(true);
    const blocked = await run(a, "block_action", { clipId, text: BENCHMARK_BLOCKING, at: 0.5 });
    expect(blocked.ok).toBe(true);
    expect(blocked.json.beats.map((b: { do: string }) => b.do)).toEqual(["walk", "turn", "look", "express", "gesture", "orbit", "say"]);
    const first = await run(a, "check_scene", { clipId });
    const oof = first.json.problems.filter((c: { kind: string; objects: string[] }) => c.kind === "out-of-frame" && c.objects.includes("hero"));
    expect(oof.length).toBeGreaterThan(0);
    // Correction: frame the cameras the review names on the hero at their cuts.
    const doc = await sceneOfClip(e.getState().project, a, clipId);
    for (const cam of [...new Set(oof.map((c: { camera: string }) => c.camera))] as string[]) {
      const at = doc.shots!.find((s) => s.camera === cam)!.at;
      const fix = await run(a, "block_action", { clipId, beats: [{ who: cam, do: "frame", target: "hero", shot: cam === "close" ? "closeup" : "full", at }] });
      expect(fix.ok, fix.text).toBe(true);
    }
    await run(a, "block_action", { clipId, text: "Elder sits on the bench, looks at Hero", at: 0 });
    const second = await run(a, "check_scene", { clipId });
    expect(second.json.problems.filter((c: { level: string }) => c.level === "warning")).toEqual([]);
    const final = await sceneOfClip(e.getState().project, a, clipId);
    expect(validateScene(final).filter((i) => i.level === "error")).toEqual([]);
    // Each edit is one undo step: undoing the last (the elder sitting) brings back the scene before it.
    expect(e.getState().canUndo).toBe(true);
    e.undo();
    const before = await sceneOfClip(e.getState().project, a, clipId);
    expect(before.events!.some((x) => x.obj === "elder" && x.call === "sit")).toBe(false);
  });

  it("presets: list, apply a look and a rig, a custom preset; bad input names the choices", async () => {
    const e = new Engine(createProject("t")), a = api(e);
    const list = await run(a, "list_scene_presets", {});
    expect(list.json.presets.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["dusk-village", "interior-lamp", "rainy-night", "push-in", "orbit-reveal"]));
    expect(list.json.setPieces).toContain("house");
    const clipId = (await run(a, "create_scene_clip", {})).json.clip.id;
    await run(a, "stage_scene", { clipId, brief: { characters: [{ id: "ana" }] } });
    expect((await run(a, "apply_scene_preset", { clipId, preset: "rainy-night" })).ok).toBe(true);
    const doc = await sceneOfClip(e.getState().project, a, clipId);
    expect(doc.objects.some((o) => o.id === "rain" && o.script)).toBe(true);
    expect((await run(a, "apply_scene_preset", { clipId, preset: "push-in", at: 1 })).ok).toBe(true);
    expect((await run(a, "apply_scene_preset", { clipId, preset: { kind: "rig", events: [{ obj: "$camera", call: "crane", args: { distance: 1 }, dur: "$dur" }] }, at: 2, dur: 2 })).ok).toBe(true);
    const bad = await run(a, "apply_scene_preset", { clipId, preset: "sunset-beach" });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("dusk-village");
    expect((await run(a, "set_mood", { clipId })).ok).toBe(false);
    // Semantic tools also run inside apply_scene_edits.
    const batch = await run(a, "apply_scene_edits", { clipId, edits: [{ tool: "set_mood", timeOfDay: "golden" }, { tool: "block_action", text: "ana waves" }] });
    expect(batch.ok, batch.text).toBe(true);
  });

  it("review_scene renders a contact sheet of this scene only, at the shot times, through a temporary scene", async () => {
    const e = new Engine(createProject("t"));
    const calls: { ticks: number[]; labels: string[]; keys: string[]; project: Project }[] = [];
    const a = api(e, { stills: async (project, ticks, o) => { calls.push({ ticks, labels: o.labels, keys: Object.keys(o.extraBlobs ?? {}), project }); return { image: { data: "AAAA", mimeType: "image/jpeg" }, luma: ticks.map((_, i) => (i === 0 ? { mean: 5, dark: 0.9, bright: 0 } : { mean: 120, dark: 0, bright: 0 })) }; } });
    const clipId = (await run(a, "create_scene_clip", { durationSec: 8 })).json.clip.id;
    await run(a, "stage_scene", { clipId, brief: { characters: [{ id: "ana" }, { id: "ben", at: "right" }], cameras: [{ subject: "ana", shot: "wide" }, { subject: "ben", shot: "closeup" }] } });
    const r = await run(a, "review_scene", { clipId, camera: "camera" });
    expect(r.ok, r.text).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].keys[0]).toMatch(/^scene-review\//);
    const p = calls[0].project, clips = p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);
    expect(clips.map((c) => c.id)).toEqual(["scene-review"]);
    expect(r.json.frames.every((f: { camera: string }) => f.camera === "camera")).toBe(true);
    expect(r.image).toEqual({ data: "AAAA", mimeType: "image/jpeg" });
    expect(calls[0].labels[0]).toMatch(/^1\. [\d.]+s · camera$/);
    expect(r.json.problems.some((c: { kind: string }) => c.kind === "dark")).toBe(true);
    expect((await run(a, "review_scene", { clipId, camera: "nope" })).ok).toBe(false);
    const noRender = await run({ ...a, stills: undefined }, "review_scene", { clipId });
    expect(noRender.ok).toBe(false);
    expect(noRender.text).toContain("check_scene");
  });

  it("draft_scene_from_shot drafts a scene shot from its prompt and references; regenerating keeps the user's edits", async () => {
    const doc = {
      format: "dionysus.storyboard/1", version: "3.1", meta: { title: "Arrival", aspect: "16:9" },
      assets: [
        { id: "ana", name: "Ana", type: "character", prompt: "a young courier in a blue coat" },
        { id: "ben", name: "Ben", type: "character", prompt: "an old man with a grey beard" },
        { id: "street-scene", name: "Village street", type: "scene", prompt: "A village street at dusk." },
      ],
      shots: [{ id: "s1", title: "Arrival", durationSec: 8, render: "scene", clip: "street-scene", camera: "wide, slow push in", prompt: "At dusk, Ana walks to the lamp by the old house and waves at Ben, who sits on the bench.", assets: ["ana", "ben"] }],
    };
    const v = validateStoryboard(doc);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.createStoryboard(v.ok ? v.doc : (undefined as never)));
    const a = api(e);
    const r = await run(a, "draft_scene_from_shot", { shotId: "s1" });
    expect(r.ok, r.text).toBe(true);
    expect(r.json.merged).toBe(false);
    expect(r.json.added).toEqual(expect.arrayContaining(["ana", "ben", "house", "lamp", "bench"]));
    const slot = e.getState().project.storyboard!.slots["street-scene"];
    const versions = board.versionsOf(e.getState().project, slot);
    expect(versions).toHaveLength(1);
    const first = parseScene(await readBlob(a.m.get(versions[0].media.blobKey)!)).doc!;
    expect(first.events!.map((x) => `${x.obj}.${x.call}`)).toEqual(expect.arrayContaining(["ana.walkTo", "ana.gesture", "ben.sit"]));
    // The user recolours the house and adds a cart; regenerate keeps both.
    const edited: SceneDoc = { ...first, objects: [...first.objects.map((o) => (o.id === "house" ? { ...o, color: "#123456" } : o)), { id: "cart", shape: "box", position: [3, 0.5, 2] }] };
    await a.blobs!.put("user/edit", new Blob([JSON.stringify(edited)]));
    e.dispatch(cmd.addStoryVersion({ slot: "street-scene" }, { blobKey: "user/edit", mime: "application/vnd.dionysus.scene+json", width: 1920, height: 1080 }, { versionId: "user1" }));
    const again = await run(a, "draft_scene_from_shot", { shotId: "s1" });
    expect(again.json.merged).toBe(true);
    const vs = board.versionsOf(e.getState().project, e.getState().project.storyboard!.slots["street-scene"]);
    const latest = parseScene(await readBlob(a.m.get(vs.at(-1)!.media.blobKey)!)).doc!;
    expect(latest.objects.find((o) => o.id === "house")!.color).toBe("#123456");
    expect(latest.objects.some((o) => o.id === "cart")).toBe(true);
    expect((await run(a, "draft_scene_from_shot", { shotId: "nope" })).ok).toBe(false);
  });
});
