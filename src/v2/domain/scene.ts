/**
 * Scene documents (`dionysus.scene/1`, P74, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 2 step 2.1): a 3D world as JSON,
 * stored as the version blob of a `scene` asset (decision 2). Pure: no DOM, no three.js.
 *
 * - `validateScene(raw)` / `parseScene(text)`: errors and warnings with JSON paths, like the storyboard importer.
 * - `stateAt(doc, t)`: the state of every object and the camera at clip-local second `t`, computed from the document
 *   alone (no state carried between frames), so any seek in any order, preview and export give the same frame.
 *
 * Event model: events are stable-sorted by `at` (array order breaks ties). Each event sets or (with `dur`) tweens one
 * or more properties of one object. For one property the event that started last wins from its start; an earlier
 * tween still running is cut there and the new one starts from the value it had reached. Different properties never
 * conflict. `moveTo` and `position` are the same property; `lookAt` and `rotation` are the same property.
 * Custom functions are declarative (decision 4): typed params plus a `set` map and/or a `states` table that name base
 * properties; a call expands into those properties and tweens like a base call.
 *
 * GLB models (P75, step 2.2): an object with `model` names a file of the document's `files` map (data: URLs, like an
 * HTML clip package). Its animation is one more property: `animation` on the object (from 0 s), the base functions
 * `play` / `stop`, or `animation` in a custom function's row. The evaluator gives, per model object, the clips that
 * play at `t` with their local time (`(t - at) × speed + from`, unwrapped: the page loops or clamps it with the clip's
 * length) and weight (a cross-fade over `fade` seconds is computed from `t` too). Nothing is carried between frames.
 *
 * Script objects (P82): an object with `script: { file, params? }` is built by JavaScript in the document's `files`
 * (domain/sceneScriptCode.ts: `build(THREE, params, ctx)` returns a THREE.Object3D, an optional `update(obj, t, …)`
 * sets it from scene time alone). Its base properties (position, rotation, scale, visible, opacity) and events work as
 * for any object; the script runs only in the sandboxed scene page, and a script that fails draws the object's shape.
 */
import { checkParamValue, cleanParamDecls, validateParamDecls, type HtmlClipParam, type HtmlParamValue } from "./htmlClipPackage";
import { glbInfoOfDataUrl } from "./glb";
import { scriptCodeOf, scriptParamsProblem, scriptProblems, type SceneScriptParams } from "./sceneScriptCode";
import {
  fogBase, getLookProp, lookValueProblem, postBase, SCENE_LOOK_CALLS, SCENE_LOOK_IDS, setLookProp, skyBase, SUN_DISTANCE, sunDirection,
  validateLightLook, validateMaterial, validateWorldLook,
  type SceneEnvironment, type SceneExport, type SceneFog, type SceneFogState, type SceneLightState, type SceneLookTarget, type SceneMaterial,
  type SceneMaterialType, type ScenePost, type ScenePostState, type SceneShadow, type SceneSky, type SceneSkyState,
} from "./sceneLook";

export const SCENE_FORMAT = "dionysus.scene/1" as const;
/** MIME type of a scene asset version's blob. */
export const SCENE_MIME = "application/vnd.dionysus.scene+json";
/** The reserved object id for the camera in events (`position` / `moveTo`, `lookAt`, `fov`). */
export const SCENE_CAMERA = "camera";

export type Vec3 = [number, number, number];
export type SceneShape = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane";
export const SCENE_SHAPES: readonly SceneShape[] = ["box", "sphere", "cylinder", "cone", "torus", "plane"];
export type SceneLightType = "ambient" | "hemisphere" | "directional" | "point";
export const SCENE_LIGHTS: readonly SceneLightType[] = ["ambient", "hemisphere", "directional", "point"];

/**
 * A light. P81b: an optional `id` names it (unique among objects and lights, not "camera") so the editor and agents can
 * refer to it. Scene Phase 1 (#350): a light with an id takes events (intensity, color, position / moveTo, lookAt);
 * `groundColor` (hemisphere), `lookAt` (where a directional light aims, default the origin) and `shadow` (directional
 * and point lights: true or { mapSize, bias, normalBias, radius, area }).
 */
export interface SceneLight { id?: string; type: SceneLightType; color?: string; intensity?: number; position?: Vec3; groundColor?: string; lookAt?: Vec3; shadow?: boolean | SceneShadow }
export interface SceneCamera { fov?: number; position?: Vec3; lookAt?: Vec3 }
/** Scene Phase 1 (#350): fog, sky, environment, post and export are optional (domain/sceneLook.ts). */
export interface SceneWorld { background?: string; camera?: SceneCamera; lights?: SceneLight[]; fog?: SceneFog; sky?: SceneSky; environment?: SceneEnvironment; post?: ScenePost; export?: SceneExport }

/** Base properties every object has (the evaluator's output per object). */
export interface SceneProps { position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean; opacity: number; color: string }
export type ScenePropName = keyof SceneProps;
export const SCENE_PROPS: readonly ScenePropName[] = ["position", "rotation", "scale", "visible", "opacity", "color"];

/** How a model's animation clip repeats: `repeat` (default), `once` (holds the last pose) or `pingpong`. */
export type SceneLoop = "repeat" | "once" | "pingpong";
export const SCENE_LOOPS: readonly SceneLoop[] = ["repeat", "once", "pingpong"];
/** A GLB animation clip to play: by name (as in the file), with speed (≥ 0), loop mode and start offset (seconds). */
export interface SceneAnimation { clip: string; speed?: number; loop?: SceneLoop; from?: number }
/** One clip playing at `t` (per model object): its unwrapped local time in seconds and its blend weight (0–1). */
export interface SceneAnimState { clip: string; time: number; loop: SceneLoop; weight: number }

/**
 * A function row may also set `animation` (a clip name, "$param" or { clip, speed, loop, from }; it fades over the
 * event's `dur`) and `nodes` (model parts by node name → shown or hidden; switches at `at`).
 */
export type SceneRowKey = ScenePropName | "animation" | "nodes";
/** A declarative custom function: typed params; `set` maps properties to constants or "$param"; `states` picks a row by a param's value. */
export interface SceneFunction {
  params?: Record<string, HtmlClipParam>;
  set?: Partial<Record<SceneRowKey, unknown>>;
  states?: { param: string; table: Record<string, Partial<Record<SceneRowKey, unknown>>> };
  description?: string;
}

export interface SceneObject {
  id: string;
  /** Primitive shape (default box). `size`: box [w,h,d] or one number; sphere radius; cylinder/cone [radius, height]; torus [radius, tube]; plane [w,h]. */
  shape?: SceneShape;
  size?: number | number[];
  /**
   * A GLB model: the name of a file in the document's `files` (P75). With a number `size` the model is scaled so its
   * largest side is `size` units, centred on x/z and standing on y = 0; without, it keeps the file's units. A missing
   * or broken file draws the object's shape (a box by default) with a warning.
   */
  model?: string;
  /** The model's animation from 0 s: a clip name or { clip, speed, loop, from }. */
  animation?: string | SceneAnimation;
  /** Parts of the model shown (true) or hidden (false) from 0 s, by node name; unnamed parts keep the file's setting. */
  nodes?: Record<string, boolean>;
  /**
   * P82: a Script object: `file` names a JavaScript file in `files` (see domain/sceneScriptCode.ts) and `params` are
   * the values its build / update get. Not with `model`. A missing or failing script draws the object's shape.
   */
  script?: SceneScript;
  name?: string;
  color?: string;
  position?: Vec3;
  /** Degrees, XYZ order. */
  rotation?: Vec3;
  scale?: number | Vec3;
  visible?: boolean;
  opacity?: number;
  /**
   * Scene Phase 1 (#350): how it is shaded: "standard" (default for shapes), "toon", "unlit", "keep" (a model's or
   * script's own materials, their default), or { type, steps, roughness, metalness, emissive, emissiveIntensity,
   * outline, rim } (domain/sceneLook.ts). A Script object opts in by having one.
   */
  material?: SceneMaterialType | SceneMaterial;
  functions?: Record<string, SceneFunction>;
}

