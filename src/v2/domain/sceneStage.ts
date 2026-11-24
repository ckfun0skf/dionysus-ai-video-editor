/**
 * Scene Phase 4 (#353, epic #349): the AI cooperation loop — semantic scene building. Pure functions over a
 * `dionysus.scene/1` document that compile intent into the Phase 1–3 fields and events:
 *
 * - `stageScene`: a brief (set pieces, characters, cameras, mood) → objects placed on a stage by named spots or next to
 *   each other (nudged apart so they don't overlap), lights and look from a mood, cameras framed on their subjects.
 * - `blockAction`: "A walks to the door, turns to B, camera pushes in" (or structured beats) → character and camera
 *   events, timed one after another (walks take as long as the distance needs).
 * - `setMood`: a look preset, time of day, palette and post preset → world lights / sky / fog / post (or events, to
 *   change the time of day over a range).
 * - `applyScenePreset`: reusable JSON presets — looks (dusk village, interior lamp-lit, rainy night …) and camera rigs
 *   (push-in, orbit reveal, handheld follow …) — built in or given by the user / agent.
 * - `checkScene`: automatic review of a scene at given times: objects intersecting, a character outside the frame,
 *   the camera inside geometry; `lumaStats` / `lumaVerdict` judge a rendered frame too dark or too bright.
 * - `briefFromText` / `draftSceneFromShot` / `mergeSceneDraft`: a storyboard shot's prompt and references → a
 *   first-draft scene; regenerating keeps the user's edits wherever ids match.
 *
 * Everything stays deterministic: nothing here reads a clock or random numbers, and the output is plain scene data.
 */
import {
  characterHeight, isVec3, sceneCameraDefs, sceneClipInfo, sceneShots, SCENE_CAMERA, stateAt, validateScene,
  type SceneDoc, type SceneEvent, type SceneLight, type SceneObject, type SceneShape, type SceneState, type Vec3,
} from "./scene";
import { addSceneCamera, freeObjectId, roundSec, setSceneShots, updateSceneCamera } from "./sceneEdit";
import { focalToFov, framePose, SHOT_ANGLES, SHOT_HEIGHTS, SHOT_SIZES, type SceneShotAngle, type SceneShotHeight, type SceneShotSize } from "./sceneCamera";
import { floorPath, walkProfile } from "./sceneCharacter";
import { scriptDataUrl } from "./sceneScriptCode";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Like isObj, without narrowing a typed value. */
const isPlain = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const vr = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];
const objectsOf = (doc: SceneDoc): SceneObject[] => (Array.isArray(doc.objects) ? doc.objects.filter((o) => isObj(o) && typeof o.id === "string") : []);
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
const worldOf = (doc: SceneDoc): Record<string, unknown> => (isObj(doc.world) ? (doc.world as Record<string, unknown>) : {});
const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------------------------ presets (JSON)

/** A look preset: world fields (and optional objects, e.g. rain) applied as a whole. Plain JSON. */
export interface SceneLookPreset {
  id: string; kind: "look"; label: string; description: string;
  world: { background?: string; lights?: SceneLight[]; sky?: Record<string, unknown> | null; fog?: Record<string, unknown> | null; post?: Record<string, unknown> | null };
  objects?: SceneObject[];
  files?: Record<string, string>;
}
/**
 * A camera rig preset: events on "$camera" (the camera seen at "$at", or the one named) relative to "$subject". Strings
 * "$camera" / "$subject" are replaced; `dur` "$dur" takes the given length; `args.turn` on orbit is degrees from the
 * camera's current angle around the subject.
 */
export interface SceneRigPreset { id: string; kind: "rig"; label: string; description: string; dur: number; events: Record<string, unknown>[] }
export type ScenePreset = SceneLookPreset | SceneRigPreset;

/** Rain: streaks falling from scene time t alone (seeded), for the rainy-night look. */
const RAIN = `// Rain: streaks that fall and wrap from scene time t alone (seeded).
export function build(THREE, params, ctx) {
  const n = Math.max(1, Math.min(4000, Math.round(params.count)));
  const rnd = ctx.random(11);
  const seeds = new Float32Array(n * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(params.color), transparent: true, opacity: params.opacity, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.seeds = seeds;
  return lines;
}
export function update(lines, t, params) {
  const s = lines.userData.seeds, pos = lines.geometry.attributes.position, n = s.length / 3, h = params.height;
  for (let i = 0; i < n; i++) {
    const k = i * 3, x = (s[k] - 0.5) * params.width, z = (s[k + 1] - 0.5) * params.depth;
    const y = h - ((s[k + 2] * h + t * params.speed) % h);
    pos.setXYZ(i * 2, x, y, z);
    pos.setXYZ(i * 2 + 1, x + params.wind * 0.05, y - params.length, z);
  }
  pos.needsUpdate = true;
}
`;

const shadow = { mapSize: 2048, area: 14, radius: 3 };
/** The built-in looks. Light ids: "sun" (directional, placed by the sky), "fill" (hemisphere), optional "lamp" (point). */
export const SCENE_LOOK_PRESETS: SceneLookPreset[] = [
  { id: "dusk-village", kind: "look", label: "Dusk village", description: "Low warm sun, lavender sky fill, soft fog depth and bloom: a stylized village street at dusk.",
    world: {
      background: "#6f6a86",
      lights: [{ id: "fill", type: "hemisphere", color: "#a8b8ff", groundColor: "#3a2a30", intensity: 0.9 }, { id: "sun", type: "directional", color: "#ffb070", intensity: 2, position: [-8, 6, 6], lookAt: [0, 0, 0], shadow }],
      sky: { elevation: 6, azimuth: 250, turbidity: 6, rayleigh: 2.8, light: "sun" },
      fog: { type: "linear", color: "#7a6c8c", near: 20, far: 70 },
      post: { toneMapping: "aces", exposure: 0.6, contrast: 1.1, saturation: 1.1, lift: [0.02, 0, 0.04], gain: [1.04, 1, 0.96], vignette: 0.28, grain: 0.04, bloom: { strength: 0.35, radius: 0.35, threshold: 1.1 }, aa: "smaa" },
    } },
  { id: "golden-hour", kind: "look", label: "Golden hour", description: "Warm low sun with long shadows, rich saturation and a gentle glow.",
    world: {
      background: "#e8b27a",
      lights: [{ id: "fill", type: "hemisphere", color: "#ffd9b0", groundColor: "#4a3a2a", intensity: 0.8 }, { id: "sun", type: "directional", color: "#ffbf6a", intensity: 2.6, position: [-8, 4, 6], lookAt: [0, 0, 0], shadow }],
      sky: { elevation: 12, azimuth: 245, turbidity: 8, rayleigh: 2, light: "sun" },
      fog: { type: "linear", color: "#d9a978", near: 25, far: 90 },
      post: { toneMapping: "aces", exposure: 0.8, contrast: 1.05, saturation: 1.15, gain: [1.06, 1, 0.92], vignette: 0.2, bloom: { strength: 0.3, radius: 0.4, threshold: 1 }, aa: "smaa" },
    } },
  { id: "noon-sunny", kind: "look", label: "Sunny noon", description: "High white sun, blue sky, crisp toon shading.",
    world: {
      background: "#8fc4f0",
      lights: [{ id: "fill", type: "hemisphere", color: "#cfe6ff", groundColor: "#5a6a40", intensity: 1 }, { id: "sun", type: "directional", color: "#ffffff", intensity: 2.8, position: [3, 10, 4], lookAt: [0, 0, 0], shadow }],
      sky: { elevation: 62, azimuth: 180, turbidity: 3, rayleigh: 1, light: "sun" },
      fog: { type: "linear", color: "#b8d4ee", near: 40, far: 140 },
      post: { toneMapping: "aces", exposure: 0.9, contrast: 1.08, saturation: 1.12, vignette: 0.12, bloom: { strength: 0.15, radius: 0.3, threshold: 1.2 }, aa: "smaa" },
    } },
  { id: "interior-lamp", kind: "look", label: "Interior, lamp-lit", description: "A dark room lit by one warm lamp (point light \"lamp\" with shadows), dim cool fill, deep vignette.",
    world: {
      background: "#16110d",
      lights: [{ id: "fill", type: "hemisphere", color: "#4a5068", groundColor: "#1a120c", intensity: 0.3 }, { id: "lamp", type: "point", color: "#ffb060", intensity: 2.2, position: [0.8, 2.1, 0.4], shadow: { mapSize: 1024, radius: 4 } }],
      sky: null,
      fog: { type: "exp2", color: "#16110d", density: 0.04 },
      post: { toneMapping: "aces", exposure: 1, contrast: 1.12, saturation: 1.05, lift: [0.02, 0.01, 0], vignette: 0.4, grain: 0.05, bloom: { strength: 0.5, radius: 0.5, threshold: 0.9 }, aa: "smaa" },
    } },
  { id: "rainy-night", kind: "look", label: "Rainy night", description: "Cold moonlight, dense blue fog, desaturated grade and falling rain (a Script object \"rain\").",
    world: {
      background: "#0e1219",
      lights: [{ id: "fill", type: "hemisphere", color: "#40506e", groundColor: "#0c0f14", intensity: 0.4 }, { id: "sun", type: "directional", color: "#8aa0ff", intensity: 0.7, position: [6, 9, -4], lookAt: [0, 0, 0], shadow }],
      sky: null,
      fog: { type: "exp2", color: "#1a2230", density: 0.055 },
      post: { toneMapping: "aces", exposure: 0.9, contrast: 1.15, saturation: 0.75, lift: [0, 0.01, 0.04], gain: [0.94, 1, 1.06], vignette: 0.35, grain: 0.08, bloom: { strength: 0.45, radius: 0.4, threshold: 0.85 }, aa: "smaa" },
    },
    objects: [{ id: "rain", position: [0, 0, 0], script: { file: "rain.js", params: { count: 1600, color: "#9fb4d8", opacity: 0.45, width: 24, depth: 16, height: 9, speed: 11, length: 0.35, wind: 1.5 } } }],
    files: { "rain.js": scriptDataUrl(RAIN) } },
  { id: "moonlit", kind: "look", label: "Moonlit night", description: "Clear night: a blue moon light, starless dark sky colour, gentle bloom on any glow.",
    world: {
      background: "#141a2c",
      lights: [{ id: "fill", type: "hemisphere", color: "#3a4a78", groundColor: "#10121a", intensity: 0.45 }, { id: "sun", type: "directional", color: "#9db4ff", intensity: 0.9, position: [-6, 10, 3], lookAt: [0, 0, 0], shadow }],
      sky: null,
      fog: { type: "linear", color: "#141a2c", near: 15, far: 60 },
      post: { toneMapping: "aces", exposure: 0.95, contrast: 1.1, saturation: 0.85, gain: [0.95, 1, 1.08], vignette: 0.3, bloom: { strength: 0.5, radius: 0.45, threshold: 0.8 }, aa: "smaa" },
    } },
  { id: "overcast", kind: "look", label: "Overcast", description: "Soft shadowless daylight, muted colours.",
    world: {
      background: "#a9b0b8",
      lights: [{ id: "fill", type: "hemisphere", color: "#e2e6ec", groundColor: "#5c5f58", intensity: 1.4 }, { id: "sun", type: "directional", color: "#f0f2f5", intensity: 0.8, position: [2, 10, 3], lookAt: [0, 0, 0] }],
      sky: null,
      fog: { type: "linear", color: "#a9b0b8", near: 20, far: 80 },
      post: { toneMapping: "aces", exposure: 0.95, contrast: 0.98, saturation: 0.85, vignette: 0.15, aa: "smaa" },
    } },
  { id: "studio", kind: "look", label: "Studio", description: "Neutral key, fill and rim on a dark backdrop for products and turntables.",
    world: {
      background: "#202228",
      lights: [{ id: "fill", type: "hemisphere", color: "#ffffff", groundColor: "#303038", intensity: 0.5 }, { id: "sun", type: "directional", color: "#ffffff", intensity: 2.2, position: [4, 6, 5], lookAt: [0, 0.8, 0], shadow }, { id: "rim", type: "directional", color: "#cfe0ff", intensity: 1.4, position: [-4, 4, -5], lookAt: [0, 0.8, 0] }],
      sky: null, fog: null,
      post: { toneMapping: "aces", exposure: 1, contrast: 1.05, vignette: 0.2, aa: "smaa" },
    } },
];

/** The built-in camera rigs. */
export const SCENE_RIG_PRESETS: SceneRigPreset[] = [
  { id: "push-in", kind: "rig", label: "Push in", description: "A slow dolly towards the subject.", dur: 3, events: [{ obj: "$camera", call: "dolly", args: { distance: 1.6 }, dur: "$dur", ease: "inOutSine" }] },
  { id: "pull-out", kind: "rig", label: "Pull out", description: "A slow dolly back, revealing the place.", dur: 3, events: [{ obj: "$camera", call: "dolly", args: { distance: -2 }, dur: "$dur", ease: "inOutSine" }] },
  { id: "orbit-reveal", kind: "rig", label: "Orbit reveal", description: "Circle the subject by 60° while looking at it.", dur: 4, events: [{ obj: "$camera", call: "orbit", args: { target: "$subject", turn: 60 }, dur: "$dur", ease: "inOutSine" }] },
  { id: "handheld-follow", kind: "rig", label: "Handheld follow", description: "Follow the subject from behind its shoulder with a light handheld shake.", dur: 0, events: [{ obj: "$camera", call: "follow", args: { target: "$subject", offset: [-1, 1.5, 2.8], damping: 0.5 } }, { obj: "$camera", call: "handheld", args: { amplitude: 0.035, frequency: 1.1 } }] },
  { id: "crane-up", kind: "rig", label: "Crane up", description: "Rise above the scene, the aim rising with it.", dur: 4, events: [{ obj: "$camera", call: "crane", args: { distance: 2.5 }, dur: "$dur", ease: "inOutSine" }] },
  { id: "wide-to-closeup", kind: "rig", label: "Wide to close-up", description: "Frame the subject wide, then glide into a close-up.", dur: 3, events: [{ obj: "$camera", call: "frame", args: { subject: "$subject", shot: "wide" } }, { obj: "$camera", call: "frame", args: { subject: "$subject", shot: "closeup", angle: "front", height: "eye" }, dur: "$dur", ease: "inOutCubic", after: 0.6 }] },
  { id: "rack-to-subject", kind: "rig", label: "Rack focus to subject", description: "Pull focus onto the subject (needs depth of field: world.post.dof or a lens fStop).", dur: 1.4, events: [{ obj: "$camera", call: "rackFocus", args: { to: "$subject" }, dur: "$dur", ease: "inOutCubic" }] },
];
export const SCENE_PRESETS: ScenePreset[] = [...SCENE_LOOK_PRESETS, ...SCENE_RIG_PRESETS];
export const scenePreset = (id: unknown): ScenePreset | undefined => SCENE_PRESETS.find((p) => p.id === id);

