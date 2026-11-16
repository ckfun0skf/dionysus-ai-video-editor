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
 */
import { checkParamValue, cleanParamDecls, validateParamDecls, type HtmlClipParam, type HtmlParamValue } from "./htmlClipPackage";

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

export interface SceneLight { type: SceneLightType; color?: string; intensity?: number; position?: Vec3 }
export interface SceneCamera { fov?: number; position?: Vec3; lookAt?: Vec3 }
export interface SceneWorld { background?: string; camera?: SceneCamera; lights?: SceneLight[] }

/** Base properties every object has (the evaluator's output per object). */
export interface SceneProps { position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean; opacity: number; color: string }
export type ScenePropName = keyof SceneProps;
export const SCENE_PROPS: readonly ScenePropName[] = ["position", "rotation", "scale", "visible", "opacity", "color"];

/** A declarative custom function: typed params; `set` maps properties to constants or "$param"; `states` picks a row by a param's value. */
export interface SceneFunction {
  params?: Record<string, HtmlClipParam>;
  set?: Partial<Record<ScenePropName, unknown>>;
  states?: { param: string; table: Record<string, Partial<Record<ScenePropName, unknown>>> };
  description?: string;
}

export interface SceneObject {
  id: string;
  /** Primitive shape (default box). `size`: box [w,h,d] or one number; sphere radius; cylinder/cone [radius, height]; torus [radius, tube]; plane [w,h]. */
  shape?: SceneShape;
  size?: number | number[];
  /** A GLB model by file name: not drawn before step 2.2 (the object is drawn as its shape, with a warning). */
  model?: string;
  name?: string;
  color?: string;
  position?: Vec3;
  /** Degrees, XYZ order. */
  rotation?: Vec3;
  scale?: number | Vec3;
  visible?: boolean;
  opacity?: number;
  functions?: Record<string, SceneFunction>;
}

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
}

export interface SceneIssue { level: "error" | "warning"; path: string; message: string }

/** The base functions every object has, with the property each writes. */
export const SCENE_BASE_FUNCTIONS: Record<string, { prop: ScenePropName | "target" | "fov"; arg: string; description: string }> = {
  position: { prop: "position", arg: "value", description: "Move to [x, y, z] (a tween with dur)." },
  moveTo: { prop: "position", arg: "position", description: "Same as position; the argument is named position." },
  rotation: { prop: "rotation", arg: "value", description: "Rotate to [x, y, z] degrees." },
  lookAt: { prop: "rotation", arg: "target", description: "Turn to face an object id or a point [x, y, z] (evaluated where both are when the event ends)." },
  scale: { prop: "scale", arg: "value", description: "Scale to a number or [x, y, z]." },
  visible: { prop: "visible", arg: "value", description: "Show (true) or hide (false). Never tweens." },
  opacity: { prop: "opacity", arg: "value", description: "Opacity 0–1." },
  color: { prop: "color", arg: "value", description: "Material colour \"#rrggbb\"." },
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
  // world
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
        });
      }
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
    else objects.set(id, o);
    const shape = (o.shape ?? "box") as SceneShape;
    if (!SCENE_SHAPES.includes(shape)) err(`${p}.shape`, `must be one of ${SCENE_SHAPES.map((x) => `"${x}"`).join(", ")}.`);
    else if (o.size !== undefined && !sizeOk(shape, o.size)) err(`${p}.size`, `has the wrong form for a ${shape}.`);
    if (o.model !== undefined) {
      if (typeof o.model !== "string" || !o.model) err(`${p}.model`, "must be a file name.");
      else warn(`${p}.model`, `GLB models are drawn from a later version; "${o.model}" is shown as a ${SCENE_SHAPES.includes(shape) ? shape : "box"} for now.`);
    }
    if (o.name !== undefined && typeof o.name !== "string") err(`${p}.name`, "must be a string.");
    for (const prop of SCENE_PROPS) if (o[prop] !== undefined) { const why = propProblem(prop, o[prop]); if (why) err(`${p}.${prop}`, `${why}.`); }
    if (o.functions !== undefined) {
      if (!isObj(o.functions)) err(`${p}.functions`, "must be an object of function name → { params, set, states }.");
      else for (const [fn, f] of Object.entries(o.functions)) validateFunction(f, fn, `${p}.functions.${fn}`, err);
    }
  });
  // events
  if (raw.events !== undefined) {
    if (!Array.isArray(raw.events)) err("events", "\"events\" must be a list.");
    else {
      raw.events.forEach((e, i) => validateEvent(e, `events[${i}]`, objects, err));
      overlapWarnings(raw as unknown as SceneDoc, warn);
    }
  }
  return out;
}