/** P82: a Script object's code file and param values. */
export interface SceneScript { file: string; params?: SceneScriptParams }

export const SCENE_EASES = ["linear", "in", "out", "inOut", "inCubic", "outCubic", "inOutCubic", "inQuad", "outQuad", "inOutQuad", "inOutSine", "outBack"] as const;
export type SceneEase = (typeof SCENE_EASES)[number];

export interface SceneEvent { at: number; obj: string; call: string; args?: Record<string, unknown>; dur?: number; ease?: SceneEase }

export interface SceneDoc {
  format: typeof SCENE_FORMAT;
  name?: string;
  /** Suggested clip length when the scene is added to the timeline (seconds). */
  durationSec?: number;
  world?: SceneWorld;
  objects: SceneObject[];
  events?: SceneEvent[];
  /** Embedded files by name (P75): GLB models as data: URLs, stored in the scene asset's version like an HTML clip package. */
  files?: Record<string, string>;
}

export interface SceneIssue { level: "error" | "warning"; path: string; message: string }

/** The base functions every object has, with the property each writes. */
export const SCENE_BASE_FUNCTIONS: Record<string, { prop: SceneRowKey | "target" | "fov"; arg: string; description: string }> = {
  position: { prop: "position", arg: "value", description: "Move to [x, y, z] (a tween with dur)." },
  moveTo: { prop: "position", arg: "position", description: "Same as position; the argument is named position." },
  rotation: { prop: "rotation", arg: "value", description: "Rotate to [x, y, z] degrees." },
  lookAt: { prop: "rotation", arg: "target", description: "Turn to face an object id or a point [x, y, z] (evaluated where both are when the event ends)." },
  scale: { prop: "scale", arg: "value", description: "Scale to a number or [x, y, z]." },
  visible: { prop: "visible", arg: "value", description: "Show (true) or hide (false). Never tweens." },
  opacity: { prop: "opacity", arg: "value", description: "Opacity 0–1." },
  color: { prop: "color", arg: "value", description: "Material colour \"#rrggbb\" (shapes only; a model keeps its own materials)." },
  play: { prop: "animation", arg: "clip", description: "Models: play an animation clip by name; optional speed, loop (repeat/once/pingpong), from (s) and fade (s, else dur)." },
  stop: { prop: "animation", arg: "fade", description: "Models: stop the animation (back to the rest pose), fading over fade (s, else dur)." },
  nodes: { prop: "nodes", arg: "value", description: "Models: show or hide parts by node name, e.g. { \"Hat\": false }. Never tweens." },
};
/** Functions of the reserved `camera` object. */
export const SCENE_CAMERA_FUNCTIONS: Record<string, { prop: "position" | "target" | "fov"; arg: string }> = {
  position: { prop: "position", arg: "value" },
  moveTo: { prop: "position", arg: "position" },
  lookAt: { prop: "target", arg: "target" },
  fov: { prop: "fov", arg: "value" },
};

// ---------------------------------------------------------------- easing

const backC = 1.70158;
/** Named easings (0..1 → 0..1). */
export const SCENE_EASE: Record<SceneEase, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + (backC + 1) * (x - 1) ** 3 + backC * (x - 1) ** 2,
};

// ---------------------------------------------------------------- small checks

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(num);
const HEX_RE = /^#[0-9a-f]{6}$/i;
export const isSceneColor = (v: unknown): v is string => typeof v === "string" && HEX_RE.test(v);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Problem with a value for a base property, or undefined when it fits. */
function propProblem(prop: ScenePropName, v: unknown): string | undefined {
  switch (prop) {
    case "position": case "rotation": return isVec3(v) ? undefined : "must be [x, y, z] numbers";
    case "scale": return (num(v) && v > 0) || (isVec3(v) && v.every((x) => x > 0)) ? undefined : "must be a number or [x, y, z] above 0";
    case "visible": return typeof v === "boolean" ? undefined : "must be true or false";
    case "opacity": return num(v) && v >= 0 && v <= 1 ? undefined : "must be a number from 0 to 1";
    case "color": return isSceneColor(v) ? undefined : "must be a colour like \"#ffcc00\"";
  }
}

/** A clip name or { clip, speed, loop, from } as a normalised animation, or a problem. */
function animOf(v: unknown): { anim?: Required<SceneAnimation>; problem?: string } {
  const spec = typeof v === "string" ? { clip: v } : v;
  if (!isObj(spec) || typeof spec.clip !== "string" || !spec.clip) return { problem: "must be a clip name or { \"clip\": name, \"speed\", \"loop\", \"from\" }" };
  if (spec.speed !== undefined && !(num(spec.speed) && spec.speed >= 0)) return { problem: "has a speed that is not a number ≥ 0" };
  if (spec.loop !== undefined && !(SCENE_LOOPS as readonly string[]).includes(String(spec.loop))) return { problem: `has a loop that is not one of ${SCENE_LOOPS.join(", ")}` };
  if (spec.from !== undefined && !(num(spec.from) && spec.from >= 0)) return { problem: "has a from that is not a number of seconds ≥ 0" };
  return { anim: { clip: spec.clip, speed: num(spec.speed) ? spec.speed : 1, loop: (spec.loop as SceneLoop | undefined) ?? "repeat", from: num(spec.from) ? spec.from : 0 } };
}
const nodesProblem = (v: unknown): string | undefined =>
  isObj(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === "boolean") ? undefined : "must be an object of node name → true or false";
const rowProblem = (k: SceneRowKey, v: unknown): string | undefined => (k === "animation" ? animOf(v).problem : k === "nodes" ? nodesProblem(v) : propProblem(k, v));
const ROW_KEYS: readonly string[] = [...SCENE_PROPS, "animation", "nodes"];
const MODEL_KEYS: readonly string[] = ["animation", "nodes"];
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,127}$/;

/** Animation clip names of a model object's GLB (undefined when the file is missing or not a readable GLB). */
export function modelAnimations(doc: Pick<SceneDoc, "files">, model: string | undefined): string[] | undefined {
  const url = model && isObj(doc.files) ? doc.files[model] : undefined;
  return typeof url === "string" ? glbInfoOfDataUrl(url)?.animations.map((a) => a.name) : undefined;
}
/** Node names of a model object's GLB (undefined when unknown). */
export function modelNodes(doc: Pick<SceneDoc, "files">, model: string | undefined): string[] | undefined {
  const url = model && isObj(doc.files) ? doc.files[model] : undefined;
  return typeof url === "string" ? glbInfoOfDataUrl(url)?.nodeNames : undefined;
}
/** Warn when a model's GLB is readable and has no node of a name. */
function nodeWarnings(doc: SceneDoc, model: string, v: unknown, path: string, warn: (path: string, m: string) => void) {
  const names = modelNodes(doc, model);
  if (names && isObj(v)) for (const k of Object.keys(v)) if (!names.includes(k)) warn(`${path}.${k}`, `"${model}" has no node "${k}".`);
}

const sizeOk = (shape: SceneShape, v: unknown): boolean => {
  if (num(v)) return v > 0;
  if (!Array.isArray(v) || !v.every((x) => num(x) && x > 0)) return false;
  const n = shape === "box" ? 3 : shape === "sphere" ? 1 : 2;
  return v.length === n || (shape === "box" && v.length === 1);
};

// ---------------------------------------------------------------- validation

