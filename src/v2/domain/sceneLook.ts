/**
 * Scene Phase 1 (#350): the stylized look of a `dionysus.scene/1` document. Pure: no DOM, no three.js. Everything here
 * is optional, so a scene without these fields renders exactly as before.
 *
 * - Materials: an object's `material` — "standard" (the old look), "toon" (banded light, `steps`), "unlit", or
 *   "keep" (a model's or script's own materials) — with optional `outline` (inverted hull) and `rim` light. A model or
 *   Script object keeps its own materials unless `material.type` says otherwise (outline and rim still apply).
 * - Lights: `id`-named lights take events (`intensity`, `color`, `position` / `moveTo`, `lookAt`) and may cast shadows.
 * - Atmosphere: `world.fog` (linear or exp2), `world.sky` (procedural sky: sun elevation / azimuth, turbidity; it can
 *   drive a directional light) and `world.environment` (an equirect HDRI / image from `files` for reflections).
 * - Post-processing: `world.post` (tone mapping, exposure, colour grading, vignette, grain, bloom, depth of field,
 *   SSAO, FXAA / SMAA), animated with events on the pseudo-object "post" (like "camera"); fog and sky animate with
 *   events on "fog" and "sky". An object with the id "post", "fog" or "sky" keeps its events (old scenes unchanged).
 * - `world.export.supersample`: render export frames at 2–4× and downsample (preview stays 1×).
 */
import type { SceneEase, Vec3 } from "./scene";

export type SceneMaterialType = "standard" | "toon" | "unlit" | "keep";
export const SCENE_MATERIALS: readonly SceneMaterialType[] = ["standard", "toon", "unlit", "keep"];
export interface SceneOutline { color?: string; width?: number }
export interface SceneRim { color?: string; strength?: number; power?: number }
export interface SceneMaterial {
  type?: SceneMaterialType;
  /** Toon only: light bands, 2–8 (default 3). */
  steps?: number;
  roughness?: number;
  metalness?: number;
  /** A glow colour (standard and toon): what bloom picks up. */
  emissive?: string;
  emissiveIntensity?: number;
  outline?: boolean | SceneOutline;
  rim?: boolean | SceneRim;
}

export interface SceneShadow { mapSize?: number; bias?: number; normalBias?: number; radius?: number; area?: number }
export type SceneFogType = "linear" | "exp2";
export interface SceneFog { type?: SceneFogType; color?: string; near?: number; far?: number; density?: number }
export interface SceneSky { elevation?: number; azimuth?: number; turbidity?: number; rayleigh?: number; mieCoefficient?: number; mieDirectionalG?: number; light?: string }
export interface SceneEnvironment { file: string; background?: boolean }
export type SceneToneMapping = "none" | "linear" | "reinhard" | "cineon" | "aces" | "agx";
export const SCENE_TONE_MAPPINGS: readonly SceneToneMapping[] = ["none", "linear", "reinhard", "cineon", "aces", "agx"];
export type SceneAA = "none" | "fxaa" | "smaa";
export const SCENE_AAS: readonly SceneAA[] = ["none", "fxaa", "smaa"];
export interface SceneBloom { strength?: number; radius?: number; threshold?: number }
export interface SceneDof { focus?: number; aperture?: number; maxblur?: number }
export interface SceneSsao { radius?: number; minDistance?: number; maxDistance?: number }
export interface ScenePost {
  toneMapping?: SceneToneMapping;
  exposure?: number;
  contrast?: number;
  saturation?: number;
  lift?: Vec3;
  gamma?: Vec3;
  gain?: Vec3;
  vignette?: number;
  grain?: number;
  bloom?: boolean | SceneBloom;
  dof?: boolean | SceneDof;
  ssao?: boolean | SceneSsao;
  aa?: SceneAA;
}
export interface SceneExport { supersample?: number }

/** The pseudo-objects of the world that take events, besides the camera. */
export type SceneLookTarget = "light" | "post" | "fog" | "sky";
export const SCENE_POST = "post", SCENE_FOG = "fog", SCENE_SKY = "sky";
export const SCENE_LOOK_IDS: readonly string[] = [SCENE_POST, SCENE_FOG, SCENE_SKY];