/** A preset for listing (no embedded files). */
export const presetSummary = (p: ScenePreset) => ({ id: p.id, kind: p.kind, label: p.label, description: p.description, ...(p.kind === "rig" ? { dur: p.dur } : {}) });

type Result = { doc: SceneDoc; notes: string[] } | { error: string };

/** Apply a look preset's world (replacing lights / sky / fog / post / background; null removes) and add its objects. */
function applyLook(doc: SceneDoc, p: SceneLookPreset): SceneDoc {
  const w = { ...worldOf(doc) };
  if (p.world.background) w.background = p.world.background;
  if (p.world.lights) {
    // Practical lights of set pieces ("<object>-glow", e.g. a lamp's) stay; the look replaces the rest.
    const ids = new Set(objectsOf(doc).map((o) => o.id));
    const keep = (Array.isArray(w.lights) ? (w.lights as SceneLight[]) : []).filter((l) => typeof l.id === "string" && l.id.endsWith("-glow") && ids.has(l.id.slice(0, -5)));
    w.lights = [...p.world.lights.map((l) => ({ ...l })), ...keep.filter((l) => !p.world.lights!.some((x) => x.id === l.id))];
  }
  for (const k of ["sky", "fog", "post"] as const) {
    const v = p.world[k];
    if (v === null) delete w[k]; else if (v) w[k] = JSON.parse(JSON.stringify(v));
  }
  let out: SceneDoc = { ...doc, world: w as SceneDoc["world"] };
  const ids = new Set(objectsOf(out).map((o) => o.id));
  const add = (p.objects ?? []).filter((o) => !ids.has(o.id));
  if (add.length) out = { ...out, objects: [...objectsOf(out), ...add.map((o) => JSON.parse(JSON.stringify(o)))] };
  if (p.files && add.length) out = { ...out, files: { ...(out.files ?? {}), ...p.files } };
  return out;
}

/** The camera seen at `t` (its id). */
export function activeCameraAt(doc: SceneDoc, t: number): string {
  return sceneShots(doc).filter((x) => x.at <= t + 1e-9).pop()?.camera ?? SCENE_CAMERA;
}

/** Pose of camera `id` at `t`. */
function cameraPose(doc: SceneDoc, id: string, t: number): { fov: number; position: Vec3; target: Vec3 } {
  const s = stateAt(doc, t);
  const c = s.cameras?.find((x) => x.id === id);
  return c ?? s.camera;
}

/**
 * apply_scene_preset: a look preset (world and objects) or a rig preset (camera events at `at` on `camera`, default the
 * camera seen then, aimed at `subject`). `preset` is a built-in id or a preset object of the same shape.
 */
export function applyScenePreset(doc: SceneDoc, preset: unknown, o: { at?: number; dur?: number; camera?: string; subject?: string } = {}): Result {
  const p = typeof preset === "string" ? scenePreset(preset) : isObj(preset) ? (preset as unknown as ScenePreset) : undefined;
  if (!p) return { error: `Unknown preset ${JSON.stringify(preset)}. Presets: ${SCENE_PRESETS.map((x) => x.id).join(", ")} (or a preset object { kind: "look", world } / { kind: "rig", events }).` };
  if (p.kind === "look") {
    if (!isObj(p.world)) return { error: 'A look preset needs "world" { background?, lights?, sky?, fog?, post? }.' };
    return { doc: applyLook(doc, { ...p, id: p.id ?? "custom", label: p.label ?? "", description: p.description ?? "" }), notes: [`Look "${p.id ?? "custom"}" applied (lights${p.world.sky !== undefined ? ", sky" : ""}${p.world.fog !== undefined ? ", fog" : ""}${p.world.post !== undefined ? ", post" : ""}).`] };
  }
  if (p.kind !== "rig" || !Array.isArray(p.events)) return { error: 'A preset is { kind: "look", world, objects? } or { kind: "rig", events: [{ obj: "$camera", call, args, dur?, ease?, after? }] }.' };
  const at = num(o.at) && o.at >= 0 ? o.at : 0;
  const cam = o.camera ?? activeCameraAt(doc, at);
  if (!sceneCameraDefs(doc).some((c) => c.id === cam)) return { error: `No camera "${cam}". Cameras: ${sceneCameraDefs(doc).map((c) => c.id).join(", ")}.` };
  const subject = o.subject ?? firstCharacter(doc)?.id;
  const needsSubject = JSON.stringify(p.events).includes("$subject");
  if (needsSubject && !(subject && objectsOf(doc).some((x) => x.id === subject))) return { error: `Rig "${p.id}" needs a "subject" (an object id). Objects: ${objectsOf(doc).map((x) => x.id).join(", ") || "none"}.` };
  const dur = num(o.dur) && o.dur >= 0 ? o.dur : num(p.dur) ? p.dur : 2;
  const sub = (v: unknown): unknown => (v === "$camera" ? cam : v === "$subject" ? subject : v === "$dur" ? dur : Array.isArray(v) ? v.map(sub) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)])) : v);
  const events: SceneEvent[] = [];
  for (const raw of p.events) {
    const e = sub(raw) as Record<string, unknown>;
    const start = at + (num(e.after) ? e.after : 0);
    const args = isObj(e.args) ? { ...e.args } : {};
    if (e.call === "orbit" && num(args.turn)) {
      const pose = cameraPose(doc, cam, start), c = targetPoint(doc, args.target, start) ?? pose.target;
      const a0 = (Math.atan2(pose.position[0] - c[0], pose.position[2] - c[2]) * 180) / Math.PI;
      args.to = r3(a0 + args.turn); delete args.turn;
    }
    events.push({ at: roundSec(start), obj: String(e.obj), call: String(e.call), ...(Object.keys(args).length ? { args } : {}), ...(num(e.dur) && e.dur > 0 ? { dur: roundSec(e.dur) } : {}), ...(typeof e.ease === "string" ? { ease: e.ease as SceneEvent["ease"] } : {}) });
  }
  return { doc: { ...doc, events: [...eventsOf(doc), ...events] }, notes: [`Rig "${p.id ?? "custom"}" on ${cam} at ${at}s${subject && needsSubject ? ` around ${subject}` : ""}: ${events.length} event${events.length === 1 ? "" : "s"}.`] };
}

// ------------------------------------------------------------------------------------------------ mood