/**
 * Validate a parsed scene document. Errors make the document unusable in that place (the evaluator skips the bad
 * event or field); warnings are allowed (overlapping tweens of one property, models not drawn yet, …).
 */
export function validateScene(raw: unknown): SceneIssue[] {
  const out: SceneIssue[] = [];
  const err = (path: string, message: string) => out.push({ level: "error", path, message });
  const warn = (path: string, message: string) => out.push({ level: "warning", path, message });
  if (!isObj(raw)) { err("", "A scene must be a JSON object."); return out; }
  if (raw.format !== SCENE_FORMAT) err("format", `"format" must be "${SCENE_FORMAT}".`);
  if (raw.name !== undefined && typeof raw.name !== "string") err("name", "\"name\" must be a string.");
  if (raw.durationSec !== undefined && !(num(raw.durationSec) && raw.durationSec > 0)) err("durationSec", "\"durationSec\" must be a number above 0.");
  const files = isObj(raw.files) ? raw.files : {};
  if (raw.files !== undefined) {
    if (!isObj(raw.files)) err("files", "\"files\" must be an object of file name → data: URL.");
    else for (const [n, d] of Object.entries(raw.files)) {
      if (!FILE_RE.test(n)) err(`files.${n}`, "File names use letters, digits, spaces, \"_\", \"-\", \".\" and brackets.");
      if (typeof d !== "string" || !/^data:[^,]*,/.test(d)) err(`files.${n}`, "must be a data: URL.");
    }
  }
  // world
  const lightIds = new Map<string, number>();
  if (raw.world !== undefined) {
    const w = raw.world;
    if (!isObj(w)) err("world", "\"world\" must be an object.");
    else {
      if (w.background !== undefined && !isSceneColor(w.background)) err("world.background", "must be a colour like \"#101018\".");
      if (w.camera !== undefined) {
        const c = w.camera;
        if (!isObj(c)) err("world.camera", "must be an object.");
        else {
          if (c.fov !== undefined && !(num(c.fov) && c.fov > 1 && c.fov < 179)) err("world.camera.fov", "must be a number of degrees between 1 and 179.");
          for (const k of ["position", "lookAt"] as const) if (c[k] !== undefined && !isVec3(c[k])) err(`world.camera.${k}`, "must be [x, y, z] numbers.");
        }
      }
      if (w.lights !== undefined) {
        if (!Array.isArray(w.lights)) err("world.lights", "must be a list.");
        else w.lights.forEach((l, i) => {
          const p = `world.lights[${i}]`;
          if (!isObj(l)) { err(p, "must be an object."); return; }
          if (!(SCENE_LIGHTS as readonly string[]).includes(String(l.type))) err(`${p}.type`, `must be one of ${SCENE_LIGHTS.map((x) => `"${x}"`).join(", ")}.`);
          if (l.color !== undefined && !isSceneColor(l.color)) err(`${p}.color`, "must be a colour like \"#ffffff\".");
          if (l.intensity !== undefined && !(num(l.intensity) && l.intensity >= 0)) err(`${p}.intensity`, "must be a number ≥ 0.");
          if (l.position !== undefined && !isVec3(l.position)) err(`${p}.position`, "must be [x, y, z] numbers.");
          validateLightLook(l, p, err, warn);
          if (l.id !== undefined) {
            if (typeof l.id !== "string" || !ID_RE.test(l.id)) err(`${p}.id`, "must start with a letter and use letters, digits, \"_\" or \"-\".");
            else if (l.id === SCENE_CAMERA) err(`${p}.id`, `"${SCENE_CAMERA}" is reserved for the camera.`);
            else if (lightIds.has(l.id)) err(`${p}.id`, `"${l.id}" is used twice.`);
            else lightIds.set(l.id, i);
          }
        });
      }
      validateWorldLook(w, files, Array.isArray(w.lights) ? w.lights.filter(isObj) : [], err, warn);
    }
  }
  // objects
  const objects = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(raw.objects)) err("objects", "\"objects\" must be a list.");
  else raw.objects.forEach((o, i) => {
    const p = `objects[${i}]`;
    if (!isObj(o)) { err(p, "must be an object."); return; }
    const id = o.id;
    if (typeof id !== "string" || !ID_RE.test(id)) err(`${p}.id`, "needs an \"id\" that starts with a letter and uses letters, digits, \"_\" or \"-\".");
    else if (id === SCENE_CAMERA) err(`${p}.id`, `"${SCENE_CAMERA}" is reserved for the camera.`);
    else if (objects.has(id)) err(`${p}.id`, `"${id}" is used twice.`);
    else {
      // An object with a light's id is an error, but it is still an object (its events are checked as usual).
      if (lightIds.has(id)) err(`${p}.id`, `"${id}" is the id of a light (world.lights[${lightIds.get(id)}]).`);
      objects.set(id, o);
    }
    const shape = (o.shape ?? "box") as SceneShape;
    if (!SCENE_SHAPES.includes(shape)) err(`${p}.shape`, `must be one of ${SCENE_SHAPES.map((x) => `"${x}"`).join(", ")}.`);
    else if (o.size !== undefined && !sizeOk(shape, o.size)) err(`${p}.size`, `has the wrong form for a ${shape}.`);
    const fallback = SCENE_SHAPES.includes(shape) ? shape : "box";
    if (o.model !== undefined) {
      if (typeof o.model !== "string" || !o.model) err(`${p}.model`, "must be a file name.");
      else if (typeof files[o.model] !== "string") warn(`${p}.model`, `"${o.model}" is not in "files"; the object is drawn as a ${fallback}.`);
      else if (!/\.(glb|gltf)$/i.test(o.model)) warn(`${p}.model`, `"${o.model}" is not a .glb or .gltf file; it may not load (then a ${fallback} is drawn).`);
      else if (/\.glb$/i.test(o.model) && !glbInfoOfDataUrl(files[o.model] as string)) warn(`${p}.model`, `"${o.model}" is not a readable GLB; the object is drawn as a ${fallback}.`);
    }
    if (o.animation !== undefined) {
      const a = animOf(o.animation);
      if (a.problem) err(`${p}.animation`, `${a.problem}.`);
      else if (typeof o.model !== "string") err(`${p}.animation`, "only a model object (with \"model\") has animations.");
      else clipWarning(raw as unknown as SceneDoc, o.model, a.anim!.clip, `${p}.animation`, warn);
    }
    if (o.nodes !== undefined) {
      const why = nodesProblem(o.nodes);
      if (why) err(`${p}.nodes`, `${why}.`);
      else if (typeof o.model !== "string") err(`${p}.nodes`, "only a model object (with \"model\") has nodes.");
      else nodeWarnings(raw as unknown as SceneDoc, o.model, o.nodes, `${p}.nodes`, warn);
    }
    if (o.script !== undefined) {
      const sc = o.script;
      if (!isObj(sc) || typeof sc.file !== "string" || !sc.file) err(`${p}.script`, "must be { \"file\": \"<name>.js\", \"params\"?: { name: value } }.");
      else {
        if (o.model !== undefined) err(`${p}.script`, "An object has a model or a script, not both.");
        const data = files[sc.file];
        if (typeof data !== "string") warn(`${p}.script.file`, `"${sc.file}" is not in "files"; the object is drawn as a ${fallback}.`);
        else {
          const code = scriptCodeOf(data);
          if (code === undefined) err(`${p}.script.file`, `"${sc.file}" can't be read as text (a data: URL of UTF-8 JavaScript).`);
          else for (const m of scriptProblems(code)) err(`${p}.script.file`, m);
        }
        if (sc.params !== undefined) { const why = scriptParamsProblem(sc.params); if (why) err(`${p}.script.params`, `${why}.`); }
        for (const k of Object.keys(sc)) if (k !== "file" && k !== "params") err(`${p}.script.${k}`, "is not a script field (file, params).");
      }
    }
    if (o.name !== undefined && typeof o.name !== "string") err(`${p}.name`, "must be a string.");
    if (o.material !== undefined) validateMaterial(o.material, `${p}.material`, err);
    if (typeof id === "string" && SCENE_LOOK_IDS.includes(id) && isObj(raw.world) && raw.world[id] !== undefined)
      warn(`${p}.id`, `An object is called "${id}", so events on "${id}" change the object, not world.${id}; rename the object to animate world.${id}.`);
    for (const prop of SCENE_PROPS) if (o[prop] !== undefined) { const why = propProblem(prop, o[prop]); if (why) err(`${p}.${prop}`, `${why}.`); }
    if (o.functions !== undefined) {
      if (!isObj(o.functions)) err(`${p}.functions`, "must be an object of function name → { params, set, states }.");
      else for (const [fn, f] of Object.entries(o.functions)) validateFunction(f, fn, `${p}.functions.${fn}`, err, typeof o.model === "string" ? o.model : undefined, raw as unknown as SceneDoc, warn);
    }
  });
  // events
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) err("events", "\"events\" must be a list.");
    else {
      raw.events.forEach((e, i) => validateEvent(e, `events[${i}]`, objects, err, raw as unknown as SceneDoc, warn));
      overlapWarnings(raw as unknown as SceneDoc, warn);
    }
  }
  return out;
}