/** One animatable property of a light, "post", "fog" or "sky": the call, its argument and its kind. */
export interface SceneLookCall {
  prop: string;
  arg: string;
  kind: "number" | "color" | "vec3" | "target";
  min?: number;
  max?: number;
  step?: number;
  label: string;
  description: string;
  /** For "post": the effect that must be declared for the call to show (bloom, dof). */
  needs?: "bloom" | "dof" | "ssao";
}
const n = (prop: string, label: string, description: string, min?: number, max?: number, step = 0.05, needs?: SceneLookCall["needs"]): SceneLookCall => ({ prop, arg: "value", kind: "number", label, description, min, max, step, needs });
export const SCENE_LIGHT_CALLS: Record<string, SceneLookCall> = {
  intensity: n("intensity", "Intensity", "Brightness (≥ 0).", 0, undefined, 0.1),
  color: { prop: "color", arg: "value", kind: "color", label: "Colour", description: "Light colour \"#rrggbb\"." },
  position: { prop: "position", arg: "value", kind: "vec3", label: "Position", description: "Move the light to [x, y, z] (directional and point lights)." },
  moveTo: { prop: "position", arg: "position", kind: "vec3", label: "Position", description: "Same as position; the argument is named position." },
  lookAt: { prop: "target", arg: "target", kind: "target", label: "Aim at", description: "Directional lights: aim at an object id or a point [x, y, z]." },
};
export const SCENE_POST_CALLS: Record<string, SceneLookCall> = {
  exposure: n("exposure", "Exposure", "Exposure (1 = as rendered).", 0, 8),
  contrast: n("contrast", "Contrast", "Contrast (1 = unchanged).", 0, 3),
  saturation: n("saturation", "Saturation", "Saturation (0 = grey, 1 = unchanged).", 0, 3),
  lift: { prop: "lift", arg: "value", kind: "vec3", label: "Lift (r, g, b)", description: "Shadows tint [r, g, b], -1..1 (0 = unchanged)." },
  gamma: { prop: "gamma", arg: "value", kind: "vec3", label: "Gamma (r, g, b)", description: "Midtones [r, g, b], 0.1..5 (1 = unchanged)." },
  gain: { prop: "gain", arg: "value", kind: "vec3", label: "Gain (r, g, b)", description: "Highlights [r, g, b], 0..4 (1 = unchanged)." },
  vignette: n("vignette", "Vignette", "Darkened corners, 0..1.", 0, 1),
  grain: n("grain", "Film grain", "Film grain, 0..1 (seeded per frame time).", 0, 1),
  bloomStrength: n("bloom.strength", "Bloom strength", "Bloom strength, 0..5 (needs world.post.bloom).", 0, 5, 0.05, "bloom"),
  bloomRadius: n("bloom.radius", "Bloom radius", "Bloom radius, 0..1.", 0, 1, 0.05, "bloom"),
  bloomThreshold: n("bloom.threshold", "Bloom threshold", "Brightness that blooms, 0..2.", 0, 2, 0.05, "bloom"),
  dofFocus: n("dof.focus", "Focus distance", "Focus distance from the camera in units (needs world.post.dof): a focus pull.", 0.01, 500, 0.1, "dof"),
  dofAperture: n("dof.aperture", "Aperture", "Blur amount, 0..0.2 (larger = shallower focus).", 0, 0.2, 0.001, "dof"),
  dofMaxblur: n("dof.maxblur", "Max blur", "Largest blur, 0..0.05.", 0, 0.05, 0.001, "dof"),
};
export const SCENE_FOG_CALLS: Record<string, SceneLookCall> = {
  color: { prop: "color", arg: "value", kind: "color", label: "Colour", description: "Fog colour \"#rrggbb\"." },
  near: n("near", "Near", "Linear fog: where it starts (units from the camera).", 0, undefined, 0.5),
  far: n("far", "Far", "Linear fog: where it is full.", 0.01, undefined, 0.5),
  density: n("density", "Density", "Exp2 fog: thickness, 0..1.", 0, 1, 0.005),
};
export const SCENE_SKY_CALLS: Record<string, SceneLookCall> = {
  sunElevation: n("elevation", "Sun elevation (°)", "Sun height in degrees (-10 = below the horizon, 90 = overhead).", -90, 90, 1),
  sunAzimuth: n("azimuth", "Sun azimuth (°)", "Sun direction in degrees around y (0 = +z, 90 = +x).", -360, 360, 1),
  turbidity: n("turbidity", "Turbidity", "Haze, 0..20.", 0, 20, 0.1),
  rayleigh: n("rayleigh", "Rayleigh", "Blue scattering, 0..4 (lower = paler, higher = deeper dusk).", 0, 4, 0.05),
};
export const SCENE_LOOK_CALLS: Record<SceneLookTarget, Record<string, SceneLookCall>> = { light: SCENE_LIGHT_CALLS, post: SCENE_POST_CALLS, fog: SCENE_FOG_CALLS, sky: SCENE_SKY_CALLS };