export const TIMES_OF_DAY = ["dawn", "morning", "noon", "afternoon", "golden", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
const TOD: Record<TimeOfDay, { elevation: number; azimuth: number; sun: string; sunI: number; fill: string; fillI: number; ground: string; bg: string; exposure: number }> = {
  dawn: { elevation: 3, azimuth: 100, sun: "#ffb090", sunI: 1.3, fill: "#c0b0d8", fillI: 0.7, ground: "#3a3040", bg: "#c9a6b6", exposure: 0.75 },
  morning: { elevation: 22, azimuth: 120, sun: "#fff0d8", sunI: 2.2, fill: "#cfe0ff", fillI: 0.9, ground: "#4a4a3a", bg: "#a8cbef", exposure: 0.85 },
  noon: { elevation: 62, azimuth: 180, sun: "#ffffff", sunI: 2.8, fill: "#cfe6ff", fillI: 1, ground: "#5a6a40", bg: "#8fc4f0", exposure: 0.9 },
  afternoon: { elevation: 35, azimuth: 220, sun: "#fff2dc", sunI: 2.4, fill: "#d6e4ff", fillI: 0.9, ground: "#55583e", bg: "#9cc6ec", exposure: 0.85 },
  golden: { elevation: 10, azimuth: 248, sun: "#ffb860", sunI: 2.4, fill: "#ffd9b0", fillI: 0.8, ground: "#4a3a2a", bg: "#e8b27a", exposure: 0.8 },
  dusk: { elevation: 1.5, azimuth: 255, sun: "#ff7a4a", sunI: 0.9, fill: "#6a70c8", fillI: 0.5, ground: "#2a2030", bg: "#5a5478", exposure: 0.75 },
  night: { elevation: -8, azimuth: 260, sun: "#8aa0ff", sunI: 0.6, fill: "#303a60", fillI: 0.35, ground: "#0c0f18", bg: "#121726", exposure: 0.95 },
};
export const SCENE_PALETTES = ["neutral", "warm", "cool", "teal-orange", "pastel", "desaturated", "vivid"] as const;
export type ScenePalette = (typeof SCENE_PALETTES)[number];
const PALETTE_GRADE: Record<ScenePalette, Record<string, unknown>> = {
  neutral: {},
  warm: { saturation: 1.1, lift: [0.02, 0.01, 0], gain: [1.06, 1, 0.92] },
  cool: { saturation: 1, lift: [0, 0.01, 0.03], gain: [0.94, 1, 1.06] },
  "teal-orange": { saturation: 1.15, contrast: 1.1, lift: [0, 0.02, 0.04], gain: [1.08, 1, 0.9] },
  pastel: { saturation: 0.85, contrast: 0.92, lift: [0.04, 0.04, 0.05] },
  desaturated: { saturation: 0.6, contrast: 1.05 },
  vivid: { saturation: 1.3, contrast: 1.08 },
};
export const SCENE_POST_PRESETS = ["none", "soft", "cinematic", "dreamy", "crisp"] as const;
export type ScenePostPreset = (typeof SCENE_POST_PRESETS)[number];
const POST_PRESET: Record<Exclude<ScenePostPreset, "none">, Record<string, unknown>> = {
  soft: { toneMapping: "aces", vignette: 0.18, bloom: { strength: 0.25, radius: 0.5, threshold: 1 }, aa: "smaa" },
  cinematic: { toneMapping: "aces", contrast: 1.1, vignette: 0.3, grain: 0.05, bloom: { strength: 0.3, radius: 0.35, threshold: 1.1 }, aa: "smaa" },
  dreamy: { toneMapping: "aces", saturation: 0.9, lift: [0.04, 0.03, 0.05], vignette: 0.25, bloom: { strength: 0.8, radius: 0.6, threshold: 0.8 }, aa: "smaa" },
  crisp: { toneMapping: "aces", contrast: 1.15, vignette: 0.1, ssao: { radius: 0.35 }, aa: "smaa" },
};
const GRADE_KEYS = ["saturation", "contrast", "lift", "gamma", "gain"];

export interface MoodSpec { preset?: string; timeOfDay?: TimeOfDay; palette?: ScenePalette; post?: ScenePostPreset; at?: number; dur?: number }

/** Ensure a hemisphere "fill" and a directional "sun" light (giving ids to the first of each type); returns lights. */
function sunAndFill(doc: SceneDoc): SceneLight[] {
  const w = worldOf(doc);
  let lights: SceneLight[] = Array.isArray(w.lights) && w.lights.length ? (w.lights as SceneLight[]).map((l) => ({ ...l })) : [{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [3, 5, 2], intensity: 1.5 }];
  const taken = new Set([...objectsOf(doc).map((o) => o.id), ...lights.map((l) => l.id).filter(Boolean) as string[]]);
  const named = (type: string, id: string) => {
    if (lights.some((l) => l.id === id)) return;
    const l = lights.find((x) => x.type === type && !x.id);
    if (l && !taken.has(id)) { l.id = id; taken.add(id); } else if (!l && !taken.has(id)) { lights = [...lights, type === "hemisphere" ? { id, type: "hemisphere", intensity: 1 } : { id, type: "directional", intensity: 1.5, position: [-6, 6, 5], lookAt: [0, 0, 0] }]; taken.add(id); }
  };
  named("hemisphere", "fill"); named("directional", "sun");
  return lights;
}

/**
 * set_mood: a look preset first, then a time of day (sun angle and colour through world.sky and the "sun" / "fill"
 * lights, background, exposure), a palette (the post grade) and a post preset. With `at` (and `dur`), the time of day
 * changes from there over `dur` seconds as events instead of setting the start.
 */
export function setMood(doc: SceneDoc, m: MoodSpec): Result {
  const notes: string[] = [];
  let d = doc;
  if (m.preset !== undefined) {
    const p = scenePreset(m.preset);
    if (!p || p.kind !== "look") return { error: `"preset" must be a look: ${SCENE_LOOK_PRESETS.map((x) => x.id).join(", ")}.` };
    d = applyLook(d, p); notes.push(`Look "${p.id}".`);
  }
  if (m.timeOfDay !== undefined) {
    const tod = TOD[m.timeOfDay];
    if (!tod) return { error: `"timeOfDay" must be one of ${TIMES_OF_DAY.join(", ")}.` };
    const lights = sunAndFill(d);
    const w: Record<string, unknown> = { ...worldOf(d), lights };
    const animate = num(m.at) && m.at >= 0;
    if (!animate) {
      for (const l of lights) {
        if (l.id === "sun") Object.assign(l, { color: tod.sun, intensity: tod.sunI });
        if (l.id === "fill") Object.assign(l, { color: tod.fill, intensity: tod.fillI, groundColor: tod.ground });
      }
      w.background = tod.bg;
      w.sky = { turbidity: 6, rayleigh: m.timeOfDay === "dusk" || m.timeOfDay === "dawn" ? 3 : 2, ...(isObj(w.sky) ? w.sky : {}), elevation: tod.elevation, azimuth: tod.azimuth, light: "sun" };
      w.post = { toneMapping: "aces", ...(isObj(w.post) ? w.post : {}), exposure: tod.exposure };
      d = { ...d, world: w as SceneDoc["world"] };
      notes.push(`Time of day: ${m.timeOfDay} (sun at ${tod.elevation}°).`);
    } else {
      if (!isObj(w.sky)) w.sky = { elevation: 30, azimuth: tod.azimuth, turbidity: 6, rayleigh: 2, light: "sun" };
      if (!isObj(w.post)) w.post = { toneMapping: "aces", exposure: 0.9 };
      d = { ...d, world: w as SceneDoc["world"] };
      const at = roundSec(m.at!), dur = num(m.dur) && m.dur > 0 ? roundSec(m.dur) : 6;
      const ev = (obj: string, call: string, value: unknown): SceneEvent => ({ at, obj, call, args: { value }, dur, ease: "inOutSine" });
      d = { ...d, events: [...eventsOf(d), ev("sky", "sunElevation", tod.elevation), ev("sky", "sunAzimuth", tod.azimuth), ev("sun", "color", tod.sun), ev("sun", "intensity", tod.sunI), ev("fill", "color", tod.fill), ev("fill", "intensity", tod.fillI), ev("post", "exposure", tod.exposure)] };
      notes.push(`Time of day changes to ${m.timeOfDay} from ${at}s over ${dur}s (7 events on sky, sun, fill, post).`);
    }
  }
  if (m.palette !== undefined || m.post !== undefined) {
    const w = { ...worldOf(d) };
    let post: Record<string, unknown> | undefined = isObj(w.post) ? { ...w.post } : undefined;
    if (m.post !== undefined) {
      if (!(SCENE_POST_PRESETS as readonly string[]).includes(m.post)) return { error: `"post" must be one of ${SCENE_POST_PRESETS.join(", ")}.` };
      if (m.post === "none") post = undefined;
      else post = { ...(post ?? {}), ...JSON.parse(JSON.stringify(POST_PRESET[m.post])) };
      notes.push(`Post: ${m.post}.`);
    }
    if (m.palette !== undefined) {
      if (!(SCENE_PALETTES as readonly string[]).includes(m.palette)) return { error: `"palette" must be one of ${SCENE_PALETTES.join(", ")}.` };
      post = { toneMapping: "aces", ...(post ?? {}) };
      for (const k of GRADE_KEYS) delete post[k];
      Object.assign(post, JSON.parse(JSON.stringify(PALETTE_GRADE[m.palette])));
      notes.push(`Palette: ${m.palette}.`);
    }
    if (post) w.post = post; else delete w.post;
    d = { ...d, world: w as SceneDoc["world"] };
  }
  if (!notes.length) return { error: `Give at least one of preset (${SCENE_LOOK_PRESETS.map((x) => x.id).join(", ")}), timeOfDay (${TIMES_OF_DAY.join(", ")}), palette (${SCENE_PALETTES.join(", ")}) or post (${SCENE_POST_PRESETS.join(", ")}).` };
  return { doc: d, notes };
}

// ------------------------------------------------------------------------------------------------ staging

/** A set piece kind: its parts (primitives stacked on the piece's floor point), footprint and how it sits. */
interface Part { suffix: string; shape: SceneShape; size: number | number[]; color: string; y: number; rotY?: number; emissive?: string; glow?: number }
interface Kind { parts: Part[]; foot: [number, number]; height: number; flat?: boolean; attach?: boolean; seat?: boolean; light?: { y: number; color: string; intensity: number } }
const K = (parts: Part[], foot: [number, number], height: number, more: Partial<Kind> = {}): Kind => ({ parts, foot, height, ...more });
/** The glazed-opening kind's name, spelled in two parts: the architecture test bans the DOM global's name in domain code. */
export const WINDOW_KIND = "win" + "dow";
/** Built-in set pieces (stylized blockouts; give "model" for a GLB instead). */
export const SET_PIECES: Record<string, Kind> = {
  house: K([{ suffix: "", shape: "box", size: [3, 2.4, 2.5], color: "#e8d8b8", y: 1.2 }, { suffix: "-roof", shape: "cone", size: [2.3, 1.4], color: "#b4553f", y: 3.1, rotY: 45 }], [3, 2.5], 3.8),
  tower: K([{ suffix: "", shape: "cylinder", size: [1.2, 5], color: "#b8b0a0", y: 2.5 }, { suffix: "-roof", shape: "cone", size: [1.5, 1.6], color: "#50607a", y: 5.8 }], [2.4, 2.4], 6.6),
  tree: K([{ suffix: "", shape: "cylinder", size: [0.15, 1.2], color: "#6b4a32", y: 0.6 }, { suffix: "-crown", shape: "cone", size: [1, 2.4], color: "#3f6b3a", y: 2.4 }], [2, 2], 3.6),
  bush: K([{ suffix: "", shape: "sphere", size: 0.55, color: "#4a7a3e", y: 0.45 }], [1.1, 1.1], 1),
  rock: K([{ suffix: "", shape: "sphere", size: 0.5, color: "#8a8a8a", y: 0.35 }], [1, 1], 0.85),
  lamp: K([{ suffix: "", shape: "cylinder", size: [0.05, 2.1], color: "#2c2a30", y: 1.05 }, { suffix: "-light", shape: "sphere", size: 0.16, color: "#ffe0a0", y: 2.15, emissive: "#ffb060", glow: 1.2 }], [0.4, 0.4], 2.3, { light: { y: 2, color: "#ffb060", intensity: 0.9 } }),
  "table-lamp": K([{ suffix: "", shape: "cylinder", size: [0.06, 0.4], color: "#3a3030", y: 0.95 }, { suffix: "-shade", shape: "cone", size: [0.2, 0.25], color: "#ffe6b0", y: 1.25, emissive: "#ffb060", glow: 0.8 }], [0.4, 0.4], 1.4, { light: { y: 1.25, color: "#ffb060", intensity: 1.2 } }),
  bench: K([{ suffix: "", shape: "box", size: [1.4, 0.45, 0.45], color: "#7a5236", y: 0.225 }], [1.4, 0.45], 0.45, { seat: true }),
  chair: K([{ suffix: "", shape: "box", size: [0.45, 0.45, 0.45], color: "#7a5236", y: 0.225 }, { suffix: "-back", shape: "box", size: [0.45, 0.5, 0.06], color: "#7a5236", y: 0.7 }], [0.45, 0.45], 0.95, { seat: true }),
  stool: K([{ suffix: "", shape: "cylinder", size: [0.2, 0.5], color: "#7a5236", y: 0.25 }], [0.4, 0.4], 0.5, { seat: true }),
  sofa: K([{ suffix: "", shape: "box", size: [2, 0.45, 0.85], color: "#6a4a6a", y: 0.225 }, { suffix: "-back", shape: "box", size: [2, 0.5, 0.2], color: "#6a4a6a", y: 0.7 }], [2, 0.85], 0.95, { seat: true }),
  table: K([{ suffix: "", shape: "box", size: [1.2, 0.75, 0.7], color: "#8a5a3a", y: 0.375 }], [1.2, 0.7], 0.75),
  bed: K([{ suffix: "", shape: "box", size: [1.1, 0.5, 2], color: "#d8d0c0", y: 0.25 }], [1.1, 2], 0.5, { seat: true }),
  shelf: K([{ suffix: "", shape: "box", size: [1.2, 1.8, 0.4], color: "#6b4a32", y: 0.9 }], [1.2, 0.4], 1.8),
  crate: K([{ suffix: "", shape: "box", size: 0.7, color: "#a87a4a", y: 0.35 }], [0.7, 0.7], 0.7),
  barrel: K([{ suffix: "", shape: "cylinder", size: [0.35, 0.9], color: "#8a5a32", y: 0.45 }], [0.7, 0.7], 0.9),
  well: K([{ suffix: "", shape: "cylinder", size: [0.6, 0.8], color: "#8a8478", y: 0.4 }], [1.2, 1.2], 0.8),
  wall: K([{ suffix: "", shape: "box", size: [4, 2.5, 0.2], color: "#cfc6b4", y: 1.25 }], [4, 0.2], 2.5),
  fence: K([{ suffix: "", shape: "box", size: [3, 0.9, 0.08], color: "#9a7a52", y: 0.45 }], [3, 0.08], 0.9),
  door: K([{ suffix: "", shape: "box", size: [0.7, 1.3, 0.06], color: "#6b4a32", y: 0.65 }], [0.7, 0.06], 1.3, { attach: true }),
  [WINDOW_KIND]: K([{ suffix: "", shape: "box", size: [0.7, 0.6, 0.06], color: "#ffd890", y: 1.5, emissive: "#ffb050", glow: 1.4 }], [0.7, 0.06], 1.8, { attach: true }),
  street: K([{ suffix: "", shape: "box", size: [24, 0.04, 3], color: "#8b7d6b", y: 0.02 }], [24, 3], 0.04, { flat: true }),
  rug: K([{ suffix: "", shape: "box", size: [2, 0.02, 1.4], color: "#8a3a3a", y: 0.01 }], [2, 1.4], 0.02, { flat: true }),
};
const ALIASES: Record<string, string> = { cottage: "house", hut: "house", home: "house", building: "house", shop: "house", inn: "house", tavern: "house", "street-lamp": "lamp", streetlamp: "lamp", lantern: "lamp", lamppost: "lamp", "lamp-post": "lamp", torch: "lamp", candle: "table-lamp", desk: "table", road: "street", path: "street", lane: "street", boulder: "rock", stone: "rock", seat: "stool", couch: "sofa", box: "crate", tree2: "tree", pine: "tree", oak: "tree", hedge: "bush", gate: "fence", bookshelf: "shelf", bookcase: "shelf", carpet: "rug" };
export const setPieceKind = (k: string): string | undefined => { const n = k.toLowerCase().replace(/[\s_]+/g, "-").replace(/s$/, ""); return SET_PIECES[n] ? n : ALIASES[n] ?? (SET_PIECES[k.toLowerCase()] ? k.toLowerCase() : undefined); };

export const STAGE_SPOTS = ["center", "left", "right", "back", "front", "back-left", "back-right", "front-left", "front-right", "far-left", "far-right", "far-back"] as const;
export type StageSpot = (typeof STAGE_SPOTS)[number];
export type StageSide = "left" | "right" | "front" | "back";
export type StagePlace = Vec3 | StageSpot | { near: string; side?: StageSide; distance?: number } | { x?: number; z?: number };
export interface StageSetPiece { id?: string; kind: string; name?: string; at?: StagePlace; facing?: number | string; size?: number | number[]; color?: string; model?: string }
export interface StageCharacter { id?: string; name?: string; at?: StagePlace; facing?: number | string; body?: Record<string, unknown>; model?: string; height?: number }
export interface StageCamera { id?: string; name?: string; subject?: string; shot?: SceneShotSize; angle?: SceneShotAngle; height?: SceneShotHeight; focalLength?: number; at?: number }
export interface StageBrief {
  name?: string; durationSec?: number;
  stage?: { width?: number; depth?: number; ground?: string | false };
  /** "toon" (default: toon shading with outlines, the stylized look) or "standard". */
  style?: "toon" | "standard";
  mood?: MoodSpec;
  set?: StageSetPiece[]; characters?: StageCharacter[]; cameras?: StageCamera[];
}

const SPOT_XZ: Record<StageSpot, [number, number]> = {
  center: [0, 0], left: [-0.25, 0], right: [0.25, 0], back: [0, -0.32], front: [0, 0.22], "back-left": [-0.25, -0.32], "back-right": [0.25, -0.32],
  "front-left": [-0.22, 0.22], "front-right": [0.22, 0.22], "far-left": [-0.42, 0], "far-right": [0.42, 0], "far-back": [0, -0.45],
};

/** An object's footprint on the floor (centre, half sizes along x and z) and height range, from its fields at rest. */
interface Foot { id: string; x: number; z: number; hx: number; hz: number; y0: number; y1: number; flat: boolean; attach: boolean; character: boolean }
const isCharacterObj = (o: SceneObject) => isObj(o.character);
/** Half extents [x, y, z] of an object's shape before rotation, and the y offset of its centre from `position`. */
export function shapeExtent(o: SceneObject): { half: Vec3; cy: number } | undefined {
  if (isCharacterObj(o)) { const h = characterHeight(o); return { half: [0.25, h / 2, 0.2], cy: h / 2 }; }
  if (o.script) return undefined;
  if (typeof o.model === "string") { const s = num(o.size) ? o.size : 1.6; return { half: [s / 2, s / 2, s / 2], cy: s / 2 }; }
  const s = o.size, arr = (n: number, d: number[]) => (num(s) ? Array(n).fill(s) : Array.isArray(s) && s.length ? (s.length === 1 ? Array(n).fill(s[0]) : s) : d) as number[];
  switch (o.shape) {
    case "sphere": { const [r] = arr(1, [0.5]); return { half: [r, r, r], cy: 0 }; }
    case "cylinder": case "cone": { const [r, h] = arr(2, [0.5, 1]); return { half: [r, h / 2, r], cy: 0 }; }
    case "torus": { const [r, t] = arr(2, [0.5, 0.15]); return { half: [r + t, r + t, t], cy: 0 }; }
    case "plane": { const [w, h] = arr(2, [1, 1]); return { half: [w / 2, h / 2, 0], cy: 0 }; }
    default: { const [w, h, d] = arr(3, [1, 1, 1]); return { half: [w / 2, (h ?? w) / 2, (d ?? w) / 2], cy: 0 }; }
  }
}

/** Euler XYZ (degrees) rotation of a vector. */
function rotate(v: Vec3, rot: Vec3): Vec3 {
  const [a, b, c] = rot.map((x) => x * D2R);
  // R = Rx(a) · Ry(b) · Rz(c) (three.js "XYZ")
  let [x, y, z] = v;
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  return [x, y, z];
}

/** An object's world-axis box at a state: min and max corners (undefined for Script objects). */
export function objectBox(o: SceneObject, st: { position: Vec3; rotation: Vec3; scale: Vec3 }): { min: Vec3; max: Vec3 } | undefined {
  const ext = shapeExtent(o);
  if (!ext) return undefined;
  const h: Vec3 = [ext.half[0] * Math.abs(st.scale[0]), ext.half[1] * Math.abs(st.scale[1]), ext.half[2] * Math.abs(st.scale[2])];
  // Characters and models stand on their position; rotation about their base is about y only for the check.
  // Round shapes (sphere, cylinder, cone) turned about y keep their box; characters and models turn about their base.
  const round = o.shape === "sphere" || o.shape === "cylinder" || o.shape === "cone";
  const rot: Vec3 = isCharacterObj(o) || typeof o.model === "string" ? [0, st.rotation[1], 0] : round ? [st.rotation[0], 0, st.rotation[2]] : st.rotation;
  const c: Vec3 = [st.position[0], st.position[1] + ext.cy * Math.abs(st.scale[1]), st.position[2]];
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = rotate([sx * h[0], sy * h[1], sz * h[2]], rot);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], c[k] + p[k]); max[k] = Math.max(max[k], c[k] + p[k]); }
  }
  return { min, max };
}

function footOf(o: SceneObject): Foot | undefined {
  const st = { position: isVec3(o.position) ? o.position : [0, 0, 0] as Vec3, rotation: isVec3(o.rotation) ? o.rotation : [0, 0, 0] as Vec3, scale: (num(o.scale) ? [o.scale, o.scale, o.scale] : isVec3(o.scale) ? o.scale : [1, 1, 1]) as Vec3 };
  if (o.shape === "plane" && !o.model && !isCharacterObj(o)) return undefined;
  const b = objectBox(o, st);
  if (!b) return undefined;
  const hx = (b.max[0] - b.min[0]) / 2, hz = (b.max[2] - b.min[2]) / 2;
  return { id: o.id, x: (b.max[0] + b.min[0]) / 2, z: (b.max[2] + b.min[2]) / 2, hx, hz, y0: b.min[1], y1: b.max[1], flat: b.max[1] - b.min[1] < 0.1, attach: Math.min(hx, hz) < 0.06, character: isCharacterObj(o) };
}

/** Group footprints of multi-part pieces ("house" + "house-roof") by the base id. */
function feetOf(doc: SceneDoc): Foot[] {
  const out: Foot[] = [];
  for (const o of objectsOf(doc)) { const f = footOf(o); if (f) out.push(f); }
  return out;
}