/** Warn when a model's GLB is readable and has no clip of that name. */
function clipWarning(doc: SceneDoc, model: string, clip: string, path: string, warn: (path: string, m: string) => void) {
  const names = modelAnimations(doc, model);
  if (names && !names.includes(clip)) warn(path, names.length ? `"${model}" has no animation "${clip}" (it has ${names.map((n) => `"${n}"`).join(", ")}).` : `"${model}" has no animations.`);
}

function validateFunction(f: unknown, name: string, p: string, err: (path: string, m: string) => void, model?: string, doc?: SceneDoc, warn?: (path: string, m: string) => void) {
  if (!ID_RE.test(name)) err(p, `Function name "${name}" must start with a letter and use letters, digits, "_" or "-".`);
  if (SCENE_BASE_FUNCTIONS[name]) err(p, `"${name}" is a base function; pick another name.`);
  if (!isObj(f)) { err(p, "must be an object { params, set, states }."); return; }
  const params = f.params === undefined ? {} : f.params;
  if (f.params !== undefined) for (const i of validateParamDecls(f.params)) err(`${p}.params`, i.message);
  const decls = cleanParamDecls(params);
  const checkRow = (row: unknown, rp: string) => {
    if (!isObj(row)) { err(rp, "must be an object of property → value."); return; }
    for (const [k, v] of Object.entries(row)) {
      if (!ROW_KEYS.includes(k)) { err(`${rp}.${k}`, `is not a property (${ROW_KEYS.join(", ")}).`); continue; }
      if (MODEL_KEYS.includes(k) && !model) { err(`${rp}.${k}`, `only a model object (with "model") has ${k === "nodes" ? "nodes" : "animations"}.`); continue; }
      if (k === "nodes" && typeof v === "string") { err(`${rp}.${k}`, "must be an object of node name → true or false (not a param)."); continue; }
      if (typeof v === "string" && v.startsWith("$")) { if (!decls[v.slice(1)]) err(`${rp}.${k}`, `names an undeclared param "${v.slice(1)}".`); continue; }
      const why = rowProblem(k as SceneRowKey, v); if (why) { err(`${rp}.${k}`, `${why}.`); continue; }
      if (k === "animation" && model && doc && warn) clipWarning(doc, model, animOf(v).anim!.clip, `${rp}.${k}`, warn);
      if (k === "nodes" && model && doc && warn) nodeWarnings(doc, model, v, `${rp}.${k}`, warn);
    }
  };
  if (f.set !== undefined) checkRow(f.set, `${p}.set`);
  if (f.states !== undefined) {
    const s = f.states;
    if (!isObj(s) || typeof s.param !== "string" || !isObj(s.table)) err(`${p}.states`, "must be { \"param\": \"<param>\", \"table\": { \"<value>\": { property: value } } }.");
    else {
      const d = decls[s.param];
      if (!d) err(`${p}.states.param`, `names an undeclared param "${s.param}".`);
      else if (d.type !== "select") err(`${p}.states.param`, `"${s.param}" must be a select param.`);
      for (const [k, row] of Object.entries(s.table)) {
        if (d?.type === "select" && !d.options?.includes(k)) err(`${p}.states.table.${k}`, `"${k}" is not an option of "${s.param}".`);
        checkRow(row, `${p}.states.table.${k}`);
      }
    }
  }
  if (f.set === undefined && f.states === undefined) err(p, "needs \"set\" or \"states\" (what the function changes).");
  if (f.description !== undefined && typeof f.description !== "string") err(`${p}.description`, "must be a string.");
}

function validateEvent(e: unknown, p: string, objects: Map<string, Record<string, unknown>>, err: (path: string, m: string) => void, doc: SceneDoc, warn: (path: string, m: string) => void) {
  if (!isObj(e)) { err(p, "must be an object { at, obj, call, args, dur, ease }."); return; }
  if (!num(e.at) || e.at < 0) err(`${p}.at`, "must be a number of seconds ≥ 0.");
  if (e.dur !== undefined && !(num(e.dur) && e.dur >= 0)) err(`${p}.dur`, "must be a number of seconds ≥ 0.");
  if (e.ease !== undefined && !(SCENE_EASES as readonly string[]).includes(String(e.ease))) err(`${p}.ease`, `must be one of ${SCENE_EASES.join(", ")}.`);
  if (e.args !== undefined && !isObj(e.args)) { err(`${p}.args`, "must be an object."); return; }
  const args = (e.args ?? {}) as Record<string, unknown>;
  if (typeof e.obj !== "string") { err(`${p}.obj`, "must be an object id."); return; }
  if (typeof e.call !== "string") { err(`${p}.call`, "must be a function name."); return; }
  if (e.obj === SCENE_CAMERA) {
    const f = SCENE_CAMERA_FUNCTIONS[e.call];
    if (!f) { err(`${p}.call`, `The camera has no function "${e.call}" (${Object.keys(SCENE_CAMERA_FUNCTIONS).join(", ")}).`); return; }
    const v = args[f.arg] ?? (f.arg === "position" ? args.value : undefined);
    if (f.prop === "fov") { if (!(num(v) && v > 1 && v < 179)) err(`${p}.args.${f.arg}`, "must be degrees between 1 and 179."); }
    else if (f.prop === "target") { if (!isVec3(v) && !(typeof v === "string" && objects.has(v))) err(`${p}.args.target`, "must be an object id or [x, y, z]."); }
    else if (!isVec3(v)) err(`${p}.args.${f.arg}`, "must be [x, y, z] numbers.");
    return;
  }
  const o = objects.get(e.obj);
  if (!o) {
    const look = lookTargetOf(doc, e.obj);
    if (look) { validateLookEvent(doc, e as unknown as SceneEvent, look.kind, args, p, objects, err, warn); return; }
    err(`${p}.obj`, `There is no object "${e.obj}".`);
    return;
  }
  const base = SCENE_BASE_FUNCTIONS[e.call];
  if (base) {
    const v = args[base.arg] ?? (base.arg === "position" ? args.value : undefined);
    if (e.call === "lookAt") { if (!isVec3(v) && !(typeof v === "string" && objects.has(v) && v !== e.obj)) err(`${p}.args.target`, "must be another object id or [x, y, z]."); }
    else if (base.prop === "nodes") {
      if (typeof o.model !== "string") { err(`${p}.call`, `"${e.obj}" has no model, so it has no nodes.`); return; }
      const why = nodesProblem(v); if (why) err(`${p}.args.value`, `${why}.`); else nodeWarnings(doc, o.model, v, `${p}.args.value`, warn);
    }
    else if (base.prop === "animation") {
      if (typeof o.model !== "string") { err(`${p}.call`, `"${e.obj}" has no model, so it can't ${e.call} an animation.`); return; }
      if (args.fade !== undefined && !(num(args.fade) && args.fade >= 0)) err(`${p}.args.fade`, "must be a number of seconds ≥ 0.");
      if (e.call === "play") {
        const a = animOf({ clip: args.clip, speed: args.speed, loop: args.loop, from: args.from });
        if (a.problem) err(`${p}.args`, `${a.problem}.`);
        else clipWarning(doc, o.model, a.anim!.clip, `${p}.args.clip`, warn);
      }
    }
    else { const why = propProblem(base.prop as ScenePropName, v); if (why) err(`${p}.args.${base.arg}`, `${why}.`); }
    return;
  }
  const fns = isObj(o.functions) ? o.functions : {};
  const f = fns[e.call];
  if (!isObj(f)) { err(`${p}.call`, `"${e.obj}" has no function "${e.call}" (base: ${Object.keys(SCENE_BASE_FUNCTIONS).join(", ")}${Object.keys(fns).length ? `; declared: ${Object.keys(fns).join(", ")}` : ""}).`); return; }
  const decls = cleanParamDecls(f.params ?? {});
  for (const [k, v] of Object.entries(args)) {
    const d = decls[k];
    if (!d) { err(`${p}.args.${k}`, `"${e.call}" has no param "${k}".`); continue; }
    const c = checkParamValue(d, v);
    if (c.value === undefined || c.clamped) err(`${p}.args.${k}`, c.problem ?? "has the wrong type.");
  }
}