// ---------------------------------------------------------------- checks

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(num);
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const inRange = (v: unknown, min?: number, max?: number) => num(v) && (min === undefined || v >= min) && (max === undefined || v <= max);
const rangeText = (min?: number, max?: number) => (min !== undefined && max !== undefined ? `from ${min} to ${max}` : min !== undefined ? `≥ ${min}` : max !== undefined ? `≤ ${max}` : "");

type Report = (path: string, message: string) => void;

/** Check fields of an object against { key: check } (unknown keys are errors). */
function fields(v: Record<string, unknown>, p: string, err: Report, checks: Record<string, (x: unknown) => string | undefined>) {
  for (const [k, x] of Object.entries(v)) {
    const c = checks[k];
    if (!c) { err(`${p}.${k}`, `is not a field here (${Object.keys(checks).join(", ")}).`); continue; }
    const why = c(x); if (why) err(`${p}.${k}`, why);
  }
}
const numCheck = (min?: number, max?: number) => (x: unknown) => (inRange(x, min, max) ? undefined : `must be a number ${rangeText(min, max)}.`);
const colorCheck = (x: unknown) => (isColor(x) ? undefined : "must be a colour like \"#ffffff\".");
const vecCheck = (min: number, max: number) => (x: unknown) => (isVec3(x) && x.every((c) => c >= min && c <= max) ? undefined : `must be [r, g, b] numbers from ${min} to ${max}.`);
const enumCheck = (list: readonly string[]) => (x: unknown) => (list.includes(String(x)) ? undefined : `must be one of ${list.map((s) => `"${s}"`).join(", ")}.`);
/** `true`, `false` or an object of fields. */
const optObj = (checks: Record<string, (x: unknown) => string | undefined>, p: string, err: Report) => (x: unknown) => {
  if (typeof x === "boolean") return undefined;
  if (!isObj(x)) return `must be true, false or { ${Object.keys(checks).join(", ")} }.`;
  fields(x, p, err, checks);
  return undefined;
};

/** Problems with an object's `material` (string or object). */
export function validateMaterial(v: unknown, p: string, err: Report) {
  if (typeof v === "string") { if (!SCENE_MATERIALS.includes(v as SceneMaterialType)) err(p, `must be one of ${SCENE_MATERIALS.map((s) => `"${s}"`).join(", ")} or { type, steps, outline, rim, … }.`); return; }
  if (!isObj(v)) { err(p, "must be a material name (\"standard\", \"toon\", \"unlit\", \"keep\") or { type, steps, roughness, metalness, emissive, emissiveIntensity, outline, rim }."); return; }
  fields(v, p, err, {
    type: enumCheck(SCENE_MATERIALS),
    steps: (x) => (num(x) && Number.isInteger(x) && x >= 2 && x <= 8 ? undefined : "must be a whole number from 2 to 8."),
    roughness: numCheck(0, 1), metalness: numCheck(0, 1),
    emissive: colorCheck, emissiveIntensity: numCheck(0, 100),
    outline: optObj({ color: colorCheck, width: numCheck(0, 1) }, `${p}.outline`, err),
    rim: optObj({ color: colorCheck, strength: numCheck(0, 10), power: numCheck(0.1, 16) }, `${p}.rim`, err),
  });
}