function validateFunction(f: unknown, name: string, p: string, err: (path: string, m: string) => void) {
  if (!ID_RE.test(name)) err(p, `Function name "${name}" must start with a letter and use letters, digits, "_" or "-".`);
  if (SCENE_BASE_FUNCTIONS[name]) err(p, `"${name}" is a base function; pick another name.`);
  if (!isObj(f)) { err(p, "must be an object { params, set, states }."); return; }
  const params = f.params === undefined ? {} : f.params;
  if (f.params !== undefined) for (const i of validateParamDecls(f.params)) err(`${p}.params`, i.message);
  const decls = cleanParamDecls(params);
  const checkRow = (row: unknown, rp: string) => {
    if (!isObj(row)) { err(rp, "must be an object of property → value."); return; }
    for (const [k, v] of Object.entries(row)) {
      if (!(SCENE_PROPS as readonly string[]).includes(k)) { err(`${rp}.${k}`, `is not a property (${SCENE_PROPS.join(", ")}).`); continue; }
      if (typeof v === "string" && v.startsWith("$")) { if (!decls[v.slice(1)]) err(`${rp}.${k}`, `names an undeclared param "${v.slice(1)}".`); continue; }
      const why = propProblem(k as ScenePropName, v); if (why) err(`${rp}.${k}`, `${why}.`);
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

function validateEvent(e: unknown, p: string, objects: Map<string, Record<string, unknown>>, err: (path: string, m: string) => void) {
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
  if (!o) { err(`${p}.obj`, `There is no object "${e.obj}".`); return; }
  const base = SCENE_BASE_FUNCTIONS[e.call];
  if (base) {
    const v = args[base.arg] ?? (base.arg === "position" ? args.value : undefined);
    if (e.call === "lookAt") { if (!isVec3(v) && !(typeof v === "string" && objects.has(v) && v !== e.obj)) err(`${p}.args.target`, "must be another object id or [x, y, z]."); }
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

export interface SceneObjectState extends SceneProps { id: string }
export interface SceneState {
  t: number;
  background: string;
  camera: { fov: number; position: Vec3; target: Vec3 };
  objects: SceneObjectState[];
}

export const SCENE_DEFAULTS = { background: "#101018", fov: 40, cameraPosition: [0, 1.6, 6] as Vec3, cameraTarget: [0, 1, 0] as Vec3 };

/** Events with their array index, stable-sorted by `at` (invalid `at` dropped). */
export function sortedEvents(doc: Pick<SceneDoc, "events">): { e: SceneEvent; i: number }[] {
  return (Array.isArray(doc.events) ? doc.events : []).map((e, i) => ({ e, i })).filter(({ e }) => isObj(e) && num(e.at) && e.at >= 0)
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i);
}

const objOf = (doc: SceneDoc, id: string) => (Array.isArray(doc.objects) ? doc.objects : []).find((o) => isObj(o) && o.id === id);

/** Property → target value for one event on an object (only values that pass the property check). `lookAt` is resolved later. */
function eventTargets(doc: SceneDoc, e: SceneEvent): Partial<Record<ScenePropName, unknown>> & { lookAt?: unknown } {
  const o = objOf(doc, e.obj);
  if (!o || typeof e.call !== "string") return {};
  const args = isObj(e.args) ? e.args : {};
  const base = SCENE_BASE_FUNCTIONS[e.call];
  if (base) {
    const v = args[base.arg] ?? (base.arg === "position" ? args.value : undefined);
    if (e.call === "lookAt") return isVec3(v) || (typeof v === "string" && v !== e.obj && objOf(doc, v)) ? { lookAt: v } : {};
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
  const out: Partial<Record<ScenePropName, unknown>> = {};
  const apply = (row: unknown) => {
    if (!isObj(row)) return;
    for (const [k, raw] of Object.entries(row)) {
      if (!(SCENE_PROPS as readonly string[]).includes(k)) continue;
      const v = typeof raw === "string" && raw.startsWith("$") ? vals[raw.slice(1)] : raw;
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
  return Object.keys(eventTargets(doc, e)).map((k) => (k === "lookAt" ? "rotation" : k));
}

type Val = Vec3 | number | boolean | string;
interface Seg { at: number; dur: number; ease: (x: number) => number; to: Val | { lookAt: Vec3 | string; obj: string } }

const vec3Of = (v: number | Vec3): Vec3 => (typeof v === "number" ? [v, v, v] : [v[0], v[1], v[2]]);
const hexToRgb = (h: string): Vec3 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbToHex = (c: Vec3) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function mix(a: Val, b: Val, k: number): Val {
  if (Array.isArray(a) && Array.isArray(b)) return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
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
interface Plan { props: Map<string, Map<string, Seg[]>> }
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
    const targets = eventTargets(doc, e);
    for (const [k, v] of Object.entries(targets)) {
      if (k === "lookAt") push(e.obj, "rotation", { at: e.at, dur, ease, to: { lookAt: v as Vec3 | string, obj: e.obj } });
      else push(e.obj, k, { at: e.at, dur, ease, to: k === "scale" ? vec3Of(v as number | Vec3) : (v as Val) });
    }
  }
  const plan = { props };
  plans.set(doc, plan);
  return plan;
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
    return { id: o.id, position: prop("position"), rotation: prop("rotation"), scale: prop("scale"), visible: prop("visible"), opacity: prop("opacity"), color: prop("color") };
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
  return { t: time, background: isSceneColor(w.background) ? w.background : SCENE_DEFAULTS.background, camera, objects };
}

/** A short summary for the inspector and agents: objects with their functions, and the events in time order. */
export function sceneSummary(doc: SceneDoc): { objects: { id: string; shape: string; functions: string[] }[]; events: { i: number; at: number; obj: string; call: string; dur?: number }[] } {
  const objects = (Array.isArray(doc.objects) ? doc.objects : []).filter((o) => isObj(o) && typeof o.id === "string")
    .map((o) => ({ id: o.id, shape: o.model ? `model ${o.model}` : o.shape ?? "box", functions: isObj(o.functions) ? Object.keys(o.functions) : [] }));
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