/** Scene Phase 1 (#350): an event on a light, "post", "fog" or "sky". */
function validateLookEvent(doc: SceneDoc, e: SceneEvent, kind: SceneLookTarget, args: Record<string, unknown>, p: string, objects: Map<string, Record<string, unknown>>, err: (path: string, m: string) => void, warn: (path: string, m: string) => void) {
  const calls = SCENE_LOOK_CALLS[kind];
  const c = calls[e.call];
  const what = kind === "light" ? `The light "${e.obj}"` : `"${e.obj}"`;
  if (!c) { err(`${p}.call`, `${what} has no function "${e.call}" (${Object.keys(calls).join(", ")}).`); return; }
  for (const k of Object.keys(args)) if (k !== c.arg && !(c.arg === "position" && k === "value")) err(`${p}.args.${k}`, `"${e.call}" takes "${c.arg}" only.`);
  const v = args[c.arg] ?? (c.arg === "position" ? args.value : undefined);
  const why = lookValueProblem(c, v, (id) => objects.has(id));
  if (why) { err(`${p}.args.${c.arg}`, `${why}.`); return; }
  const w = isObj(doc.world) ? doc.world : {};
  if (kind === "light") {
    const l = (Array.isArray(w.lights) ? w.lights : []).find((x) => isObj(x) && x.id === e.obj);
    const type = l?.type;
    if (c.prop === "position" && type !== "directional" && type !== "point") warn(`${p}.call`, `"${e.obj}" is a ${type} light: it lights from everywhere, so moving it changes nothing.`);
    if (c.prop === "target" && type !== "directional") warn(`${p}.call`, `"${e.obj}" is a ${type} light; only a directional light is aimed.`);
    if (c.prop === "position" && isObj(w.sky) && w.sky.light === e.obj) warn(`${p}.call`, `The sky places "${e.obj}" (world.sky.light), so this move is overridden; move the sun with "sky" events.`);
    return;
  }
  const own = (w as Record<string, unknown>)[kind];
  if (!isObj(own)) { warn(`${p}.obj`, `The scene has no world.${kind}, so this event changes nothing.`); return; }
  if (kind === "post" && c.needs) {
    const x = own[c.needs];
    if (!(x === true || isObj(x))) warn(`${p}.call`, `world.post.${c.needs} is off, so "${e.call}" changes nothing.`);
  }
}

/** Scene Phase 1 (#350): what an event's `obj` names besides the camera and objects (an object id always wins). */
export function lookTargetOf(doc: Pick<SceneDoc, "objects" | "world">, id: unknown): { kind: SceneLookTarget; key: string } | undefined {
  if (typeof id !== "string" || id === SCENE_CAMERA) return undefined;
  if ((Array.isArray(doc.objects) ? doc.objects : []).some((o) => isObj(o) && o.id === id)) return undefined;
  const w = isObj(doc.world) ? doc.world : {};
  if (Array.isArray(w.lights) && w.lights.some((l) => isObj(l) && l.id === id)) return { kind: "light", key: `\u0001light:${id}` };
  if (SCENE_LOOK_IDS.includes(id)) return { kind: id as SceneLookTarget, key: `\u0001${id}` };
  return undefined;
}

/** Warn when a tween starts while an earlier tween of the same object property is still running (the later one wins). */
function overlapWarnings(doc: SceneDoc, warn: (path: string, m: string) => void) {
  const running = new Map<string, { end: number; i: number }>();
  for (const { e, i } of sortedEvents(doc)) {
    for (const prop of eventProps(doc, e)) {
      const key = `${e.obj}.${prop}`, prev = running.get(key);
      if (prev && e.at < prev.end) warn(`events[${i}]`, `starts at ${e.at}s while events[${prev.i}] still changes ${key} (until ${+prev.end.toFixed(3)}s); the later event wins from ${e.at}s.`);
      if ((e.dur ?? 0) > 0) running.set(key, { end: e.at + (e.dur ?? 0), i }); else running.delete(key);
    }
  }
}

/** Parse and validate JSON text; `doc` is set when the document is an object with the right format (errors elsewhere are skipped at render). */
export function parseScene(text: string): { doc?: SceneDoc; issues: SceneIssue[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { issues: [{ level: "error", path: "", message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] }; }
  const issues = validateScene(raw);
  const usable = isObj(raw) && raw.format === SCENE_FORMAT && Array.isArray(raw.objects);
  return { ...(usable ? { doc: raw as unknown as SceneDoc } : {}), issues };
}

// ---------------------------------------------------------------- evaluation

export interface SceneObjectState extends SceneProps {
  id: string;
  /** Model objects only (P75): the clips playing at `t`, a fading-out one first; empty = rest pose. */
  animation?: SceneAnimState[];
  /** Model objects with `nodes` set somewhere (P75): parts shown or hidden at `t`, by node name. */
  nodes?: Record<string, boolean>;
}
export interface SceneState {
  t: number;
  background: string;
  camera: { fov: number; position: Vec3; target: Vec3 };
  objects: SceneObjectState[];
  /** Scene Phase 1 (#350): every drawn light (the defaults when the scene has none) at `t`. */
  lights: SceneLightState[];
  /** Scene Phase 1: world.post / fog / sky at `t`, when the scene has them. */
  post?: ScenePostState;
  fog?: SceneFogState;
  sky?: SceneSkyState;
}

/** The lights a scene without `world.lights` (or with an empty list) is lit by (as the scene page draws them). */
export const SCENE_DEFAULT_LIGHTS: readonly SceneLight[] = [{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [3, 5, 2], intensity: 1.5 }];

export const SCENE_DEFAULTS = { background: "#101018", fov: 40, cameraPosition: [0, 1.6, 6] as Vec3, cameraTarget: [0, 1, 0] as Vec3 };

/** Events with their array index, stable-sorted by `at` (invalid `at` dropped). */
export function sortedEvents(doc: Pick<SceneDoc, "events">): { e: SceneEvent; i: number }[] {
  return (Array.isArray(doc.events) ? doc.events : []).map((e, i) => ({ e, i })).filter(({ e }) => isObj(e) && num(e.at) && e.at >= 0)
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i);
}