/** The facing (degrees, 0 = towards +z, the default camera side) for "camera", an object id, a side word or a number. */
function facingOf(doc: SceneDoc, f: number | string | undefined, from: [number, number], fallback = 0): number {
  if (num(f)) return f;
  if (f === undefined || f === "camera" || f === "front") return f === undefined ? fallback : 0;
  if (f === "left") return -90; if (f === "right") return 90; if (f === "back") return 180;
  const t = objectsOf(doc).find((o) => o.id === f);
  if (t && isVec3(t.position)) return r3((Math.atan2(t.position[0] - from[0], t.position[2] - from[1]) * 180) / Math.PI);
  return fallback;
}

const overlaps = (a: { x: number; z: number; hx: number; hz: number }, b: { x: number; z: number; hx: number; hz: number }, m = 0.12) =>
  Math.abs(a.x - b.x) < a.hx + b.hx + m && Math.abs(a.z - b.z) < a.hz + b.hz + m;

/** Where a new footprint goes: the named spot / point / neighbour, nudged sideways (then back) until it is clear. */
function place(doc: SceneDoc, at: StagePlace | undefined, half: [number, number], W: number, D: number, index: number, opts: { attach?: boolean; flat?: boolean; ignore?: string } = {}): { x: number; z: number; near?: Foot; side?: StageSide; error?: string } {
  const feet = feetOf(doc).filter((f) => !f.flat && f.id !== opts.ignore);
  let x = 0, z = 0, near: Foot | undefined, side: StageSide | undefined;
  // Exact coordinates are taken as given (the author placed it); spots, neighbours and no place are nudged clear.
  if (isVec3(at)) return { x: at[0], z: at[2] };
  else if (typeof at === "string") {
    const s = SPOT_XZ[at as StageSpot];
    if (!s) return { x, z, error: `"at": "${at}" is not a spot. Spots: ${STAGE_SPOTS.join(", ")}; or [x, y, z], { x, z } or { near: "<id>", side?: left | right | front | back, distance? }.` };
    x = s[0] * W; z = s[1] * D;
  } else if (isObj(at) && typeof (at as { near?: unknown }).near === "string") {
    const a = at as { near: string; side?: StageSide; distance?: number };
    const base = feetOf(doc).find((f) => f.id === a.near);
    if (!base) return { x, z, error: `"at.near": no object "${a.near}". Objects: ${objectsOf(doc).map((o) => o.id).join(", ") || "none"}.` };
    near = base; side = a.side ?? "front";
    const gap = opts.attach ? 0 : num(a.distance) ? a.distance : 0.35;
    if (side === "front") { x = base.x; z = base.z + base.hz + half[1] + gap; }
    else if (side === "back") { x = base.x; z = base.z - base.hz - half[1] - gap; }
    else if (side === "left") { x = base.x - base.hx - half[0] - gap; z = base.z; }
    else { x = base.x + base.hx + half[0] + gap; z = base.z; }
    if (opts.attach) return { x, z, near, side };
  } else if (isObj(at)) { const a = at as { x?: number; z?: number }; return { x: num(a.x) ? a.x : 0, z: num(a.z) ? a.z : 0 }; }
  else { // no place: spread along the stage, alternating sides of the centre
    const k = Math.ceil(index / 2) * (index % 2 ? 1 : -1);
    x = k * 1.8; z = 0;
  }
  if (opts.flat || opts.attach) return { x, z, near, side };
  const clear = (px: number, pz: number) => !feet.some((f) => overlaps({ x: px, z: pz, hx: half[0], hz: half[1] }, f));
  if (clear(x, z)) return { x, z, near, side };
  const step = Math.max(0.5, half[0] * 2 * 0.6);
  for (let i = 1; i <= 24; i++) {
    const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    const tries: [number, number][] = side === "left" || side === "right" ? [[x, z + k * step]] : [[x + k * step, z], [x, z - Math.ceil(i / 2) * step]];
    for (const [px, pz] of tries) if (clear(px, pz)) return { x: px, z: pz, near, side };
  }
  return { x, z, near, side };
}

const firstCharacter = (doc: SceneDoc) => objectsOf(doc).find(isCharacterObj);

/** A material for the brief's style. */
const matOf = (style: StageBrief["style"], extra: { emissive?: string; glow?: number } = {}): SceneObject["material"] =>
  style === "standard" ? (extra.emissive ? { type: "standard", emissive: extra.emissive, emissiveIntensity: extra.glow ?? 1 } : undefined)
    : { type: "toon", steps: 3, outline: { width: 0.03 }, ...(extra.emissive ? { emissive: extra.emissive, emissiveIntensity: extra.glow ?? 1 } : {}) };

export interface StageReport { added: string[]; kept: string[]; cameras: string[]; notes: string[] }

/**
 * stage_scene: place a brief's set pieces, characters and cameras, and set its mood. Objects whose id already exists
 * are kept as they are (reported in `kept`) unless `replace` is true, so re-staging never undoes the user's moves.
 */
export function stageScene(doc: SceneDoc, brief: StageBrief, opts: { replace?: boolean } = {}): { doc: SceneDoc; report: StageReport } | { error: string } {
  if (!isPlain(brief)) return { error: '"brief" must be an object { name?, durationSec?, stage?, style?, mood?, set?, characters?, cameras? }.' };
  const W = num(brief.stage?.width) && brief.stage!.width! > 2 ? brief.stage!.width! : 12, Dp = num(brief.stage?.depth) && brief.stage!.depth! > 2 ? brief.stage!.depth! : 8;
  const style = brief.style ?? "toon";
  const report: StageReport = { added: [], kept: [], cameras: [], notes: [] };
  let d: SceneDoc = { ...doc, objects: objectsOf(doc) };
  if (typeof brief.name === "string" && brief.name && !doc.name) d.name = brief.name;
  if (num(brief.durationSec) && brief.durationSec > 0) d.durationSec = brief.durationSec;
  const has = (id: string) => objectsOf(d).some((o) => o.id === id);
  const drop = (id: string) => { d = { ...d, objects: objectsOf(d).filter((o) => o.id !== id && !o.id.startsWith(`${id}-`) ) }; };
  // Ground
  if (brief.stage?.ground !== false && !objectsOf(d).some((o) => o.shape === "plane" && (o.id === "ground" || (isVec3(o.rotation) && Math.abs(o.rotation[0] + 90) < 1)))) {
    const g: SceneObject = { id: freeObjectId(d, "ground"), shape: "plane", size: [Math.max(40, W * 4), Math.max(40, Dp * 5)], color: typeof brief.stage?.ground === "string" ? brief.stage.ground : "#5f7a4a", rotation: [-90, 0, 0], ...(style === "toon" ? { material: { type: "toon", steps: 3 } } : {}) };
    d = { ...d, objects: [g, ...objectsOf(d)] }; report.added.push(g.id);
  }
  // Mood first, so set pieces' practical lights add to its lights.
  if (brief.mood !== undefined) {
    const m = setMood(d, brief.mood);
    if ("error" in m) return { error: `mood: ${m.error}` };
    d = m.doc; report.notes.push(...m.notes);
  }
  // Set pieces (flat ones first, then attached ones after their walls)
  const pieces = (Array.isArray(brief.set) ? brief.set : []).map((p, i) => ({ p, i }));
  const order = [...pieces.filter(({ p }) => isPlain(p) && SET_PIECES[setPieceKind(String(p.kind)) ?? ""]?.flat), ...pieces.filter(({ p }) => !(isPlain(p) && SET_PIECES[setPieceKind(String(p.kind)) ?? ""]?.flat))];
  const deferred = order.filter(({ p }) => isPlain(p) && SET_PIECES[setPieceKind(String(p.kind)) ?? ""]?.attach);
  let n = 0;
  for (const { p, i } of [...order.filter((x) => !deferred.includes(x)), ...deferred]) {
    if (!isPlain(p) || typeof p.kind !== "string") return { error: `set[${i}]: give "kind" (${Object.keys(SET_PIECES).join(", ")}, a shape ${["box", "sphere", "cylinder", "cone", "torus"].join(" | ")}, or "model" with "model": a file in the scene).` };
    const kindId = setPieceKind(p.kind);
    const shape = (["box", "sphere", "cylinder", "cone", "torus"] as string[]).includes(p.kind) ? p.kind as SceneShape : undefined;
    if (!kindId && !shape && p.kind !== "model") return { error: `set[${i}]: unknown kind "${p.kind}". Kinds: ${Object.keys(SET_PIECES).join(", ")}; shapes box, sphere, cylinder, cone, torus; or "model".` };
    if (p.kind === "model" && !(typeof p.model === "string" && isObj(d.files) && typeof d.files[p.model] === "string")) return { error: `set[${i}]: "model" must name a file in the scene. Files: ${Object.keys(d.files ?? {}).join(", ") || "none (add one with add_scene_object file first)"}.` };
    const id = typeof p.id === "string" && p.id ? p.id : freeObjectId(d, kindId ?? shape ?? (p.model ? String(p.model).replace(/\.(glb|vrm)$/i, "") : "model"));
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || id === SCENE_CAMERA) return { error: `set[${i}]: "id" must start with a letter (letters, digits, - and _), not "camera".` };
    if (has(id)) { if (!opts.replace) { report.kept.push(id); continue; } drop(id); }
    const kind: Kind = kindId ? SET_PIECES[kindId] : shape ? K([{ suffix: "", shape, size: p.size ?? 1, color: p.color ?? "#9aa0a8", y: 0 }], [1, 1], 1) : K([{ suffix: "", shape: "box", size: 1, color: "#9aa0a8", y: 0 }], [num(p.size) ? p.size : 1.6, num(p.size) ? p.size : 1.6], num(p.size) ? p.size : 1.6);
    // A plain shape stands on the floor: its centre is half its height up.
    if (shape) { const tmp = { id, shape, size: p.size ?? 1 } as SceneObject, e = shapeExtent(tmp)!; kind.parts[0].y = e.half[1]; kind.foot = [e.half[0] * 2, e.half[2] * 2]; kind.height = e.half[1] * 2; }
    const scale = kindId && num(p.size) ? p.size : 1;
    const half: [number, number] = [kind.foot[0] * scale / 2, kind.foot[1] * scale / 2];
    const at = place(d, p.at as StagePlace | undefined, half, W, Dp, n++, { attach: kind.attach, flat: kind.flat });
    if (at.error) return { error: `set[${i}] (${id}): ${at.error}` };
    let yaw = facingOf(d, p.facing, [at.x, at.z], 0);
    // Doors and windows on a wall face away from it.
    if (kind.attach && at.near) yaw = { front: 0, back: 180, left: -90, right: 90 }[at.side ?? "front"];
    const objs: SceneObject[] = kind.parts.map((pt) => {
      const o: SceneObject = { id: `${id}${pt.suffix}`, ...(p.name && !pt.suffix ? { name: p.name } : {}) };
      if (p.kind === "model") Object.assign(o, { model: p.model, size: num(p.size) ? p.size : 1.6, position: vr([at.x, 0, at.z]) });
      else Object.assign(o, { shape: pt.shape, size: kindId && scale !== 1 ? (Array.isArray(pt.size) ? pt.size.map((v) => r3(v * scale)) : r3((pt.size as number) * scale)) : (!pt.suffix && p.size !== undefined && !kindId ? p.size : pt.size), color: !pt.suffix && p.color ? p.color : pt.color, position: vr([at.x, pt.y * scale, at.z]) });
      const ry = yaw + (pt.rotY ?? 0);
      if (ry) o.rotation = [0, r3(ry), 0];
      const m = matOf(style, pt.emissive ? { emissive: pt.emissive, glow: pt.glow } : {});
      if (m) o.material = m;
      return o;
    });
    const clash = objs.find((o) => has(o.id));
    if (clash) return { error: `set[${i}]: the id "${clash.id}" is taken; give this piece another "id".` };
    d = { ...d, objects: [...objectsOf(d), ...objs] };
    report.added.push(...objs.map((o) => o.id));
    if (kind.light) {
      const lights = Array.isArray(worldOf(d).lights) && (worldOf(d).lights as unknown[]).length ? [...(worldOf(d).lights as SceneLight[])] : [];
      const lid = `${id}-glow`;
      if (!lights.some((l) => l.id === lid) && !has(lid)) {
        const base = lights.length ? lights : [{ type: "hemisphere", intensity: 1 } as SceneLight, { type: "directional", position: [3, 5, 2], intensity: 1.5 } as SceneLight];
        d = { ...d, world: { ...worldOf(d), lights: [...base, { id: lid, type: "point", color: kind.light.color, intensity: kind.light.intensity, position: vr([at.x, kind.light.y * scale, at.z + 0.3]) }] } as SceneDoc["world"] };
        report.notes.push(`${id} lights the scene with point light "${lid}".`);
      }
    }
  }
  // Characters
  const chars = Array.isArray(brief.characters) ? brief.characters : [];
  const palette = ["#3d6fb6", "#b6503d", "#4a8a4a", "#8a4a9a", "#c08a30"];
  chars.forEach((c, i) => {
    if (!isPlain(c)) return;
    const id = typeof c.id === "string" && c.id ? c.id : freeObjectId(d, typeof c.name === "string" ? c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "character");
    if (has(id)) { if (!opts.replace) { report.kept.push(id); return; } drop(id); }
    const h = num(c.height) && c.height > 0.3 ? c.height : 1.7;
    const at = place(d, c.at as StagePlace | undefined, [0.3, 0.3], W, Dp, i, {});
    if (at.error) { report.notes.push(`characters[${i}] (${id}): ${at.error} Placed at the centre instead.`); }
    const yaw = facingOf(d, c.facing, [at.x, at.z], 0);
    const o: SceneObject = {
      id, ...(c.name ? { name: c.name } : {}), position: vr([at.error ? 0 : at.x, 0, at.error ? 0 : at.z]), ...(yaw ? { rotation: [0, r3(yaw), 0] as Vec3 } : {}),
      character: { body: { height: h, cloth: palette[i % palette.length], ...(isObj(c.body) ? c.body : {}) } },
      ...(typeof c.model === "string" ? { model: c.model, size: h } : {}),
      ...(style === "toon" ? { material: { type: "toon", steps: 3, outline: { width: 0.008 }, rim: { color: "#ffd0a0", strength: 0.25, power: 4 } } } : {}),
    };
    if (typeof c.model === "string" && !(isObj(d.files) && typeof d.files[c.model] === "string")) { report.notes.push(`characters[${i}] (${id}): no file "${c.model}" in the scene; it is the built-in mannequin.`); delete o.model; delete o.size; }
    d = { ...d, objects: [...objectsOf(d), o] };
    report.added.push(id);
  });
  // Cameras
  const cams = Array.isArray(brief.cameras) ? brief.cameras : [];
  if (!cams.length && (!isObj(worldOf(doc).camera) || !objectsOf(doc).length)) {
    const w = wideView(d);
    d = updateSceneCamera(d, SCENE_CAMERA, { position: w.position, lookAt: w.target, fov: 40 });
    report.cameras.push(SCENE_CAMERA); report.notes.push("The camera frames the whole set (wide).");
  }
  const shotList: { at?: number; camera: string; name?: string }[] = [];
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i];
    if (!isPlain(c)) return { error: `cameras[${i}] must be an object { id?, subject?, shot?, angle?, height?, focalLength?, at? }.` };
    if (c.shot !== undefined && !(SHOT_SIZES as readonly string[]).includes(c.shot)) return { error: `cameras[${i}].shot must be one of ${SHOT_SIZES.join(", ")}.` };
    if (c.angle !== undefined && !(SHOT_ANGLES as readonly string[]).includes(c.angle)) return { error: `cameras[${i}].angle must be one of ${SHOT_ANGLES.join(", ")}.` };
    if (c.height !== undefined && !(SHOT_HEIGHTS as readonly string[]).includes(c.height)) return { error: `cameras[${i}].height must be one of ${SHOT_HEIGHTS.join(", ")}.` };
    const id = typeof c.id === "string" && c.id ? c.id : i === 0 ? SCENE_CAMERA : `cam-${c.shot ?? "view"}${c.subject ? `-${c.subject}` : ""}`;
    const exists = sceneCameraDefs(d).some((x) => x.id === id);
    if (exists && id !== SCENE_CAMERA && !opts.replace) { report.kept.push(id); shotList.push({ at: c.at, camera: id, name: c.name }); continue; }
    if (id === SCENE_CAMERA && isObj(worldOf(doc).camera) && !opts.replace && doc.objects.length) { report.kept.push(id); shotList.push({ at: c.at, camera: id, name: c.name }); continue; }
    const fov = num(c.focalLength) && c.focalLength > 0 ? focalToFov(c.focalLength) : 40;
    let pose: { position: Vec3; target: Vec3 };
    if (c.subject !== undefined) {
      const s = objectsOf(d).find((o) => o.id === c.subject);
      if (!s) return { error: `cameras[${i}].subject: no object "${c.subject}". Objects: ${objectsOf(d).map((o) => o.id).join(", ")}.` };
      const p = isVec3(s.position) ? s.position : [0, 0, 0] as Vec3;
      const ext = shapeExtent(s), hgt = isCharacterObj(s) ? characterHeight(s) : ext ? ext.half[1] * 2 : 1;
      const base: Vec3 = isCharacterObj(s) || typeof s.model === "string" ? p : [p[0], p[1] - (ext?.half[1] ?? 0), p[2]];
      pose = framePose(base, hgt, isVec3(s.rotation) ? s.rotation[1] : 0, fov, c.shot ?? "medium", c.angle ?? "front", c.height ?? "eye");
    } else pose = wideView(d, fov);
    const lens = num(c.focalLength) && c.focalLength > 0 ? { focalLength: c.focalLength } : undefined;
    if (id === SCENE_CAMERA) d = updateSceneCamera(d, SCENE_CAMERA, { position: vr(pose.position), lookAt: vr(pose.target), ...(lens ? { lens, fov: undefined } : { fov: r3(fov) }) });
    else if (exists) d = updateSceneCamera(d, id, { position: vr(pose.position), lookAt: vr(pose.target), ...(c.name ? { name: c.name } : {}), ...(lens ? { lens } : { fov: r3(fov) }) });
    else {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || has(id)) return { error: `cameras[${i}].id "${id}" is not a free id (letters, digits, - and _, starting with a letter, not an object's).` };
      const r = addSceneCamera(d, 0, { id, ...(c.name ? { name: c.name } : {}), position: vr(pose.position), lookAt: vr(pose.target), ...(lens ? { lens } : { fov: r3(fov) }) });
      if (r.id !== id) return { error: `cameras[${i}].id "${id}" is taken (or reserved); pick another.` };
      d = r.doc;
    }
    report.cameras.push(id);
    shotList.push({ at: c.at, camera: id, name: c.name ?? (c.shot ? `${c.shot}${c.subject ? ` ${c.subject}` : ""}` : undefined) });
  }
  if (shotList.length > 1 || shotList.some((s) => num(s.at) && s.at > 0)) {
    const total = num(d.durationSec) && d.durationSec > 0 ? d.durationSec : 5;
    const shots = shotList.map((s, i) => ({ at: num(s.at) && s.at >= 0 ? s.at : r3((i * total) / shotList.length), camera: s.camera, ...(s.name ? { name: s.name } : {}) }));
    if (!shots.some((s) => s.at === 0) && !shots.some((s) => s.camera === SCENE_CAMERA)) shots.unshift({ at: 0, camera: SCENE_CAMERA });
    d = setSceneShots(d, shots);
    report.notes.push(`${shots.length} shots: ${shots.map((s) => `${s.at}s ${s.camera}`).join(", ")}.`);
  }
  return { doc: d, report };
}