/** Problems with a light's Phase 1 fields (groundColor, lookAt, shadow). */
export function validateLightLook(l: Record<string, unknown>, p: string, err: Report, warn: Report) {
  if (l.groundColor !== undefined) { if (!isColor(l.groundColor)) err(`${p}.groundColor`, "must be a colour like \"#303040\"."); else if (l.type !== "hemisphere") warn(`${p}.groundColor`, "only a hemisphere light has a ground colour."); }
  if (l.lookAt !== undefined) { if (!isVec3(l.lookAt)) err(`${p}.lookAt`, "must be [x, y, z] numbers."); else if (l.type !== "directional") warn(`${p}.lookAt`, "only a directional light is aimed (others light all around)."); }
  if (l.shadow !== undefined) {
    const why = optObj({
      mapSize: (x) => ([256, 512, 1024, 2048, 4096].includes(x as number) ? undefined : "must be 256, 512, 1024, 2048 or 4096."),
      bias: numCheck(-0.1, 0.1), normalBias: numCheck(0, 1), radius: numCheck(0, 25), area: numCheck(0.5, 500),
    }, `${p}.shadow`, err)(l.shadow);
    if (why) err(`${p}.shadow`, why);
    else if (l.shadow !== false && l.type !== "directional" && l.type !== "point") warn(`${p}.shadow`, "only directional and point lights cast shadows.");
  }
}

/** Problems with world.fog / sky / environment / post / export. `lights` are the world's lights (for sky.light). */
export function validateWorldLook(w: Record<string, unknown>, files: Record<string, unknown>, lights: Record<string, unknown>[], err: Report, warn: Report) {
  if (w.fog !== undefined) {
    if (!isObj(w.fog)) err("world.fog", "must be { type: \"linear\" | \"exp2\", color, near, far, density }.");
    else {
      fields(w.fog, "world.fog", err, { type: enumCheck(["linear", "exp2"]), color: colorCheck, near: numCheck(0), far: numCheck(0.01), density: numCheck(0, 1) });
      if (num(w.fog.near) && num(w.fog.far) && w.fog.far <= w.fog.near) warn("world.fog", "far is not beyond near, so the fog is full from near.");
    }
  }
  if (w.sky !== undefined) {
    if (!isObj(w.sky)) err("world.sky", "must be { elevation, azimuth, turbidity, rayleigh, mieCoefficient, mieDirectionalG, light }.");
    else {
      fields(w.sky, "world.sky", err, {
        elevation: numCheck(-90, 90), azimuth: numCheck(-360, 360), turbidity: numCheck(0, 20), rayleigh: numCheck(0, 4),
        mieCoefficient: numCheck(0, 0.1), mieDirectionalG: numCheck(0, 0.9999),
        light: (x) => (typeof x === "string" && x ? undefined : "must be the id of a directional light."),
      });
      const id = w.sky.light;
      if (typeof id === "string" && id) {
        const l = lights.find((x) => x.id === id);
        if (!l) err("world.sky.light", `There is no light "${id}".`);
        else if (l.type !== "directional") err("world.sky.light", `"${id}" is a ${String(l.type)} light; the sun drives a directional light.`);
      }
    }
  }
  if (w.environment !== undefined) {
    const e = w.environment;
    if (!isObj(e) || typeof e.file !== "string" || !e.file) err("world.environment", "must be { \"file\": \"<name>.hdr | .jpg | .png\", \"background\"?: true }.");
    else {
      fields(e, "world.environment", err, { file: () => undefined, background: (x) => (typeof x === "boolean" ? undefined : "must be true or false.") });
      if (typeof files[e.file] !== "string") warn("world.environment.file", `"${e.file}" is not in "files"; there is no environment map.`);
      else if (!/\.(hdr|jpe?g|png|webp)$/i.test(e.file)) warn("world.environment.file", `"${e.file}" is not a .hdr, .jpg, .png or .webp file; it may not load.`);
    }
  }
  if (w.post !== undefined) {
    if (!isObj(w.post)) err("world.post", "must be { toneMapping, exposure, contrast, saturation, lift, gamma, gain, vignette, grain, bloom, dof, ssao, aa }.");
    else fields(w.post, "world.post", err, {
      toneMapping: enumCheck(SCENE_TONE_MAPPINGS), exposure: numCheck(0, 8), contrast: numCheck(0, 3), saturation: numCheck(0, 3),
      lift: vecCheck(-1, 1), gamma: vecCheck(0.1, 5), gain: vecCheck(0, 4), vignette: numCheck(0, 1), grain: numCheck(0, 1),
      bloom: optObj({ strength: numCheck(0, 5), radius: numCheck(0, 1), threshold: numCheck(0, 2) }, "world.post.bloom", err),
      dof: optObj({ focus: numCheck(0.01, 500), aperture: numCheck(0, 0.2), maxblur: numCheck(0, 0.05) }, "world.post.dof", err),
      ssao: optObj({ radius: numCheck(0.01, 64), minDistance: numCheck(0, 1), maxDistance: numCheck(0, 1) }, "world.post.ssao", err),
      aa: enumCheck(SCENE_AAS),
    });
  }
  if (w.export !== undefined) {
    if (!isObj(w.export)) err("world.export", "must be { \"supersample\": 1 | 2 | 3 | 4 }.");
    else fields(w.export, "world.export", err, { supersample: (x) => ([1, 2, 3, 4].includes(x as number) ? undefined : "must be 1, 2, 3 or 4.") });
  }
}