const objOf = (doc: SceneDoc, id: string) => (Array.isArray(doc.objects) ? doc.objects : []).find((o) => isObj(o) && o.id === id);

/** Property → target value for one event on an object (only values that pass the property check). `lookAt` is resolved later. */
type Targets = Partial<Record<ScenePropName, unknown>> & { lookAt?: unknown; animation?: { anim: Required<SceneAnimation> | null; fade?: number }; nodes?: Record<string, boolean> };
function eventTargets(doc: SceneDoc, e: SceneEvent): Targets {
  const o = objOf(doc, e.obj);
  if (!o || typeof e.call !== "string") return {};
  const args = isObj(e.args) ? e.args : {};
  const base = SCENE_BASE_FUNCTIONS[e.call];
  if (base) {
    const v = args[base.arg] ?? (base.arg === "position" ? args.value : undefined);
    if (e.call === "lookAt") return isVec3(v) || (typeof v === "string" && v !== e.obj && objOf(doc, v)) ? { lookAt: v } : {};
    if (base.prop === "nodes") return typeof o.model === "string" && !nodesProblem(v) ? { nodes: v as Record<string, boolean> } : {};
    if (base.prop === "animation") {
      if (typeof o.model !== "string") return {};
      const fade = num(args.fade) && args.fade >= 0 ? args.fade : undefined;
      if (e.call === "stop") return { animation: { anim: null, fade } };
      const a = animOf({ clip: args.clip, speed: args.speed, loop: args.loop, from: args.from }).anim;
      return a ? { animation: { anim: a, fade } } : {};
    }
    return propProblem(base.prop as ScenePropName, v) ? {} : { [base.prop]: v };
  }
  const f = isObj(o.functions) ? o.functions[e.call] : undefined;
  if (!isObj(f)) return {};
  const decls = cleanParamDecls(f.params ?? {});
  const vals: Record<string, HtmlParamValue> = {};
  for (const [k, d] of Object.entries(decls)) {
    const c = args[k] === undefined ? undefined : checkParamValue(d, args[k]);
    vals[k] = c?.value ?? d.default;
  }
  const out: Targets = {};
  const apply = (row: unknown) => {
    if (!isObj(row)) return;
    for (const [k, raw] of Object.entries(row)) {
      if (!ROW_KEYS.includes(k)) continue;
      const v = typeof raw === "string" && raw.startsWith("$") ? vals[raw.slice(1)] : raw;
      if (k === "animation") { const a = typeof o.model === "string" ? animOf(v).anim : undefined; if (a) out.animation = { anim: a }; continue; }
      if (k === "nodes") { if (typeof o.model === "string" && !nodesProblem(raw)) out.nodes = { ...out.nodes, ...(raw as Record<string, boolean>) }; continue; }
      if (!propProblem(k as ScenePropName, v)) out[k as ScenePropName] = v;
    }
  };
  if (isObj(f.states) && typeof f.states.param === "string" && isObj(f.states.table)) apply(f.states.table[String(vals[f.states.param])]);
  apply(f.set);
  return out;
}

/** The properties one event writes (for overlap warnings). */
function eventProps(doc: SceneDoc, e: SceneEvent): string[] {
  if (e.obj === SCENE_CAMERA) { const f = SCENE_CAMERA_FUNCTIONS[e.call]; return f ? [f.prop] : []; }
  const look = lookTargetOf(doc, e.obj);
  if (look) { const c = SCENE_LOOK_CALLS[look.kind][e.call]; return c ? [c.prop] : []; }
  return Object.keys(eventTargets(doc, e)).map((k) => (k === "lookAt" ? "rotation" : k));
}

type Val = Vec3 | number | boolean | string;
interface Seg { at: number; dur: number; ease: (x: number) => number; to: Val | { lookAt: Vec3 | string; obj: string } }

const vec3Of = (v: number | Vec3): Vec3 => (typeof v === "number" ? [v, v, v] : [v[0], v[1], v[2]]);
const hexToRgb = (h: string): Vec3 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (c: Vec3) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function mix(a: Val, b: Val, k: number): Val {
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => lerp(x, b[i], k)) as Vec3;
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, k);
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase() ? b : rgbToHex(mix(hexToRgb(a), hexToRgb(b), k) as Vec3);
  return b; // booleans snap at the start
}

/** Yaw/pitch (degrees, XYZ) that turn an object's +Z axis from `from` towards `to`; roll 0. */
export function lookRotation(from: Vec3, to: Vec3, fallback: Vec3): Vec3 {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const h = Math.hypot(dx, dz);
  if (h < 1e-9 && Math.abs(dy) < 1e-9) return fallback;
  const deg = 180 / Math.PI;
  return [-Math.atan2(dy, h) * deg, Math.atan2(dx, dz) * deg, 0];
}

/**
 * Evaluate one property's segment chain at `t`. Segments are in event order; each starts from the value the chain has
 * at its own `at` (so a running tween is cut there).
 */
function evalChain(base: Val, segs: Seg[], t: number, resolve: (s: Seg) => Val): Val {
  let v = base, cur: { seg: Seg; from: Val; to: Val } | undefined;
  const valueAt = (time: number): Val => {
    if (!cur) return v;
    const { seg, from, to } = cur;
    if (seg.dur <= 0 || time >= seg.at + seg.dur || typeof to === "boolean") return to;
    return mix(from, to, seg.ease(Math.max(0, (time - seg.at) / seg.dur)));
  };
  for (const seg of segs) {
    if (seg.at > t) break;
    const from = valueAt(seg.at);
    cur = { seg, from, to: resolve(seg) };
    v = from;
  }
  return valueAt(t);
}

const objBase = (o: SceneObject): SceneProps => ({
  position: isVec3(o.position) ? o.position : [0, 0, 0],
  rotation: isVec3(o.rotation) ? o.rotation : [0, 0, 0],
  scale: num(o.scale) && o.scale > 0 ? vec3Of(o.scale) : isVec3(o.scale) && o.scale.every((x) => x > 0) ? o.scale : [1, 1, 1],
  visible: typeof o.visible === "boolean" ? o.visible : true,
  opacity: num(o.opacity) && o.opacity >= 0 && o.opacity <= 1 ? o.opacity : 1,
  color: isSceneColor(o.color) ? o.color : "#cccccc",
});