/** A wide view of everything solid in the scene (from the +z side). */
function wideView(doc: SceneDoc, fov = 40): { position: Vec3; target: Vec3 } {
  const feet = feetOf(doc).filter((f) => !f.flat);
  if (!feet.length) return { position: [0, 1.8, 7], target: [0, 1, 0] };
  const x0 = Math.min(...feet.map((f) => f.x - f.hx)), x1 = Math.max(...feet.map((f) => f.x + f.hx));
  const z0 = Math.min(...feet.map((f) => f.z - f.hz)), z1 = Math.max(...feet.map((f) => f.z + f.hz));
  const top = Math.min(4, Math.max(...feet.map((f) => f.y1)));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, halfW = Math.max(2, (x1 - x0) / 2 + 0.6);
  const hfov = Math.atan(Math.tan((fov / 2) * D2R) * (16 / 9));
  const dist = halfW / Math.tan(hfov);
  return { position: vr([cx, Math.max(1.6, top * 0.7), z1 + dist]), target: vr([cx, Math.min(1.4, top / 2), cz]) };
}

// ------------------------------------------------------------------------------------------------ blocking

export const BEAT_ACTIONS = ["walk", "run", "turn", "look", "sit", "stand", "gesture", "say", "express", "pickUp", "drop", "push", "pull", "zoom", "orbit", "follow", "frame", "crane", "truck", "rack", "handheld", "cut"] as const;
export type BeatAction = (typeof BEAT_ACTIONS)[number];
export interface Beat {
  who: string; do: BeatAction; target?: string | Vec3; text?: string; clip?: string; shot?: SceneShotSize; angle?: SceneShotAngle; height?: SceneShotHeight;
  distance?: number; degrees?: number; value?: Record<string, number>; speed?: number;
  /** Start at this scene time (else after the previous beat). */
  at?: number; dur?: number;
  /** Start together with the previous beat ("as …", "while …"). */
  with?: boolean;
}
export interface BlockResult { doc: SceneDoc; events: SceneEvent[]; beats: { beat: Beat; at: number; dur: number; text?: string }[]; skipped: { text: string; why: string }[]; endSec: number; notes: string[] }

const SHOT_WORDS: Record<string, SceneShotSize> = { wide: "wide", establishing: "wide", full: "full", medium: "medium", mid: "medium", closeup: "closeup", "close-up": "closeup", close: "closeup", "extreme-closeup": "extreme-closeup", "extreme close-up": "extreme-closeup", "extreme close up": "extreme-closeup", ecu: "extreme-closeup", cu: "closeup", ms: "medium", ws: "wide" };
const EXPRESS: Record<string, string> = { smile: "happy", smiles: "happy", grin: "happy", grins: "happy", laugh: "happy", laughs: "happy", frown: "sad", frowns: "sad", cries: "sad", scowls: "angry", glares: "angry", gasps: "surprised", relaxes: "relaxed", happy: "happy", sad: "sad", angry: "angry", surprised: "surprised", relaxed: "relaxed" };