/** Why an event's value does not fit a look call (undefined when it fits); `isTarget` checks an object id. */
export function lookValueProblem(c: SceneLookCall, v: unknown, isTarget: (id: string) => boolean): string | undefined {
  switch (c.kind) {
    case "number": return inRange(v, c.min, c.max) ? undefined : `must be a number ${rangeText(c.min, c.max)}`;
    case "color": return isColor(v) ? undefined : "must be a colour like \"#ffcc00\"";
    case "vec3": return isVec3(v) ? undefined : "must be [x, y, z] numbers";
    case "target": return isVec3(v) || (typeof v === "string" && isTarget(v)) ? undefined : "must be an object id or [x, y, z]";
  }
}

// ---------------------------------------------------------------- resolved values (the evaluator's output)

export interface SceneLightState {
  id?: string;
  type: string;
  color: string;
  intensity: number;
  position?: Vec3;
  /** Directional lights: the point they aim at. */
  target?: Vec3;
  groundColor?: string;
}
export interface ScenePostState {
  toneMapping: SceneToneMapping;
  exposure: number; contrast: number; saturation: number; lift: Vec3; gamma: Vec3; gain: Vec3; vignette: number; grain: number;
  bloom?: { strength: number; radius: number; threshold: number };
  dof?: { focus: number; aperture: number; maxblur: number };
  ssao?: { radius: number; minDistance: number; maxDistance: number };
  aa: SceneAA;
}
export interface SceneFogState { type: SceneFogType; color: string; near: number; far: number; density: number }
export interface SceneSkyState { elevation: number; azimuth: number; turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number; light?: string }

const pick = (v: unknown, d: number, min?: number, max?: number) => (inRange(v, min, max) ? (v as number) : d);
const sub = (v: unknown): Record<string, unknown> | undefined => (v === true ? {} : isObj(v) ? v : undefined);