/** Per object and property, its segments (and the camera's), built once per document. */
interface AnimSeg { at: number; fade: number; ease: (x: number) => number; anim: Required<SceneAnimation> | null }
interface Plan { props: Map<string, Map<string, Seg[]>>; anims: Map<string, AnimSeg[]>; nodes: Map<string, { at: number; nodes: Record<string, boolean> }[]> }
const plans = new WeakMap<SceneDoc, Plan>();
function planOf(doc: SceneDoc): Plan {
  const hit = plans.get(doc);
  if (hit) return hit;
  const props = new Map<string, Map<string, Seg[]>>();
  const push = (obj: string, prop: string, seg: Seg) => {
    let m = props.get(obj); if (!m) props.set(obj, (m = new Map()));
    let l = m.get(prop); if (!l) m.set(prop, (l = []));
    l.push(seg);
  };
  const anims = new Map<string, AnimSeg[]>();
  const nodes = new Map<string, { at: number; nodes: Record<string, boolean> }[]>();
  for (const { e } of sortedEvents(doc)) {
    const dur = num(e.dur) && e.dur > 0 ? e.dur : 0;
    const ease = SCENE_EASE[(e.ease ?? "linear") as SceneEase] ?? SCENE_EASE.linear;
    if (e.obj === SCENE_CAMERA) {
      const f = SCENE_CAMERA_FUNCTIONS[e.call];
      if (!f) continue;
      const args = isObj(e.args) ? e.args : {};
      const v = args[f.arg] ?? (f.arg === "position" ? args.value : undefined);
      if (f.prop === "fov" ? num(v) && v > 1 && v < 179 : f.prop === "target" ? isVec3(v) || (typeof v === "string" && !!objOf(doc, v)) : isVec3(v))
        push(SCENE_CAMERA, f.prop, { at: e.at, dur, ease, to: f.prop === "target" && typeof v === "string" ? { lookAt: v, obj: SCENE_CAMERA } : (v as Val) });
      continue;
    }
    const look = lookTargetOf(doc, e.obj);
    if (look) {
      const c = SCENE_LOOK_CALLS[look.kind][e.call];
      const args = isObj(e.args) ? e.args : {};
      const v = c ? args[c.arg] ?? (c.arg === "position" ? args.value : undefined) : undefined;
      if (c && !lookValueProblem(c, v, (id) => !!objOf(doc, id)))
        push(look.key, c.prop, { at: e.at, dur, ease, to: c.kind === "target" && typeof v === "string" ? { lookAt: v, obj: e.obj } : (v as Val) });
      continue;
    }
    const targets = eventTargets(doc, e);
    for (const [k, v] of Object.entries(targets)) {
      if (k === "animation") {
        const a = v as { anim: Required<SceneAnimation> | null; fade?: number };
        let l = anims.get(e.obj); if (!l) anims.set(e.obj, (l = []));
        l.push({ at: e.at, fade: a.fade ?? dur, ease, anim: a.anim });
      }
      else if (k === "nodes") { let l = nodes.get(e.obj); if (!l) nodes.set(e.obj, (l = [])); l.push({ at: e.at, nodes: v as Record<string, boolean> }); }
      else if (k === "lookAt") push(e.obj, "rotation", { at: e.at, dur, ease, to: { lookAt: v as Vec3 | string, obj: e.obj } });
      else push(e.obj, k, { at: e.at, dur, ease, to: k === "scale" ? vec3Of(v as number | Vec3) : (v as Val) });
    }
  }
  const plan = { props, anims, nodes };
  plans.set(doc, plan);
  return plan;
}

/**
 * The clips a model plays at `t`. The latest `play` / `stop` (or function row) with `at <= t` decides; while its fade
 * runs, the one before it keeps playing (its own time going on) with weight 1 − k, k = ease((t − at) / fade).
 * Only those two take part: a fade that starts during another fade fades from the earlier event's clip.
 */
function animationAt(o: SceneObject, segs: AnimSeg[], t: number): SceneAnimState[] {
  const base = o.animation === undefined ? null : animOf(o.animation).anim ?? null;
  const all: AnimSeg[] = [{ at: 0, fade: 0, ease: SCENE_EASE.linear, anim: base }, ...segs];
  let i = 0;
  while (i + 1 < all.length && all[i + 1].at <= t) i++;
  const out: SceneAnimState[] = [];
  const run = (s: AnimSeg, w: number) => {
    if (s.anim && w > 0) out.push({ clip: s.anim.clip, time: Math.max(0, t - s.at) * s.anim.speed + s.anim.from, loop: s.anim.loop, weight: w });
  };
  const cur = all[i];
  if (i > 0 && cur.fade > 0 && t < cur.at + cur.fade) {
    const k = Math.min(1, Math.max(0, cur.ease((t - cur.at) / cur.fade)));
    run(all[i - 1], 1 - k); run(cur, k);
  } else run(cur, 1);
  return out;
}

/**
 * The scene at clip-local second `t`: camera and every object's base properties. Pure and deterministic: the result
 * depends only on `doc` and `t`. Invalid events and fields are skipped (see `validateScene` for the messages).
 */
export function stateAt(doc: SceneDoc, t: number): SceneState {
  const plan = planOf(doc);
  const time = num(t) ? Math.max(0, t) : 0;
  const objs = (Array.isArray(doc.objects) ? doc.objects : []).filter((o) => isObj(o) && typeof o.id === "string" && o.id !== SCENE_CAMERA);
  const positionAt = (id: string, at: number): Vec3 => {
    const o = objOf(doc, id);
    if (!o) return [0, 0, 0];
    return evalChain(objBase(o).position, plan.props.get(id)?.get("position") ?? [], at, (s) => s.to as Val) as Vec3;
  };
  const objects = objs.map((o): SceneObjectState => {
    const b = objBase(o), segs = plan.props.get(o.id);
    const prop = <K extends ScenePropName>(k: K): SceneProps[K] => {
      const list = segs?.get(k);
      if (!list) return b[k];
      return evalChain(b[k], list, time, (s) => {
        const to = s.to;
        if (to && typeof to === "object" && !Array.isArray(to)) {
          // lookAt: face the target from where both are when the event ends.
          const end = s.at + s.dur, self = positionAt(o.id, end);
          const target = typeof to.lookAt === "string" ? positionAt(to.lookAt, end) : to.lookAt;
          return lookRotation(self, target, b.rotation);
        }
        return to;
      }) as SceneProps[K];
    };
    const out: SceneObjectState = { id: o.id, position: prop("position"), rotation: prop("rotation"), scale: prop("scale"), visible: prop("visible"), opacity: prop("opacity"), color: prop("color") };
    if (typeof o.model === "string" && o.model) {
      out.animation = animationAt(o, plan.anims.get(o.id) ?? [], time);
      const ev = plan.nodes.get(o.id) ?? [];
      if (ev.length || (isObj(o.nodes) && !nodesProblem(o.nodes))) {
        let n: Record<string, boolean> = isObj(o.nodes) && !nodesProblem(o.nodes) ? { ...o.nodes } : {};
        for (const x of ev) if (x.at <= time) n = { ...n, ...x.nodes };
        out.nodes = n;
      }
    }
    return out;
  });
  const w = isObj(doc.world) ? doc.world : {};
  const c = isObj(w.camera) ? w.camera : {};
  const cam = plan.props.get(SCENE_CAMERA);
  const fov0 = num(c.fov) && c.fov > 1 && c.fov < 179 ? c.fov : SCENE_DEFAULTS.fov;
  const pos0 = isVec3(c.position) ? c.position : SCENE_DEFAULTS.cameraPosition;
  const tgt0 = isVec3(c.lookAt) ? c.lookAt : SCENE_DEFAULTS.cameraTarget;
  const camera = {
    fov: evalChain(fov0, cam?.get("fov") ?? [], time, (s) => s.to as Val) as number,
    position: evalChain(pos0, cam?.get("position") ?? [], time, (s) => s.to as Val) as Vec3,
    target: evalChain(tgt0, cam?.get("target") ?? [], time, (s) => {
      const to = s.to;
      return to && typeof to === "object" && !Array.isArray(to) ? positionAt(String(to.lookAt), s.at + s.dur) : (to as Val);
    }) as Vec3,
  };
  const background = isSceneColor(w.background) ? w.background : SCENE_DEFAULTS.background;
  // Scene Phase 1 (#350): lights, post, fog and sky: each property is a chain like an object's.
  const lookChain = (key: string, prop: string, base: unknown): unknown => {
    const segs = plan.props.get(key)?.get(prop);
    if (!segs || base === undefined) return base;
    return evalChain(base as Val, segs, time, (s) => {
      const to = s.to;
      return to && typeof to === "object" && !Array.isArray(to) ? positionAt(String(to.lookAt), s.at + s.dur) : (to as Val);
    });
  };
  const resolveGroup = <T extends object>(key: string, base: T | undefined, kind: SceneLookTarget): T | undefined => {
    if (!base) return undefined;
    const out = { ...base } as Record<string, unknown>;
    for (const c of Object.values(SCENE_LOOK_CALLS[kind])) {
      const b = getLookProp(out, c.prop);
      if (b !== undefined) setLookProp(out, c.prop, lookChain(key, c.prop, b));
    }
    return out as T;
  };
  // An object with the id "post", "fog" or "sky" takes those events (old scenes), so the world's one has none.
  const lookKey = (id: string) => (objOf(doc, id) ? `\u0002${id}` : `\u0001${id}`);
  const sky = resolveGroup(lookKey("sky"), skyBase(w), "sky");
  const own = Array.isArray(w.lights) ? w.lights.filter(isObj) : [];
  const drawn = (own.length ? own : SCENE_DEFAULT_LIGHTS) as SceneLight[];
  const lights = drawn.map((l): SceneLightState => {
    const live = typeof l.id === "string" && !objOf(doc, l.id);
    const key = `\u0001light:${l.id}`;
    const val = (prop: string, base: unknown) => (live ? lookChain(key, prop, base) : base);
    const out: SceneLightState = {
      ...(typeof l.id === "string" ? { id: l.id } : {}), type: String(l.type),
      color: val("color", isSceneColor(l.color) ? l.color : "#ffffff") as string,
      intensity: val("intensity", num(l.intensity) && l.intensity >= 0 ? l.intensity : 1) as number,
    };
    if (l.type === "directional" || l.type === "point") out.position = val("position", isVec3(l.position) ? l.position : l.type === "directional" ? [0, 1, 0] : [0, 0, 0]) as Vec3;
    if (l.type === "directional") out.target = val("target", isVec3(l.lookAt) ? l.lookAt : [0, 0, 0]) as Vec3;
    if (l.type === "hemisphere") out.groundColor = isSceneColor(l.groundColor) ? l.groundColor : "#303040";
    if (sky?.light && l.id === sky.light && l.type === "directional") {
      const d = sunDirection(sky.elevation, sky.azimuth), t0 = out.target ?? [0, 0, 0];
      out.position = [t0[0] + d[0] * SUN_DISTANCE, t0[1] + d[1] * SUN_DISTANCE, t0[2] + d[2] * SUN_DISTANCE];
    }
    return out;
  });
  const post = resolveGroup(lookKey("post"), postBase(w), "post");
  const fog = resolveGroup(lookKey("fog"), fogBase(w, background), "fog");
  return { t: time, background, camera, objects, lights, ...(post ? { post } : {}), ...(fog ? { fog } : {}), ...(sky ? { sky } : {}) };
}