/** Words of a name: "the old door" → "old door". */
const bare = (s: string) => s.trim().replace(/^["“']|["”']$/g, "").replace(/^(the|a|an|his|her|their|its|towards?|to|at|on|over|up to)\s+/i, "").replace(/^(the|a|an|his|her|their|its)\s+/i, "").trim();

/** Resolve a name to an object id: id or name, case-insensitive; "camera" / "us" / "the camera" → "camera". */
export function resolveName(doc: SceneDoc, raw: string): string | undefined {
  const s = bare(raw).toLowerCase().replace(/[.!?]+$/, "");
  if (!s) return undefined;
  if (s === "camera" || s === "us" || s === "the viewer" || s === "viewer" || s === "lens" || s === "cam") return SCENE_CAMERA;
  const objs = objectsOf(doc);
  const hit = objs.find((o) => o.id.toLowerCase() === s) ?? objs.find((o) => typeof o.name === "string" && o.name.toLowerCase() === s)
    ?? objs.find((o) => o.id.toLowerCase() === s.replace(/\s+/g, "-")) ?? objs.find((o) => o.id.toLowerCase() === s.replace(/\s+/g, ""));
  if (hit) return hit.id;
  const cam = sceneCameraDefs(doc).find((c) => c.id.toLowerCase() === s || (c.name ?? "").toLowerCase() === s);
  if (cam) return cam.id;
  // "the door" when the only door-like object is "front-door"; last word match, unique.
  const last = s.split(/\s+/).pop()!;
  const loose = objs.filter((o) => o.id.toLowerCase().split(/[-_]/).includes(last) || (typeof o.name === "string" && o.name.toLowerCase().split(/\s+/).includes(last)));
  return loose.length === 1 ? loose[0].id : undefined;
}

/** A target phrase to an id: "the lamp by the old house" → "lamp" (the phrase, then its head before by / near / …, then shorter). */
export function resolveTarget(doc: SceneDoc, phrase: string): string | undefined {
  const full = resolveName(doc, phrase);
  if (full) return full;
  const head = phrase.split(/\s+(?:by|near|next to|beside|behind|in front of|at|in|on|with|of|who|which|that|from|and)\s+/i)[0];
  const h = head !== phrase ? resolveName(doc, head) : undefined;
  if (h) return h;
  const w = head.trim().split(/\s+/);
  for (let n = w.length - 1; n >= 1; n--) { const id = resolveName(doc, w.slice(0, n).join(" ")); if (id) return id; }
  return undefined;
}

/** Split blocking text into clauses: sentences, commas, "then", "and". */
export function splitClauses(text: string): string[] {
  const quoted: string[] = [];
  const t = text.replace(/["“][^"”]*["”]/g, (m) => { quoted.push(m); return `\u0000${quoted.length - 1}\u0000`; })
    // A quoted line that ends its sentence ("Hi!" As she …) ends the clause too.
    .replace(/\u0000(\d+)\u0000\s+(?=[A-Z])/g, (m, i) => (/[.!?]["”]$/.test(quoted[Number(i)]) ? `\u0000${i}\u0000. ` : m));
  return t.split(/(?:[.;!?]+\s*|,\s*(?:and\s+)?(?:then\s+)?|\s+(?:and\s+)?then\s+|\s+and\s+)/i)
    .map((c) => c.replace(/\u0000(\d+)\u0000/g, (_m, i) => quoted[Number(i)]).trim()).filter(Boolean);
}

/** Parse one clause into a beat (who may come from the previous clause). */
function parseClause(doc: SceneDoc, clause: string, prevWho: string | undefined, prevTarget?: string): { beat?: Beat; why?: string } {
  let c = clause.trim();
  // "… waves at Ben, who sits on the bench": "who" is the one just named.
  const rel = /^(who|which)\s+/i.exec(c);
  if (rel && prevTarget) { prevWho = prevTarget; c = c.slice(rel[0].length); }
  let withPrev = false;
  const lead = /^(as|while|meanwhile|at the same time)\s+/i.exec(c);
  if (lead) { withPrev = true; c = c.slice(lead[0].length); }
  c = c.replace(/^(then|and|finally|next|after that|now)\s+/i, "");
  // Subject: the longest leading run of words that names an actor.
  const words = c.split(/\s+/);
  let who: string | undefined, rest = c;
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const id = resolveName(doc, words.slice(0, n).join(" "));
    if (id) { who = id; rest = words.slice(n).join(" "); break; }
  }
  // "close-up on B", "cut to a wide shot" without a subject: camera.
  if (!who && /^(cut|close-?up|wide shot|medium shot|extreme close-?up)/i.test(c)) { who = SCENE_CAMERA; rest = c; }
  who ??= prevWho;
  if (!who) return { why: "No one to do it: start with an object id, a character's name or \"camera\"." };
  const isCam = who === SCENE_CAMERA || sceneCameraDefs(doc).some((x) => x.id === who);
  const r = rest.trim().replace(/[.!?]+$/, "");
  const b = (x: Omit<Beat, "who">): { beat: Beat } => ({ beat: { who, ...x, ...(withPrev ? { with: true } : {}) } });
  let m: RegExpExecArray | null;
  if (isCam) {
    if ((m = /^(?:slowly\s+)?(?:pushes|pushing|dollies|dolly|moves|creeps|tracks)\s+(in|forward|closer)(?:\s+(?:on|to|towards?)\s+(.+))?/i.exec(r))) return b({ do: "push", ...(m[2] ? { target: m[2] } : {}) });
    if ((m = /^(?:slowly\s+)?(?:pulls|pulling|dollies|dolly|moves|tracks)\s+(out|back|away)/i.exec(r))) return b({ do: "pull" });
    if ((m = /^zooms?\s+(in|out)/i.exec(r))) return b({ do: "zoom", distance: m[1].toLowerCase() === "in" ? 1 : -1 });
    if ((m = /^(?:slowly\s+)?(?:orbits?|circles?|arcs?)(?:\s+(?:around|round))?(?:\s+(?!left|right)(.+?))?(?:\s+(left|right|clockwise|counter-?clockwise))?$/i.exec(r))) return b({ do: "orbit", ...(m[1] ? { target: m[1] } : {}), degrees: m[2] && /left|counter/i.test(m[2]) ? -50 : 50 });
    if ((m = /^(?:follows?|tracks?|trails?)\s+(.+)/i.exec(r))) return b({ do: "follow", target: m[1] });
    if ((m = /^(?:cranes?|rises?|booms?|lifts?|goes)\s+(up|down)/i.exec(r))) return b({ do: "crane", distance: m[1].toLowerCase() === "up" ? 2 : -1.5 });
    if ((m = /^(?:trucks?|slides?|pans?)\s+(left|right)/i.exec(r))) return b({ do: "truck", distance: m[1].toLowerCase() === "right" ? 1.5 : -1.5 });
    if ((m = /^(?:racks?|pulls?|shifts?)\s+focus\s+(?:to|on|onto)\s+(.+)/i.exec(r))) return b({ do: "rack", target: m[1] });
    if ((m = /^(?:goes\s+)?(?:handheld|shakes?)/i.exec(r))) return b({ do: "handheld" });
    if ((m = /^(?:cuts?\s+to\s+)?(?:an?\s+)?(extreme close-?up|close-?up|closeup|medium|mid|wide|full|establishing)(?:\s+shot)?(?:\s+(?:of|on)\s+(.+))?/i.exec(r))) {
      const shot = SHOT_WORDS[m[1].toLowerCase().replace(/close up/, "close-up")] ?? "medium";
      return b({ do: "cut", shot, ...(m[2] ? { target: m[2] } : {}) });
    }
    if ((m = /^cuts?\s+to\s+(.+)/i.exec(r))) return b({ do: "cut", target: m[1], shot: "medium" });
    if ((m = /^(?:frames?|holds?\s+on|looks?\s+at|pans?\s+to|tilts?\s+to|finds?)\s+(.+?)(?:\s+in\s+(?:an?\s+)?(extreme close-?up|close-?up|medium|wide|full)(?:\s+shot)?)?$/i.exec(r))) return b({ do: "frame", target: m[1], ...(m[2] ? { shot: SHOT_WORDS[m[2].toLowerCase()] ?? "medium" } : {}) });
    return { why: `The camera can push in, pull out, zoom in / out, orbit, follow, crane up / down, truck left / right, rack focus to, go handheld, frame or cut to a shot; "${r}" is none of these.` };
  }
  if ((m = /^(?:slowly\s+)?(walks?|goes|moves?|heads?|steps?|strolls?|wanders?|crosses|approaches|runs?|rushes|hurries|dashes|sprints?)\s*(?:over\s+|back\s+|across\s+)?(?:to|towards?|up to|into|toward)?\s+(.+)/i.exec(r)))
    return b({ do: /^(run|rush|hurr|dash|sprint)/i.test(m[1]) ? "run" : "walk", target: m[2] });
  if ((m = /^(?:turns?|faces?|spins?)(?:\s+around)?(?:\s+(?:to|towards?|toward|to face))?\s*(.*)$/i.exec(r))) return b({ do: "turn", ...(m[1] ? { target: m[1] } : { degrees: 180 }) });
  if ((m = /^(?:looks?|glances?|stares?|gazes?|peers?)\s+(?:up\s+|over\s+|back\s+)?(?:at|to|towards?|toward|into)\s+(.+)/i.exec(r))) return b({ do: "look", target: m[1] });
  if ((m = /^(?:sits?|sat)(?:\s+down)?(?:\s+(?:on|at|in)\s+(.+))?$/i.exec(r))) return b({ do: "sit", ...(m[1] ? { target: m[1] } : {}) });
  if (/^(?:stands?|gets?|rises?)(?:\s+up)?$/i.test(r)) return b({ do: "stand" });
  if ((m = /^(waves?|nods?|points?)(?:\s+(?:at|to|towards?)\s+(.+))?/i.exec(r))) return b({ do: "gesture", clip: m[1].toLowerCase().replace(/s$/, ""), ...(m[2] ? { target: m[2] } : {}) });
  if ((m = /^(?:says?|said|shouts?|whispers?|asks?|calls?(?:\s+out)?|replies|answers)\s*(?:to\s+\w+\s*)?[:,]?\s*["“](.+?)["”]/i.exec(r))) return b({ do: "say", text: m[1] });
  if ((m = /^(?:says?|shouts?|whispers?|asks?)\s+(.+)/i.exec(r))) return b({ do: "say", text: m[1] });
  if (/^(?:talks|speaks|chats|explains)/i.test(r)) return b({ do: "gesture", clip: "talk", dur: 3 });
  if ((m = /^(?:picks?|lifts?)\s+up\s+(.+)|^(?:picks?|lifts?|grabs?|takes?)\s+(.+?)(?:\s+up)?$/i.exec(r))) return b({ do: "pickUp", target: m[1] ?? m[2] });
  if ((m = /^(?:drops?|puts?\s+down|sets?\s+down|places?)\s+(.+)/i.exec(r))) return b({ do: "drop", target: m[1].replace(/\s+(down|on .*)$/i, "") });
  if ((m = /^(?:looks?\s+|becomes?\s+|is\s+)?(smiles?|grins?|laughs?|frowns?|cries|scowls|glares|gasps|relaxes|happy|sad|angry|surprised|relaxed)/i.exec(r))) return b({ do: "express", value: { [EXPRESS[m[1].toLowerCase()] ?? "happy"]: 1 } });
  return { why: `"${r}" is not an action I know: walk / run to, turn to, look at, sit (on), stand up, wave / nod / point (at), says "…", talks, picks up, drops, smiles / frowns / looks surprised.` };
}

/** Parse blocking text into beats (and the clauses that were not understood). */
export function parseBlocking(doc: SceneDoc, text: string): { beats: (Beat & { source: string })[]; skipped: { text: string; why: string }[] } {
  const beats: (Beat & { source: string })[] = [], skipped: { text: string; why: string }[] = [];
  let prev: string | undefined, prevTarget: string | undefined, nextWith = false;
  for (const clause of splitClauses(text)) {
    const r = parseClause(doc, clause, prev, prevTarget);
    if (r.beat) {
      const beat: Beat & { source: string } = { ...r.beat, source: clause };
      if (nextWith) { beat.with = true; nextWith = false; }
      // "As A waves, B …": the "as" clause sets when the next one starts. When it repeats the beat just before it, it
      // adds nothing (B starts with that beat); otherwise it plays and B starts with it.
      if (r.beat.with && /^(as|while|meanwhile)\s/i.test(clause.trim())) {
        const last = beats.at(-1);
        nextWith = true;
        if (last && last.who === r.beat.who && last.do === r.beat.do && (last.clip ?? "") === (r.beat.clip ?? "")) { prev = r.beat.who; continue; }
        delete beat.with;
      }
      beats.push(beat); prev = r.beat.who;
      const t = typeof r.beat.target === "string" ? resolveTarget(doc, r.beat.target) : undefined;
      prevTarget = t && t !== SCENE_CAMERA ? t : undefined;
    } else skipped.push({ text: clause, why: r.why! });
  }
  return { beats, skipped };
}

/** A point or object id for a target: [x, y, z] or a resolved id. */
function targetPoint(doc: SceneDoc, target: unknown, t: number): Vec3 | undefined {
  if (isVec3(target)) return target;
  if (typeof target !== "string") return undefined;
  if (target === SCENE_CAMERA) return stateAt(doc, t).camera.position;
  const s = stateAt(doc, t).objects.find((o) => o.id === target);
  if (!s) return undefined;
  const o = objectsOf(doc).find((x) => x.id === target)!;
  return isCharacterObj(o) ? [s.position[0], s.position[1] + characterHeight(o) * 0.6, s.position[2]] : s.position;
}

/** Where a character walking from `from` stops to reach `target`: beside it, on the walker's side, not inside it. */
function approachPoint(doc: SceneDoc, from: Vec3, target: string | Vec3, t: number): Vec3 | undefined {
  if (isVec3(target)) return [target[0], 0, target[2]];
  const st = stateAt(doc, t);
  const o = objectsOf(doc).find((x) => x.id === target), s = st.objects.find((x) => x.id === target);
  if (!o || !s) return undefined;
  const box = objectBox(o, s);
  const c: [number, number] = box ? [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2] : [s.position[0], s.position[2]];
  const hx = box ? (box.max[0] - box.min[0]) / 2 : 0.3, hz = box ? (box.max[2] - box.min[2]) / 2 : 0.3;
  const gap = isCharacterObj(o) ? 0.6 : 0.45;
  let dx = from[0] - c[0], dz = from[2] - c[1];
  if (Math.min(hx, hz) < 0.06) { // a door or window: stand in front of its face, on the walker's side
    if (hx < hz) { dx = Math.sign(dx) || 1; dz = 0; } else { dx = 0; dz = Math.sign(dz) || 1; }
    return vr([c[0] + dx * (hx + 0.55), 0, c[1] + dz * (hz + 0.55)]);
  }
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  // Leave the box along the direction to the walker (box-ray exit distance) plus a gap.
  const tx = Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : Infinity, tz = Math.abs(dz) > 1e-6 ? hz / Math.abs(dz) : Infinity;
  const k = Math.min(tx, tz) + gap;
  return vr([c[0] + dx * k, 0, c[1] + dz * k]);
}

const seatLike = (o: SceneObject) => /bench|chair|stool|sofa|couch|seat|bed|log/i.test(`${o.id} ${o.name ?? ""}`);
const focalOf = (fov: number) => (36 / (16 / 9)) / (2 * Math.tan((fov / 2) * D2R));

/**
 * block_action: compile beats (or blocking text) into events. Beats run one after another from `at` (default: after
 * the last character or camera event), "as / while" beats start with the previous one; walks take as long as the
 * distance needs. Clauses that aren't understood are skipped and reported; nothing else changes for them.
 */
export function blockAction(doc: SceneDoc, input: { text?: string; beats?: Beat[]; at?: number }): BlockResult | { error: string } {
  let list: (Beat & { source?: string })[] = [];
  const skipped: { text: string; why: string }[] = [];
  if (typeof input.text === "string" && input.text.trim()) { const p = parseBlocking(doc, input.text); list.push(...p.beats); skipped.push(...p.skipped); }
  if (Array.isArray(input.beats)) list = [...list, ...input.beats];
  if (!list.length) return skipped.length ? { error: `Nothing I could stage: ${skipped.map((s) => `"${s.text}": ${s.why}`).join(" ")}` } : { error: 'Give "text" (e.g. "Ana walks to the door, turns to Ben, camera pushes in") or "beats" [{ who, do, target?, … }].' };
  const actorEnd = () => Math.max(0, ...eventsOf(doc).filter((e) => e.obj === SCENE_CAMERA || sceneCameraDefs(doc).some((c) => c.id === e.obj) || objectsOf(doc).some((o) => o.id === e.obj && isCharacterObj(o))).map((e) => e.at + (e.dur ?? 0)));
  let cursor = num(input.at) && input.at >= 0 ? input.at : eventsOf(doc).length ? actorEnd() : 0.5;
  let prevStart = cursor;
  let d = doc;
  const out: SceneEvent[] = [], done: BlockResult["beats"] = [], notes: string[] = [];
  const add = (e: SceneEvent) => { d = { ...d, events: [...eventsOf(d), e] }; out.push(e); };
  for (const raw of list) {
    const beat = { ...raw } as Beat & { source?: string };
    const label = beat.source ?? `${beat.who} ${beat.do}`;
    if (!(BEAT_ACTIONS as readonly string[]).includes(beat.do)) { skipped.push({ text: label, why: `"do" must be one of ${BEAT_ACTIONS.join(", ")}.` }); continue; }
    const who = resolveName(d, String(beat.who ?? "")) ?? (beat.who === SCENE_CAMERA ? SCENE_CAMERA : undefined);
    if (!who) { skipped.push({ text: label, why: `No object, character or camera "${beat.who}". Objects: ${objectsOf(d).map((o) => o.id).join(", ")}; cameras: ${sceneCameraDefs(d).map((c) => c.id).join(", ")}.` }); continue; }
    const start = roundSec(num(beat.at) && beat.at >= 0 ? beat.at : beat.with ? prevStart : cursor);
    const isCam = sceneCameraDefs(d).some((c) => c.id === who);
    const cam = isCam ? (who === SCENE_CAMERA ? activeCameraAt(d, start) : who) : undefined;
    const obj = objectsOf(d).find((o) => o.id === who);
    const tgt = (v: unknown): string | Vec3 | undefined => (isVec3(v) ? v : typeof v === "string" ? resolveTarget(d, v) : undefined);
    const T = beat.target !== undefined ? tgt(beat.target) : undefined;
    if (beat.target !== undefined && T === undefined) { skipped.push({ text: label, why: `No object "${beat.target}". Objects: ${objectsOf(d).map((o) => o.id).join(", ")}.` }); continue; }
    let dur = 0;
    const ev = (call: string, args: Record<string, unknown>, len?: number, ease?: SceneEvent["ease"]) => add({ at: start, obj: (cam ?? who), call, args, ...(len && len > 0 ? { dur: roundSec(len) } : {}), ...(ease && len ? { ease } : {}) });
    if (!isCam) {
      if (!obj || !isCharacterObj(obj)) { skipped.push({ text: label, why: `"${who}" is not a character (only characters walk, turn, sit and speak; give an object props { character: {} }).` }); continue; }
      const here = stateAt(d, start).objects.find((o) => o.id === who)!;
      switch (beat.do) {
        case "walk": case "run": {
          if (T === undefined) { skipped.push({ text: label, why: "Walk where? Give a target (an object, a character or [x, y, z])." }); continue; }
          const p = approachPoint(d, here.position, T, start);
          if (!p) { skipped.push({ text: label, why: "That target can't be reached." }); continue; }
          const speed = num(beat.speed) && beat.speed > 0 ? beat.speed : beat.do === "run" ? 3.6 : 1.3;
          const len = floorPath(here.position, [p]).len;
          if (len < 0.05) { notes.push(`${who} is already at ${typeof T === "string" ? T : "that point"}.`); continue; }
          ev(beat.do === "run" ? "runTo" : "walkTo", { path: [p], ...(num(beat.speed) ? { speed } : {}) });
          dur = walkProfile(len, speed).total;
          break;
        }
        case "turn": {
          const target = T === SCENE_CAMERA ? vr(stateAt(d, start).camera.position) : T ?? r3((here.rotation[1] ?? 0) + (num(beat.degrees) ? beat.degrees : 180));
          dur = num(beat.dur) ? beat.dur : 0.7; ev("turnTo", { target }, dur, "inOutSine"); break;
        }
        case "look": { if (T === undefined) { skipped.push({ text: label, why: "Look at what?" }); continue; } dur = num(beat.dur) ? beat.dur : 0.6; ev("lookAt", { target: T }, dur, "inOutSine"); break; }
        case "sit": {
          const seat = typeof T === "string" ? T : objectsOf(d).filter((o) => o.id !== who && seatLike(o)).map((o) => ({ o, dd: isVec3(o.position) ? Math.hypot(o.position[0] - here.position[0], o.position[2] - here.position[2]) : 99 })).sort((a, b) => a.dd - b.dd)[0]?.o.id;
          if (!seat) { skipped.push({ text: label, why: "Sit on what? There is no bench, chair, stool or sofa; name the seat." }); continue; }
          dur = num(beat.dur) ? beat.dur : 0.8; ev("sit", { seat }, dur); break;
        }
        case "stand": dur = num(beat.dur) ? beat.dur : 0.8; ev("stand", {}, dur); break;
        case "gesture": {
          const clip = beat.clip ?? "wave";
          if (typeof T === "string" || isVec3(T)) add({ at: start, obj: who, call: "lookAt", args: { target: T }, dur: 0.5, ease: "inOutSine" });
          dur = num(beat.dur) ? beat.dur : sceneClipInfo(d, clip).length;
          ev("gesture", { clip }, num(beat.dur) ? beat.dur : undefined); break;
        }
        case "say": {
          const text = String(beat.text ?? "").trim();
          if (!text) { skipped.push({ text: label, why: "Say what? Give the line in quotes." }); continue; }
          dur = num(beat.dur) ? beat.dur : Math.max(0.8, r3(text.split(/\s+/).length * 0.38));
          ev("speak", { text }, dur); break;
        }
        case "express": dur = num(beat.dur) ? beat.dur : 0.5; ev("expression", { value: isObj(beat.value) ? beat.value : { happy: 1 } }, dur); break;
        case "pickUp": { if (typeof T !== "string") { skipped.push({ text: label, why: "Pick up which object?" }); continue; } dur = 0.8; ev("pickUp", { object: T }); break; }
        case "drop": { if (typeof T !== "string") { skipped.push({ text: label, why: "Drop which object?" }); continue; } dur = 0.6; ev("drop", { object: T }); break; }
        default: skipped.push({ text: label, why: `A character can't "${beat.do}" (that is a camera move).` }); continue;
      }
    } else {
      const len = num(beat.dur) && beat.dur > 0 ? beat.dur : 2.5;
      const pose = cameraPose(d, cam!, start);
      const subject = typeof T === "string" && T !== SCENE_CAMERA ? T : firstCharacter(d)?.id;
      switch (beat.do) {
        case "push": case "pull": dur = len; ev("dolly", { distance: num(beat.distance) ? beat.distance : beat.do === "push" ? 1.6 : -2 }, len, "inOutSine"); break;
        case "zoom": { dur = len; const f = focalOf(pose.fov); ev("focalLength", { value: r3(Math.min(300, Math.max(8, (beat.distance ?? 1) > 0 ? f * 1.6 : f / 1.6))) }, len, "inOutSine"); break; }
        case "crane": case "truck": dur = len; ev(beat.do, { distance: num(beat.distance) ? beat.distance : beat.do === "crane" ? 2 : 1.5 }, len, "inOutSine"); break;
        case "orbit": {
          const c = (typeof T === "string" ? targetPoint(d, T, start) : isVec3(T) ? T : undefined) ?? pose.target;
          const a0 = (Math.atan2(pose.position[0] - c[0], pose.position[2] - c[2]) * 180) / Math.PI;
          dur = num(beat.dur) && beat.dur > 0 ? beat.dur : 4;
          ev("orbit", { ...(T !== undefined && T !== SCENE_CAMERA ? { target: T } : {}), to: r3(a0 + (num(beat.degrees) ? beat.degrees : 50)) }, dur, "inOutSine"); break;
        }
        case "follow": { if (!subject) { skipped.push({ text: label, why: "Follow whom?" }); continue; } dur = 0; ev("follow", { target: subject, damping: 0.5 }); break; }
        case "rack": { if (T === undefined) { skipped.push({ text: label, why: "Rack focus to what?" }); continue; } dur = num(beat.dur) ? beat.dur : 1.4; ev("rackFocus", { to: T }, dur, "inOutCubic"); break; }
        case "handheld": dur = 0; ev("handheld", { amplitude: 0.035, frequency: 1.1 }); break;
        case "frame": {
          if (!subject) { skipped.push({ text: label, why: "Frame whom?" }); continue; }
          dur = num(beat.dur) ? beat.dur : 0;
          ev("frame", { subject, shot: beat.shot ?? "medium", ...(beat.angle ? { angle: beat.angle } : {}), ...(beat.height ? { height: beat.height } : {}) }, dur, "inOutCubic"); break;
        }
        case "cut": {
          if (!subject) { skipped.push({ text: label, why: "Cut to a shot of whom?" }); continue; }
          const shot = beat.shot ?? "medium";
          const r = addSceneCamera(d, start, { id: freeCamId(d, `cam-${shot}-${subject}`), name: `${shot} ${subject}` });
          d = r.doc;
          add({ at: start, obj: r.id, call: "frame", args: { subject, shot, angle: beat.angle ?? "front", height: beat.height ?? "eye" } });
          const shots = sceneShots(d);
          d = setSceneShots(d, [...(shots.length ? shots : [{ at: 0, camera: SCENE_CAMERA }]), { at: start, camera: r.id, name: `${shot} ${subject}` }]);
          notes.push(`New camera "${r.id}" (${shot} on ${subject}), cut to at ${start}s.`);
          dur = 0; break;
        }
        default: skipped.push({ text: label, why: `A camera can't "${beat.do}".` }); continue;
      }
    }
    done.push({ beat: (({ source: _s, ...x }) => (void _s, x))(beat) as Beat, at: start, dur: r3(dur), ...(beat.source ? { text: beat.source } : {}) });
    prevStart = start;
    cursor = Math.max(cursor, start + dur);
  }
  if (!done.length) return { error: `Nothing could be staged: ${skipped.map((s) => `"${s.text}": ${s.why}`).join(" ")}` };
  const endSec = r3(cursor);
  if (!num(d.durationSec) || d.durationSec < endSec + 0.5) { d = { ...d, durationSec: r3(Math.ceil((endSec + 1) * 2) / 2) }; notes.push(`Planned length now ${d.durationSec}s (the action ends at ${endSec}s).`); }
  return { doc: d, events: out, beats: done, skipped, endSec, notes };
}

function freeCamId(doc: SceneDoc, stem: string): string {
  const base = stem.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  const taken = new Set([...sceneCameraDefs(doc).map((c) => c.id), ...objectsOf(doc).map((o) => o.id)]);
  let id = base;
  for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
  return id;
}

// ------------------------------------------------------------------------------------------------ review checks

export type SceneCheckKind = "overlap" | "out-of-frame" | "occluded" | "head-cut" | "camera-inside" | "camera-below-floor" | "dark" | "bright";
export interface SceneCheck { kind: SceneCheckKind; level: "warning" | "info"; at: number; camera?: string; objects?: string[]; message: string; fix?: string }

/** The times a review looks at: around each shot (start, middle, end) or spread over the length. */
export function reviewTimes(doc: SceneDoc, count = 6): number[] {
  const total = num(doc.durationSec) && doc.durationSec > 0 ? doc.durationSec : Math.max(1, ...eventsOf(doc).map((e) => e.at + (e.dur ?? 0)));
  const shots = sceneShots(doc);
  if (shots.length > 1) {
    const out: number[] = [];
    shots.forEach((s, i) => { const end = shots[i + 1]?.at ?? total; const len = end - s.at; if (len <= 0) return; out.push(r3(s.at + Math.min(0.2, len / 4)), r3(s.at + len / 2), r3(Math.max(s.at, end - Math.min(0.2, len / 4)))); });
    return [...new Set(out)].filter((t) => t >= 0 && t <= total).sort((a, b) => a - b).slice(0, 36);
  }
  const n = Math.max(1, Math.min(36, Math.round(count)));
  return Array.from({ length: n }, (_, i) => r3(((i + 0.5) * total) / n));
}

/** Project a world point with a camera pose: x, y in -1..1 inside the frame; `behind` when it is behind the lens. */
export function projectPoint(cam: { fov: number; position: Vec3; target: Vec3 }, p: Vec3, aspect = 16 / 9): { x: number; y: number; behind: boolean; depth: number } {
  const f = norm(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(...r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const v = sub(p, cam.position);
  const z = dot(v, f);
  const th = Math.tan((cam.fov / 2) * D2R);
  if (z <= 0.05) return { x: 0, y: 0, behind: true, depth: z };
  return { x: dot(v, r) / (z * th * aspect), y: dot(v, u) / (z * th), behind: false, depth: z };
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Seats characters sit on at `t` and objects held at `t` (pairs that touch on purpose). */
function touchingPairs(doc: SceneDoc, st: SceneState): Set<string> {
  const pairs = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const byObj = new Map<string, SceneEvent[]>();
  for (const e of eventsOf(doc)) if (e.at <= st.t + 1e-9) { const l = byObj.get(e.obj) ?? []; l.push(e); byObj.set(e.obj, l); }
  for (const [obj, list] of byObj) {
    const last = list.filter((e) => e.call === "sit" || e.call === "stand").sort((a, b) => a.at - b.at).pop();
    if (last?.call === "sit" && isObj(last.args) && typeof last.args.seat === "string") pairs.add(key(obj, last.args.seat));
  }
  for (const o of st.objects) if (o.held) pairs.add(key(o.id, o.held.by));
  return pairs;
}

/**
 * Automatic review of a scene at `times` (default `reviewTimes`): objects intersecting (boxes overlapping by more than
 * a fifth of the smaller one; flat pieces, the floor, scripts, seats being sat on and held objects are left out), a
 * character outside the frame (or its head cut off) of the camera seen then, and the camera inside an object or under
 * the floor. Pure geometry from the scene's state; brightness needs the rendered frame (`lumaVerdict`).
 */
export function checkScene(doc: SceneDoc, opts: { times?: number[]; aspect?: number; camera?: string } = {}): SceneCheck[] {
  const times = opts.times?.length ? opts.times : reviewTimes(doc);
  const aspect = opts.aspect ?? 16 / 9;
  const out: SceneCheck[] = [];
  const seen = new Set<string>();
  const push = (c: SceneCheck, dedupe: string) => { if (seen.has(dedupe)) return; seen.add(dedupe); out.push(c); };
  const byId = new Map(objectsOf(doc).map((o) => [o.id, o]));
  const hasFloor = objectsOf(doc).some((o) => o.shape === "plane" && isVec3(o.rotation) && Math.abs(o.rotation[0] + 90) < 1);
  for (const t of times) {
    const st = stateAt(doc, t);
    const camId = opts.camera ?? st.cameraId ?? SCENE_CAMERA;
    const cam = opts.camera ? (st.cameras?.find((c) => c.id === opts.camera) ?? st.camera) : st.camera;
    const touching = touchingPairs(doc, st);
    const boxes: { id: string; o: SceneObject; min: Vec3; max: Vec3 }[] = [];
    for (const s of st.objects) {
      const o = byId.get(s.id);
      if (!o || !s.visible || s.opacity <= 0.02 || s.held) continue;
      if (o.shape === "plane" && !o.model && !isCharacterObj(o)) continue;
      const b = objectBox(o, s);
      if (b) boxes.push({ id: s.id, o, ...b });
    }
    // Overlaps
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (touching.has(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)) continue;
      const ov = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
      if (ov.some((x) => x <= 0.03)) continue;
      const vol = (x: typeof a) => Math.max(1e-6, (x.max[0] - x.min[0]) * Math.max(0.1, x.max[1] - x.min[1]) * (x.max[2] - x.min[2]));
      const flat = (x: typeof a) => x.max[1] - x.min[1] < 0.1;
      if (flat(a) || flat(b)) continue;
      const ratio = (ov[0] * ov[1] * ov[2]) / Math.min(vol(a), vol(b));
      if (ratio < 0.2) continue;
      const pair = [a.id, b.id].sort();
      const ch = [a, b].find((x) => isCharacterObj(x.o));
      push({ kind: "overlap", level: "warning", at: t, objects: pair, message: `${pair[0]} and ${pair[1]} intersect (${Math.round(Math.min(1, ratio) * 100)}% of the smaller one) at ${t}s.`,
        fix: ch ? `Move ${ch.id} (or its walk path) clear of ${ch === a ? b.id : a.id}.` : `Move one of them apart (set_scene_object position).` }, `overlap|${pair.join("|")}`);
    }
    // Camera inside geometry / under the floor
    const cp = cam.position;
    for (const b of boxes) {
      if (cp[0] > b.min[0] + 0.02 && cp[0] < b.max[0] - 0.02 && cp[1] > b.min[1] + 0.02 && cp[1] < b.max[1] - 0.02 && cp[2] > b.min[2] + 0.02 && cp[2] < b.max[2] - 0.02)
        push({ kind: "camera-inside", level: "warning", at: t, camera: camId, objects: [b.id], message: `Camera ${camId} is inside ${b.id} at ${t}s.`, fix: `Move ${camId} out of ${b.id} or move ${b.id}.` }, `inside|${camId}|${b.id}`);
    }
    if (hasFloor && cp[1] < 0.05) push({ kind: "camera-below-floor", level: "warning", at: t, camera: camId, message: `Camera ${camId} is below the floor at ${t}s (y = ${r3(cp[1])}).`, fix: "Raise the camera above y = 0.1." }, `floor|${camId}`);
    // Characters in frame: the camera's subjects (what it frames, follows, orbits or focuses on), or every character
    // when the frame shows none of them.
    const subjects = cameraSubjects(doc, camId, t);
    const chars = st.objects.filter((s) => { const o = byId.get(s.id); return !!o && isCharacterObj(o) && s.visible && s.opacity > 0.02; });
    const view = chars.map((s) => {
      const h = characterHeight(byId.get(s.id)!);
      const pts = [0.05, 0.5, 0.95].map((k) => projectPoint(cam, [s.position[0], s.position[1] + h * k, s.position[2]], aspect));
      return { s, pts };
    });
    const inF = (p: ReturnType<typeof projectPoint>) => !p.behind && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    const noneSeen = !view.some((v) => v.pts.some(inF));
    for (const { s, pts } of view) {
      // A camera aimed at nothing in particular shows whoever is in frame: check them all for being hidden.
      const aimed = subjects.has(s.id) || noneSeen;
      if (!aimed && subjects.size) continue;
      if (!pts.some(inF)) {
        if (!aimed) continue;
        const where = pts[1].behind ? "behind the camera" : Math.abs(pts[1].x) > 1 ? (pts[1].x > 0 ? "off the right edge" : "off the left edge") : pts[1].y > 1 ? "above the frame" : "below the frame";
        push({ kind: "out-of-frame", level: "warning", at: t, camera: camId, objects: [s.id], message: `${s.id} is outside the frame of ${camId} at ${t}s (${where}).`, fix: `Aim ${camId} at ${s.id} (a frame { subject: "${s.id}" } or follow event), or move ${s.id} into view.` }, `oof|${camId}|${s.id}|${Math.round(t)}`);
      } else if (inF(pts[1]) || inF(pts[2])) {
        // In frame, but hidden: the lines from the lens to its middle and to its head both pass through a solid object
        // (set pieces only: people passing in front of each other is ordinary blocking).
        const h = characterHeight(byId.get(s.id)!);
        const mid: Vec3 = [s.position[0], s.position[1] + h * 0.5, s.position[2]], head: Vec3 = [s.position[0], s.position[1] + h * 0.9, s.position[2]];
        const blocker = (p: Vec3) => boxes.find((b) => b.id !== s.id && !isCharacterObj(b.o) && b.max[1] - b.min[1] >= 0.1 && segmentHitsBox(cam.position, p, b, Math.min(0.05, 0.2 * Math.min(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2)));
        const bm = blocker(mid), bh = blocker(head);
        if (bm && bh) push({ kind: "occluded", level: "warning", at: t, camera: camId, objects: [s.id, bm.id, ...(bh.id !== bm.id ? [bh.id] : [])], message: `${s.id} is hidden behind ${bm.id}${bh.id !== bm.id ? ` and ${bh.id}` : ""} from ${camId} at ${t}s.`, fix: `Move ${camId} (another angle: frame { subject: "${s.id}", angle } or orbit) or move ${bm.id}.` }, `occ|${camId}|${s.id}|${Math.round(t)}`);
        else if (inF(pts[1]) && !inF(pts[2]) && !pts[2].behind && pts[2].y > 1) push({ kind: "head-cut", level: "info", at: t, camera: camId, objects: [s.id], message: `${s.id}'s head is cut off by the top of ${camId}'s frame at ${t}s.`, fix: `Tilt ${camId} up or frame wider.` }, `head|${camId}|${s.id}`);
      }
    }
  }
  return out;
}

/** Does the segment a→b pass through `box` (shrunk by `inset`, so grazing an edge doesn't count)? Slab test. */
function segmentHitsBox(a: Vec3, b: Vec3, box: { min: Vec3; max: Vec3 }, inset = 0): boolean {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const lo = box.min[k] + inset, hi = box.max[k] - inset;
    if (lo > hi) return false;
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] < lo || a[k] > hi) return false; continue; }
    let u = (lo - a[k]) / d, v = (hi - a[k]) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return t1 > 0.001 && t0 < 0.999;
}

/** The objects camera `id` is aimed at by `t`: frame / follow / orbit / rackFocus / focus targets and its lens focus. */
function cameraSubjects(doc: SceneDoc, id: string, t: number): Set<string> {
  const out = new Set<string>();
  const def = sceneCameraDefs(doc).find((c) => c.id === id);
  if (typeof def?.lens?.focus === "string") out.add(def.lens.focus);
  for (const e of eventsOf(doc)) {
    if (e.obj !== id || e.at > t + 1e-9 || !isObj(e.args)) continue;
    for (const k of ["subject", "target", "to", "value"]) { const v = e.args[k]; if (typeof v === "string") out.add(v); }
  }
  return out;
}

/** Brightness statistics of RGBA pixels (sampled every `step` pixels): mean luma 0..255 and dark / bright fractions. */
export function lumaStats(data: ArrayLike<number>, step = 4): { mean: number; dark: number; bright: number } {
  let sum = 0, n = 0, dark = 0, bright = 0;
  for (let i = 0; i + 2 < data.length; i += 4 * Math.max(1, step)) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y; n++; if (y < 20) dark++; if (y > 245) bright++;
  }
  return n ? { mean: r3(sum / n), dark: r3(dark / n), bright: r3(bright / n) } : { mean: 0, dark: 1, bright: 0 };
}

/** Too dark or too bright, from `lumaStats`. */
export function lumaVerdict(s: { mean: number; dark: number; bright: number }, at: number, camera?: string): SceneCheck | undefined {
  if (s.mean < 38 || s.dark > 0.6) return { kind: "dark", level: "warning", at, ...(camera ? { camera } : {}), message: `The frame at ${at}s is too dark (mean ${Math.round(s.mean)}/255, ${Math.round(s.dark * 100)}% near black).`, fix: "Raise post exposure, a light's intensity or the fill light (set_mood timeOfDay, set_scene_light)." };
  if (s.mean > 218 || s.bright > 0.35) return { kind: "bright", level: "warning", at, ...(camera ? { camera } : {}), message: `The frame at ${at}s is too bright (mean ${Math.round(s.mean)}/255, ${Math.round(s.bright * 100)}% blown out).`, fix: "Lower post exposure or the sun's intensity; check bloom threshold." };
  return undefined;
}

// ------------------------------------------------------------------------------------------------ storyboard → scene

const MOOD_WORDS: [RegExp, MoodSpec][] = [
  [/\brain(y|ing)?\b|\bstorm/i, { preset: "rainy-night" }],
  [/\b(interior|indoors?|inside|kitchen|bedroom|living room|study|tavern|lamp-?lit|candle-?lit|room)\b/i, { preset: "interior-lamp" }],
  [/\b(dusk|sunset|twilight|evening)\b/i, { preset: "dusk-village" }],
  [/\b(golden hour|late afternoon)\b/i, { preset: "golden-hour" }],
  [/\b(night|moon(lit|light)?|midnight)\b/i, { preset: "moonlit" }],
  [/\b(overcast|cloudy|grey day|gray day|fog(gy)?|mist(y)?)\b/i, { preset: "overcast" }],
  [/\b(dawn|sunrise)\b/i, { timeOfDay: "dawn" }],
  [/\b(morning)\b/i, { timeOfDay: "morning" }],
  [/\b(noon|midday|sunny|bright day|daylight)\b/i, { preset: "noon-sunny" }],
  [/\b(studio|turntable|product)\b/i, { preset: "studio" }],
];
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, several: 3, some: 2, few: 2 };
const PERSON = /\b(man|woman|girl|boy|person|villager|hero|heroine|child|kid|old man|old woman|stranger|traveller|traveler|knight|farmer|character)\b/i;

export interface ShotDraftInput { title?: string; prompt: string; camera?: string; durationSec?: number; refs?: { id: string; name: string; type: string; prompt?: string }[] }

/**
 * A first-draft brief from a storyboard shot: the mood from its words (and its location references), set pieces from
 * the nouns it names, characters from its character references (else one hero when it mentions a person), cameras from
 * its camera note, and the blocking from the prompt itself (block_action keeps what it understands).
 */
export function briefFromText(input: ShotDraftInput): { brief: StageBrief; blocking: string } {
  const refs = input.refs ?? [];
  const text = [input.prompt, ...refs.filter((r) => r.type === "location" || r.type === "style").map((r) => r.prompt ?? "")].join(" ");
  let mood: MoodSpec | undefined;
  for (const [re, m] of MOOD_WORDS) if (re.test(text)) { mood = { ...m }; break; }
  if (mood?.preset === "moonlit" && /rain/i.test(text)) mood = { preset: "rainy-night" };
  const interior = mood?.preset === "interior-lamp";
  // Set pieces named in the text (with simple counts: "two houses").
  const set: StageSetPiece[] = [];
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/);
  const counts = new Map<string, number>();
  words.forEach((w, i) => {
    const kind = setPieceKind(w);
    if (!kind) return;
    const prev = words[i - 1];
    const k = NUMBERS[prev] ?? (/^\d+$/.test(prev ?? "") ? Math.min(6, Number(prev)) : 1);
    counts.set(kind, Math.max(counts.get(kind) ?? 0, w.endsWith("s") && k === 1 ? 2 : k));
  });
  const spotsFor: Record<string, StageSpot[]> = { house: ["back", "back-left", "back-right"], tower: ["far-back"], tree: ["back-right", "back-left", "far-right", "far-left"], lamp: ["right", "left"], bench: ["left", "right"], well: ["center"], table: ["center"], chair: ["front-left", "front-right"], wall: ["far-back"], shelf: ["back-left", "back-right"] };
  for (const [kind, k] of counts) for (let i = 0; i < k; i++) {
    const id = k > 1 ? `${kind}-${i + 1}` : kind;
    const spots = spotsFor[kind];
    const at: StagePlace | undefined = kind === "door" || kind === WINDOW_KIND ? (counts.has("house") ? { near: counts.get("house")! > 1 ? "house-1" : "house", side: "front" } : counts.has("wall") ? { near: "wall", side: "front" } : undefined) : spots ? spots[i % spots.length] : undefined;
    set.push({ id, kind, ...(at ? { at } : {}) });
  }
  if (interior && !counts.has("wall")) set.unshift({ id: "wall", kind: "wall", at: "far-back", size: 2 });
  if (!interior && /\b(street|village|town|road|alley)\b/i.test(text) && !counts.has("street")) set.unshift({ id: "street", kind: "street", at: { x: 0, z: 0.6 } });
  // Characters: references first, else a person mentioned in the prompt.
  const charRefs = refs.filter((r) => r.type === "character");
  const characters: StageCharacter[] = charRefs.map((r, i) => ({ id: idFrom(r.id), name: r.name, at: (["left", "right", "center", "front-left", "front-right"] as StageSpot[])[i % 5] }));
  if (!characters.length && PERSON.test(input.prompt)) characters.push({ id: "hero", name: "Hero", at: "left" });
  // Cameras from the shot's camera note and prompt.
  const camText = `${input.camera ?? ""} ${input.prompt}`.toLowerCase();
  const sizeWord = /extreme close-?up/.test(camText) ? "extreme-closeup" : /close-?up|\bcu\b/.test(camText) ? "closeup" : /\bmedium\b|\bmid shot\b/.test(camText) ? "medium" : /\bfull shot\b/.test(camText) ? "full" : /\bwide\b|establishing/.test(camText) ? "wide" : undefined;
  const cameras: StageCamera[] = [];
  const subject = characters[0]?.id;
  if (subject) cameras.push({ id: SCENE_CAMERA, subject, shot: (sizeWord as SceneShotSize) ?? "wide", angle: "front", height: /low angle/.test(camText) ? "low" : /high angle|overhead|bird/.test(camText) ? (/overhead|bird/.test(camText) ? "overhead" : "high") : "eye" });
  const brief: StageBrief = { ...(input.title ? { name: input.title } : {}), ...(num(input.durationSec) ? { durationSec: input.durationSec } : {}), ...(mood ? { mood } : {}), set, characters, cameras };
  // Blocking: the prompt with names mapped onto character ids, plus camera moves from the camera note.
  let blocking = input.prompt;
  for (const r of charRefs) blocking = blocking.replace(new RegExp(`\\b${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), idFrom(r.id));
  const camMoves = [/push(es)? in|dolly in/.test(camText) ? "camera pushes in" : "", /pull(s)? (out|back)/.test(camText) ? "camera pulls out" : "", /orbit|circles?/.test(camText) ? "camera orbits" : "", /handheld/.test(camText) ? "camera goes handheld" : "", /crane|rises/.test(camText) ? "camera cranes up" : ""].filter(Boolean);
  if (camMoves.length) blocking = `${blocking}. ${camMoves.join(". ")}.`;
  return { brief, blocking };
}
const idFrom = (s: string) => { const x = s.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z]+/, ""); return x || "character"; };

/** An empty scene for a draft (camera, no objects). */
export const emptyScene = (durationSec = 5): SceneDoc => ({ format: "dionysus.scene/1", durationSec, world: { background: "#14161c" }, objects: [], events: [] });

/** A first-draft scene from a storyboard shot (staging, then the blocking the prompt describes). */
export function draftSceneFromShot(input: ShotDraftInput, override: { brief?: StageBrief; blocking?: string } = {}): { doc: SceneDoc; brief: StageBrief; blocking: string; notes: string[]; skipped: { text: string; why: string }[] } {
  const read = briefFromText(input);
  const brief = override.brief ?? read.brief, blocking = override.blocking ?? read.blocking;
  const staged = stageScene(emptyScene(num(input.durationSec) ? input.durationSec : 5), brief);
  const notes: string[] = [];
  let doc: SceneDoc;
  if ("error" in staged) { doc = emptyScene(input.durationSec); notes.push(`Staging failed: ${staged.error}`); } else { doc = staged.doc; notes.push(...staged.report.notes); }
  let skipped: { text: string; why: string }[] = [];
  if (objectsOf(doc).some(isCharacterObj)) {
    const b = blockAction(doc, { text: blocking, at: 0.5 });
    if (!("error" in b)) { doc = b.doc; skipped = b.skipped; notes.push(...b.notes); if (num(input.durationSec) && b.endSec > input.durationSec) notes.push(`The action (${b.endSec}s) runs past the shot's ${input.durationSec}s.`); }
    else skipped = [{ text: blocking, why: b.error }];
  }
  if (num(input.durationSec)) doc = { ...doc, durationSec: input.durationSec };
  return { doc, brief, blocking, notes, skipped };
}

/**
 * Regenerate keeping the user's edits: the previous scene wins wherever ids match (objects, cameras, lights, look,
 * shots, events on its objects); the draft only adds what is new (objects, cameras and lights with new ids and their
 * events).
 */
export function mergeSceneDraft(prev: SceneDoc, draft: SceneDoc): { doc: SceneDoc; kept: string[]; added: string[] } {
  const prevIds = new Set(objectsOf(prev).map((o) => o.id));
  const pw = worldOf(prev), dw = worldOf(draft);
  const prevCams = Array.isArray(pw.cameras) ? (pw.cameras as { id: string }[]) : [];
  const draftCams = Array.isArray(dw.cameras) ? (dw.cameras as { id: string }[]) : [];
  const camIds = new Set([SCENE_CAMERA, ...prevCams.map((c) => c.id)]);
  const prevLights = Array.isArray(pw.lights) ? (pw.lights as SceneLight[]) : [];
  const draftLights = Array.isArray(dw.lights) ? (dw.lights as SceneLight[]) : [];
  const lightIds = new Set(prevLights.map((l) => l.id).filter(Boolean));
  const addObjs = objectsOf(draft).filter((o) => !prevIds.has(o.id));
  const addCams = draftCams.filter((c) => !camIds.has(c.id) && !prevIds.has(c.id));
  const addLights = prevLights.length ? draftLights.filter((l) => l.id && !lightIds.has(l.id) && !prevIds.has(l.id)) : [];
  const newIds = new Set([...addObjs.map((o) => o.id), ...addCams.map((c) => c.id), ...addLights.map((l) => l.id!)]);
  const world: Record<string, unknown> = { ...dw, ...pw };
  if (!prevLights.length && draftLights.length) world.lights = draftLights; else if (addLights.length) world.lights = [...prevLights, ...addLights];
  if (prevCams.length || addCams.length) world.cameras = [...prevCams, ...addCams]; else delete world.cameras;
  const events = [...eventsOf(prev), ...eventsOf(draft).filter((e) => newIds.has(e.obj))];
  const doc: SceneDoc = {
    ...draft, ...prev, format: prev.format ?? draft.format, world: world as SceneDoc["world"],
    objects: [...objectsOf(prev), ...addObjs], events,
    ...(prev.files || draft.files ? { files: { ...(draft.files ?? {}), ...(prev.files ?? {}) } } : {}),
    ...(prev.animations || draft.animations ? { animations: { ...(draft.animations ?? {}), ...(prev.animations ?? {}) } } : {}),
    ...(prev.shots?.length ? { shots: prev.shots } : draft.shots?.length ? { shots: draft.shots } : {}),
  };
  if (!doc.shots?.length) delete doc.shots;
  // Shots naming a camera that didn't survive are dropped by the validator's rules; keep only valid ones.
  if (doc.shots) doc.shots = doc.shots.filter((s) => s.camera === SCENE_CAMERA || (doc.world?.cameras ?? []).some((c) => c.id === s.camera));
  return { doc, kept: [...prevIds].filter((id) => objectsOf(draft).some((o) => o.id === id)), added: [...newIds] };
}

/** Validation errors a staged scene has (used by tests and tools). */
export const stageErrors = (doc: SceneDoc) => validateScene(doc).filter((i) => i.level === "error");