/** The post settings from 0 s, with defaults filled in (undefined when the scene has no `world.post`). */
export function postBase(w: Record<string, unknown>): ScenePostState | undefined {
  const p = isObj(w.post) ? w.post : undefined;
  if (!p) return undefined;
  const v3 = (v: unknown, d: Vec3, min: number, max: number): Vec3 => (isVec3(v) && v.every((c) => c >= min && c <= max) ? [v[0], v[1], v[2]] : d);
  const bloom = sub(p.bloom), dof = sub(p.dof), ssao = sub(p.ssao);
  return {
    toneMapping: SCENE_TONE_MAPPINGS.includes(p.toneMapping as SceneToneMapping) ? p.toneMapping as SceneToneMapping : isObj(w.sky) ? "aces" : "none",
    exposure: pick(p.exposure, 1, 0, 8), contrast: pick(p.contrast, 1, 0, 3), saturation: pick(p.saturation, 1, 0, 3),
    lift: v3(p.lift, [0, 0, 0], -1, 1), gamma: v3(p.gamma, [1, 1, 1], 0.1, 5), gain: v3(p.gain, [1, 1, 1], 0, 4),
    vignette: pick(p.vignette, 0, 0, 1), grain: pick(p.grain, 0, 0, 1),
    ...(bloom ? { bloom: { strength: pick(bloom.strength, 0.6, 0, 5), radius: pick(bloom.radius, 0.4, 0, 1), threshold: pick(bloom.threshold, 0.85, 0, 2) } } : {}),
    ...(dof ? { dof: { focus: pick(dof.focus, 6, 0.01, 500), aperture: pick(dof.aperture, 0.01, 0, 0.2), maxblur: pick(dof.maxblur, 0.01, 0, 0.05) } } : {}),
    ...(ssao ? { ssao: { radius: pick(ssao.radius, 0.5, 0.01, 64), minDistance: pick(ssao.minDistance, 0.001, 0, 1), maxDistance: pick(ssao.maxDistance, 0.1, 0, 1) } } : {}),
    aa: SCENE_AAS.includes(p.aa as SceneAA) ? p.aa as SceneAA : "fxaa",
  };
}
export function fogBase(w: Record<string, unknown>, background: string): SceneFogState | undefined {
  const f = isObj(w.fog) ? w.fog : undefined;
  if (!f) return undefined;
  return { type: f.type === "exp2" ? "exp2" : "linear", color: isColor(f.color) ? f.color : background, near: pick(f.near, 10, 0), far: pick(f.far, 60, 0.01), density: pick(f.density, 0.03, 0, 1) };
}
export function skyBase(w: Record<string, unknown>): SceneSkyState | undefined {
  const s = isObj(w.sky) ? w.sky : undefined;
  if (!s) return undefined;
  return {
    elevation: pick(s.elevation, 20, -90, 90), azimuth: pick(s.azimuth, 180, -360, 360), turbidity: pick(s.turbidity, 8, 0, 20), rayleigh: pick(s.rayleigh, 2, 0, 4),
    mieCoefficient: pick(s.mieCoefficient, 0.005, 0, 0.1), mieDirectionalG: pick(s.mieDirectionalG, 0.8, 0, 0.9999),
    ...(typeof s.light === "string" && s.light ? { light: s.light } : {}),
  };
}

/** Unit vector towards the sun (y up; azimuth 0 = +z, 90 = +x). */
export function sunDirection(elevation: number, azimuth: number): Vec3 {
  const e = (elevation * Math.PI) / 180, a = (azimuth * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}
/** How far from its target the sun's directional light sits (inside the shadow camera's range). */
export const SUN_DISTANCE = 30;

/** Set a dotted property ("bloom.strength") in a resolved post / fog / sky state. */
export function setLookProp(state: Record<string, unknown>, prop: string, v: unknown) {
  const [a, b] = prop.split(".");
  if (b === undefined) state[a] = v;
  else if (isObj(state[a])) state[a] = { ...(state[a] as Record<string, unknown>), [b]: v };
}
export function getLookProp(state: Record<string, unknown>, prop: string): unknown {
  const [a, b] = prop.split(".");
  return b === undefined ? state[a] : isObj(state[a]) ? (state[a] as Record<string, unknown>)[b] : undefined;
}

/** What the scene page is built from for the look (the values arrive per frame): used by its page key. */
export function lookStructure(w: unknown, objects: unknown): unknown {
  const world = isObj(w) ? w : {};
  const post = isObj(world.post) ? world.post : undefined;
  return [
    post ? [post.toneMapping ?? null, post.aa ?? null, !!sub(post.bloom), !!sub(post.dof), !!sub(post.ssao)] : null,
    isObj(world.fog) ? world.fog.type ?? "linear" : null,
    isObj(world.sky) ? 1 : 0,
    isObj(world.environment) ? world.environment : null,
    Array.isArray(objects) ? objects.map((o) => (isObj(o) ? o.material ?? null : null)) : null,
  ];
}

/** Ease names are shared with object events. */
export type { SceneEase };