/** A short summary for the inspector and agents: objects with their functions, and the events in time order. */
export function sceneSummary(doc: SceneDoc): { objects: { id: string; shape: string; functions: string[]; animations?: string[] }[]; events: { i: number; at: number; obj: string; call: string; dur?: number }[] } {
  const objects = (Array.isArray(doc.objects) ? doc.objects : []).filter((o) => isObj(o) && typeof o.id === "string")
    .map((o) => {
      const anims = typeof o.model === "string" ? modelAnimations(doc, o.model) : undefined;
      return { id: o.id, shape: o.model ? `model ${o.model}` : o.shape ?? "box", functions: isObj(o.functions) ? Object.keys(o.functions) : [], ...(anims ? { animations: anims } : {}) };
    });
  const events = sortedEvents(doc).map(({ e, i }) => ({ i, at: e.at, obj: String(e.obj), call: String(e.call), ...(num(e.dur) && e.dur > 0 ? { dur: e.dur } : {}) }));
  return { objects, events };
}

/** The scene a new "3D scene" clip starts with: a sphere that moves and changes mood, a turning box and a sign that fades. */
export const SAMPLE_SCENE: SceneDoc = {
  format: SCENE_FORMAT,
  name: "3D scene",
  durationSec: 5,
  world: {
    background: "#14161c",
    camera: { fov: 40, position: [0, 1.6, 6], lookAt: [0, 0.8, 0] },
    lights: [{ type: "hemisphere", intensity: 1.1 }, { type: "directional", position: [3, 5, 2], intensity: 1.6 }],
  },
  objects: [
    { id: "floor", shape: "plane", size: [12, 12], color: "#2a2f3a", rotation: [-90, 0, 0] },
    {
      id: "ball", shape: "sphere", size: 0.5, color: "#5ad1c8", position: [-1.6, 0.5, 0],
      functions: {
        setMood: {
          description: "Colour and size for a mood.",
          params: { mood: { type: "select", options: ["calm", "alert"], default: "calm" } },
          states: { param: "mood", table: { calm: { color: "#5ad1c8", scale: 1 }, alert: { color: "#ff6b4a", scale: 1.3 } } },
        },
      },
    },
    { id: "cube", shape: "box", size: [0.8, 0.8, 0.8], color: "#e8e8e8", position: [1.4, 0.4, -0.5] },
    { id: "sign", shape: "box", size: [1.6, 0.6, 0.06], color: "#ffcc00", position: [0, 1.9, -1.5] },
  ],
  events: [
    { at: 0, obj: "cube", call: "rotation", args: { value: [0, 360, 0] }, dur: 5, ease: "linear" },
    { at: 0.5, obj: "ball", call: "moveTo", args: { position: [0.2, 0.5, 0.8] }, dur: 1.5, ease: "inOutCubic" },
    { at: 2, obj: "ball", call: "setMood", args: { mood: "alert" }, dur: 0.4, ease: "out" },
    { at: 2.5, obj: "camera", call: "moveTo", args: { position: [1.5, 1.8, 5] }, dur: 2, ease: "inOutSine" },
    { at: 3, obj: "sign", call: "opacity", args: { value: 0 }, dur: 0.8, ease: "out" },
    { at: 3.8, obj: "sign", call: "visible", args: { value: false } },
  ],
};

/**
 * P75: the document with a GLB model added: the file under a free name in `files` and a new object that shows it
 * (fitted to `size` units, standing on the floor in front, beside earlier models) playing its first animation, if any.
 * Pure: returns a new document and the new object's id.
 */
export function addSceneModel(doc: SceneDoc, fileName: string, dataUrl: string, size = 1.6): { doc: SceneDoc; id: string } {
  const files = { ...(isObj(doc.files) ? doc.files : {}) };
  const clean = fileName.replace(/[^A-Za-z0-9 _.()-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "model.glb";
  const ext = /\.[^.]+$/.exec(clean)?.[0] ?? "";
  const stem = clean.slice(0, clean.length - ext.length).slice(0, 100) || "model";
  let name = `${stem}${ext}`;
  for (let n = 2; files[name] !== undefined && files[name] !== dataUrl; n++) name = `${stem}-${n}${ext}`;
  files[name] = dataUrl;
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const taken = new Set(objects.map((o) => (isObj(o) ? o.id : "")));
  const idStem = (/^[A-Za-z]/.test(stem) ? stem : `model-${stem}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "model";
  let id = idStem;
  for (let n = 2; taken.has(id) || id === SCENE_CAMERA; n++) id = `${idStem}-${n}`;
  const first = glbInfoOfDataUrl(dataUrl)?.animations[0]?.name;
  // Side by side in front of the camera: the n-th model at x = 0, -1.2, 1.2, -2.4, 2.4, then again.
  const n = objects.filter((o) => isObj(o) && typeof o.model === "string").length % 5;
  const x = [0, -1.2, 1.2, -2.4, 2.4][n];
  const obj: SceneObject = { id, model: name, size, position: [x, 0, 0.6], ...(first ? { animation: first } : {}) };
  return { doc: { ...doc, files, objects: [...objects, obj] }, id };
}
