/**
 * Scene editing (P76, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 2 step 2.3): pure edit operations on a
 * `dionysus.scene/1` scene, used by the scene editor (ui/SceneEditor.tsx). Every function returns a new scene and
 * leaves its input untouched; the UI stores the result as a scene version (one undo step per gesture).
 *
 * Also the read models the editor draws: `sceneTracks` (P81b: the Scene track for scene-wide settings, the Camera
 * track, one track per object and one per light, with the events as blocks stacked into rows where they overlap), the calls an object offers (`sceneCalls`) and the argument
 * fields of a call (`sceneCallArgs`), with defaults taken from the evaluated state at the event's time.
 */
import { cleanParamDecls, type HtmlClipParam } from "./htmlClipPackage";
import {
  modelAnimations, modelNodes, SCENE_BASE_FUNCTIONS, SCENE_CAMERA, SCENE_CAMERA_FUNCTIONS, SCENE_DEFAULTS, SCENE_LOOPS,
  stateAt, type SceneDoc, type SceneEase, type SceneEvent, type SceneLight, type SceneObject, type SceneShape, type SceneWorld, type Vec3,
} from "./scene";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Seconds rounded to the millisecond (what the editor writes for times). */
export const roundSec = (s: number) => Math.round(Math.max(0, s) * 1000) / 1000;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const vecR = (v: Vec3): Vec3 => [r3(v[0]), r3(v[1]), r3(v[2])];

const objectsOf = (doc: SceneDoc): SceneObject[] => (Array.isArray(doc.objects) ? doc.objects : []);
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
/** Drop keys whose value is undefined (an edit that clears a field). */
function clean<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}

// ---------------------------------------------------------------- objects

/** A free object id from `stem` ("box", "box-2", …); never the camera's. */
export function freeObjectId(doc: SceneDoc, stem: string): string {
  const base = (/^[A-Za-z]/.test(stem) ? stem : `obj-${stem}`).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "obj";
  const taken = new Set([...objectsOf(doc).map((o) => (isObj(o) ? o.id : "")), ...lightIdsOf(doc)]);
  let id = base;
  for (let n = 2; taken.has(id) || id === SCENE_CAMERA; n++) id = `${base}-${n}`;
  return id;
}

const PALETTE = ["#4fc3f7", "#ffb74d", "#81c784", "#e57373", "#ba68c8", "#fff176"];
const SHAPE_SIZE: Record<SceneShape, number | number[]> = { box: 1, sphere: 0.5, cylinder: [0.4, 1], cone: [0.5, 1], torus: [0.5, 0.15], plane: [2, 2] };

/** A new primitive object in front of the camera (beside the others), with a colour from a small palette. */
export function addSceneObject(doc: SceneDoc, shape: SceneShape = "box"): { doc: SceneDoc; id: string } {
  const objects = objectsOf(doc);
  const id = freeObjectId(doc, shape);
  const n = objects.length;
  const x = [0, -1.5, 1.5, -3, 3][n % 5];
  const obj: SceneObject = clean({
    id, shape, size: SHAPE_SIZE[shape], color: PALETTE[n % PALETTE.length],
    position: [x, shape === "plane" ? 0 : 0.5, 0] as Vec3, rotation: shape === "plane" ? [-90, 0, 0] as Vec3 : undefined,
  });
  return { doc: { ...doc, objects: [...objects, obj] }, id };
}

/**
 * Change an object's own fields (not its id or functions): a value of `undefined` removes the field (back to the
 * default). Changing the shape drops a size that no longer fits.
 */
export function updateSceneObject(doc: SceneDoc, id: string, patch: Partial<Omit<SceneObject, "id" | "functions">>): SceneDoc {
  const objects = objectsOf(doc);
  const i = objects.findIndex((o) => isObj(o) && o.id === id);
  if (i < 0) return doc;
  const before = objects[i];
  const next = clean({ ...before, ...patch } as SceneObject);
  if (patch.shape && patch.shape !== (before.shape ?? "box") && !("size" in patch)) next.size = SHAPE_SIZE[patch.shape];
  if (JSON.stringify(next) === JSON.stringify(before)) return doc;
  return { ...doc, objects: objects.map((o, k) => (k === i ? next : o)) };
}

/** Problem with a new object id, or undefined when it can be used. */
export function objectIdProblem(doc: SceneDoc, id: string, next: string): string | undefined {
  if (!ID_RE.test(next)) return "Ids start with a letter and use letters, digits, \"_\" or \"-\" (up to 64).";
  if (next === SCENE_CAMERA) return `"${SCENE_CAMERA}" is reserved for the camera.`;
  if (next !== id && objectsOf(doc).some((o) => isObj(o) && o.id === next)) return `"${next}" is already used.`;
  if (lightIdsOf(doc).includes(next)) return `"${next}" is the id of a light.`;
  return undefined;
}

/** Rename an object; its events and every lookAt that targets it (objects and camera) follow. */
export function renameSceneObject(doc: SceneDoc, id: string, next: string): { doc: SceneDoc; error?: string } {
  if (next === id) return { doc };
  const error = objectIdProblem(doc, id, next);
  if (error) return { doc, error };
  if (!objectsOf(doc).some((o) => isObj(o) && o.id === id)) return { doc, error: `There is no object "${id}".` };
  const objects = objectsOf(doc).map((o) => (isObj(o) && o.id === id ? { ...o, id: next } : o));
  const events = eventsOf(doc).map((e) => {
    if (!isObj(e)) return e;
    let out = e;
    if (e.obj === id) out = { ...out, obj: next };
    if (e.call === "lookAt" && isObj(e.args) && e.args.target === id) out = { ...out, args: { ...e.args, target: next } };
    return out;
  });
  return { doc: { ...doc, objects, ...(doc.events ? { events } : {}) } };
}

/**
 * Delete an object with its events and the lookAt events that target it; its model or script file goes too when no
 * other object uses it. Returns how many events were removed.
 */
export function removeSceneObject(doc: SceneDoc, id: string): { doc: SceneDoc; removedEvents: number } {
  const objects = objectsOf(doc);
  const gone = objects.find((o) => isObj(o) && o.id === id);
  if (!gone) return { doc, removedEvents: 0 };
  const keep = objects.filter((o) => o !== gone);
  const before = eventsOf(doc);
  const events = before.filter((e) => !(isObj(e) && (e.obj === id || (e.call === "lookAt" && isObj(e.args) && e.args.target === id))));
  let out: SceneDoc = { ...doc, objects: keep, ...(doc.events ? { events } : {}) };
  if (typeof gone.model === "string" && isObj(doc.files) && !keep.some((o) => isObj(o) && o.model === gone.model)) {
    const { [gone.model]: _drop, ...files } = doc.files;
    void _drop;
    out = Object.keys(files).length ? { ...out, files } : (({ files: _f, ...rest }) => (void _f, rest as SceneDoc))(out);
  }
  // P82: a Script object's code file goes too when no other object uses it.
  const sf = isObj(gone.script) ? gone.script.file : undefined;
  if (typeof sf === "string" && isObj(out.files) && sf in out.files && !keep.some((o) => isObj(o) && (o.model === sf || (isObj(o.script) && o.script.file === sf)))) {
    const { [sf]: _drop, ...files } = out.files;
    void _drop;
    out = Object.keys(files).length ? { ...out, files } : (({ files: _f, ...rest }) => (void _f, rest as SceneDoc))(out);
  }
  return { doc: out, removedEvents: before.length - events.length };
}

// ---------------------------------------------------------------- world, camera and lights

/** The lights a scene without `world.lights` (or with an empty list) is lit by (as the scene page draws them). */
export const SCENE_DEFAULT_LIGHTS: readonly SceneLight[] = [{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [3, 5, 2], intensity: 1.5 }];

/** Change the world's background or the camera's start values (`undefined` removes a field). */
export function updateSceneWorld(doc: SceneDoc, patch: { background?: string; camera?: Partial<NonNullable<SceneWorld["camera"]>> }): SceneDoc {
  const w: SceneWorld = isObj(doc.world) ? doc.world : {};
  let next: SceneWorld = { ...w };
  if ("background" in patch) next = clean({ ...next, background: patch.background });
  if (patch.camera) {
    const cam = clean({ ...(isObj(w.camera) ? w.camera : {}), ...patch.camera });
    next = Object.keys(cam).length ? { ...next, camera: cam } : (({ camera: _c, ...rest }) => (void _c, rest))(next);
  }
  return JSON.stringify(next) === JSON.stringify(w) ? doc : { ...doc, world: next };
}

const lightsOf = (doc: SceneDoc): SceneLight[] => (isObj(doc.world) && Array.isArray(doc.world.lights) ? doc.world.lights : []);
/** P81b: the ids lights have (lights may have none). */
const lightIdsOf = (doc: SceneDoc): string[] => lightsOf(doc).flatMap((l) => (isObj(l) && typeof l.id === "string" ? [l.id] : []));
const withLights = (doc: SceneDoc, lights: SceneLight[]): SceneDoc => ({ ...doc, world: { ...(isObj(doc.world) ? doc.world : {}), lights } });

/** The lights the scene is drawn with (its own, or the defaults when it has none). */
export const sceneLights = (doc: SceneDoc): { lights: SceneLight[]; defaults: boolean } => {
  const own = lightsOf(doc);
  return own.length ? { lights: own, defaults: false } : { lights: SCENE_DEFAULT_LIGHTS.map((l) => ({ ...l })), defaults: true };
};

/** Add a light. A scene lit by the defaults keeps them (they are written out first), so adding never darkens it. */
export function addSceneLight(doc: SceneDoc, light: SceneLight = { type: "point", color: "#ffffff", intensity: 1, position: [0, 3, 2] }): SceneDoc {
  return withLights(doc, [...sceneLights(doc).lights, light]);
}

/** Change light `i` of the drawn list (defaults are written out first); `undefined` removes a field. */
export function updateSceneLight(doc: SceneDoc, i: number, patch: Partial<SceneLight>): SceneDoc {
  const { lights } = sceneLights(doc);
  if (!lights[i]) return doc;
  const next = clean({ ...lights[i], ...patch });
  if (JSON.stringify(next) === JSON.stringify(lights[i]) && lightsOf(doc).length) return doc;
  return withLights(doc, lights.map((l, k) => (k === i ? next : l)));
}

/** P81b: why `next` can't be the id of light `i` ("" removes the id, always fine). */
export function lightIdProblem(doc: SceneDoc, i: number, next: string): string | undefined {
  if (next === "") return undefined;
  if (!ID_RE.test(next)) return "Ids start with a letter and use letters, digits, \"_\" or \"-\" (up to 64).";
  if (next === SCENE_CAMERA) return `"${SCENE_CAMERA}" is reserved for the camera.`;
  if (objectsOf(doc).some((o) => isObj(o) && o.id === next)) return `"${next}" is the id of an object.`;
  if (sceneLights(doc).lights.some((l, k) => k !== i && l.id === next)) return `"${next}" is already used by another light.`;
  return undefined;
}

/** P81b: the index of a light named by its id or its index in the drawn list (undefined when there is none). */
export function sceneLightIndex(doc: SceneDoc, ref: unknown): number | undefined {
  const { lights } = sceneLights(doc);
  if (typeof ref === "number") return Number.isInteger(ref) && ref >= 0 && ref < lights.length ? ref : undefined;
  if (typeof ref !== "string" || !ref) return undefined;
  const i = lights.findIndex((l) => l.id === ref);
  return i < 0 ? undefined : i;
}

/** P81b: how the editor names light `i`: its id, else "Light n". */
export const sceneLightLabel = (l: SceneLight, i: number): string => l.id || `Light ${i + 1}`;
/** P81b: lights with a position the Edit view can move (ambient and hemisphere light comes from everywhere). */
export const lightHasPosition = (l: Pick<SceneLight, "type">): boolean => l.type === "directional" || l.type === "point";

/** Remove light `i`; removing the last one leaves an empty list, which draws the default lights. */
export function removeSceneLight(doc: SceneDoc, i: number): SceneDoc {
  const { lights } = sceneLights(doc);
  if (!lights[i]) return doc;
  return withLights(doc, lights.filter((_, k) => k !== i));
}

// ---------------------------------------------------------------- events

/** What one call offers in the editor. */
export interface SceneCallInfo { call: string; kind: "base" | "custom" | "camera"; description: string }

/** The calls an object (or the camera) offers: base functions (animation ones for models only), then its own functions. */
export function sceneCalls(doc: SceneDoc, obj: string): SceneCallInfo[] {
  if (obj === SCENE_CAMERA) {
    const d: Record<string, string> = { position: "Move the camera to [x, y, z].", moveTo: "Same as position.", lookAt: "Aim the camera at an object id or a point.", fov: "Field of view in degrees." };
    return Object.keys(SCENE_CAMERA_FUNCTIONS).map((call) => ({ call, kind: "camera", description: d[call] ?? "" }));
  }
  const o = objectsOf(doc).find((x) => isObj(x) && x.id === obj);
  if (!o) return [];
  const model = typeof o.model === "string";
  const base = Object.entries(SCENE_BASE_FUNCTIONS).filter(([, f]) => model || (f.prop !== "animation" && f.prop !== "nodes"))
    .map(([call, f]) => ({ call, kind: "base" as const, description: f.description }));
  const own = isObj(o.functions) ? Object.entries(o.functions).map(([call, f]) => ({ call, kind: "custom" as const, description: isObj(f) && typeof f.description === "string" ? f.description : "Custom function." })) : [];
  return [...base, ...own];
}

/** One argument field of a call, for the event form. */
export type SceneArgField =
  | { name: string; kind: "vec3" | "scale" | "target"; label: string }
  | { name: string; kind: "number"; label: string; min?: number; max?: number; step?: number; optional?: boolean }
  | { name: string; kind: "bool" | "color"; label: string }
  | { name: string; kind: "select"; label: string; options: string[]; optional?: boolean; free?: boolean }
  | { name: string; kind: "nodes"; label: string; nodes?: string[] }
  | { name: string; kind: "param"; label: string; param: HtmlClipParam };

/** The argument fields of `call` on `obj`. */
export function sceneCallArgs(doc: SceneDoc, obj: string, call: string): SceneArgField[] {
  if (obj === SCENE_CAMERA) {
    const f = SCENE_CAMERA_FUNCTIONS[call];
    if (!f) return [];
    if (f.prop === "fov") return [{ name: "value", kind: "number", label: "Field of view (°)", min: 2, max: 178, step: 1 }];
    if (f.prop === "target") return [{ name: "target", kind: "target", label: "Look at" }];
    return [{ name: f.arg, kind: "vec3", label: "Position" }];
  }
  const o = objectsOf(doc).find((x) => isObj(x) && x.id === obj);
  const base = SCENE_BASE_FUNCTIONS[call];
  if (base) {
    switch (call) {
      case "position": case "moveTo": return [{ name: base.arg, kind: "vec3", label: "Position" }];
      case "rotation": return [{ name: "value", kind: "vec3", label: "Rotation (°)" }];
      case "lookAt": return [{ name: "target", kind: "target", label: "Look at" }];
      case "scale": return [{ name: "value", kind: "scale", label: "Scale" }];
      case "visible": return [{ name: "value", kind: "bool", label: "Visible" }];
      case "opacity": return [{ name: "value", kind: "number", label: "Opacity", min: 0, max: 1, step: 0.05 }];
      case "color": return [{ name: "value", kind: "color", label: "Colour" }];
      case "play": return [
        { name: "clip", kind: "select", label: "Animation", options: modelAnimations(doc, o?.model) ?? [], free: true },
        { name: "speed", kind: "number", label: "Speed", min: 0, step: 0.1, optional: true },
        { name: "loop", kind: "select", label: "Loop", options: [...SCENE_LOOPS], optional: true },
        { name: "from", kind: "number", label: "Start at (s)", min: 0, step: 0.1, optional: true },
        { name: "fade", kind: "number", label: "Fade (s)", min: 0, step: 0.1, optional: true },
      ];
      case "stop": return [{ name: "fade", kind: "number", label: "Fade (s)", min: 0, step: 0.1, optional: true }];
      case "nodes": return [{ name: "value", kind: "nodes", label: "Parts", nodes: modelNodes(doc, o?.model) }];
    }
    return [];
  }
  const f = o && isObj(o.functions) ? o.functions[call] : undefined;
  if (!isObj(f)) return [];
  return Object.entries(cleanParamDecls(f.params ?? {})).map(([name, param]) => ({ name, kind: "param" as const, label: param.label || name, param }));
}

/** Default arguments for a new `call` at `at`: the value the object (or camera) has there, so adding changes nothing until edited. */
export function defaultCallArgs(doc: SceneDoc, obj: string, call: string, at: number): Record<string, unknown> {
  const s = stateAt(doc, at);
  if (obj === SCENE_CAMERA) {
    const f = SCENE_CAMERA_FUNCTIONS[call];
    if (!f) return {};
    if (f.prop === "fov") return { value: r3(s.camera.fov) };
    if (f.prop === "target") return { target: vecR(s.camera.target) };
    return { [f.arg]: vecR(s.camera.position) };
  }
  const o = s.objects.find((x) => x.id === obj);
  const src = objectsOf(doc).find((x) => isObj(x) && x.id === obj);
  if (!o || !src) return {};
  switch (call) {
    case "position": return { value: vecR(o.position) };
    case "moveTo": return { position: vecR(o.position) };
    case "rotation": return { value: vecR(o.rotation) };
    case "lookAt": { const other = s.objects.find((x) => x.id !== obj); return { target: other ? other.id : [0, 0, 0] }; }
    case "scale": return { value: o.scale[0] === o.scale[1] && o.scale[1] === o.scale[2] ? r3(o.scale[0]) : vecR(o.scale) };
    case "visible": return { value: !o.visible };
    case "opacity": return { value: r3(o.opacity) };
    case "color": return { value: o.color };
    case "play": {
      const names = modelAnimations(doc, src.model) ?? [];
      const now = new Set((o.animation ?? []).filter((a) => a.weight > 0).map((a) => a.clip));
      const clip = names.find((n) => !now.has(n)) ?? names[0];
      return clip ? { clip } : { clip: "" };
    }
    case "stop": return {};
    case "nodes": { const n = modelNodes(doc, src.model)?.[0]; return n ? { value: { [n]: !(o.nodes?.[n] ?? true) } } : { value: {} }; }
  }
  const f = isObj(src.functions) ? src.functions[call] : undefined;
  if (!isObj(f)) return {};
  return Object.fromEntries(Object.entries(cleanParamDecls(f.params ?? {})).map(([k, d]) => [k, d.default]));
}

/** Calls that change something over time (a `dur` and an ease make sense); the others switch at `at` (or fade). */
export function callTweens(_doc: SceneDoc, obj: string, call: string): boolean {
  if (obj === SCENE_CAMERA) return !!SCENE_CAMERA_FUNCTIONS[call];
  const base = SCENE_BASE_FUNCTIONS[call];
  if (base) return base.prop !== "visible" && base.prop !== "nodes";
  return true;
}

/** Add an event (appended, so it wins ties at the same time) with default arguments; returns its index. */
export function addSceneEvent(doc: SceneDoc, obj: string, call: string, at: number, dur?: number): { doc: SceneDoc; index: number } {
  const ev: SceneEvent = clean({ at: roundSec(at), obj, call, args: defaultCallArgs(doc, obj, call, at), dur: dur && dur > 0 && callTweens(doc, obj, call) ? roundSec(dur) : undefined });
  const events = [...eventsOf(doc), ev];
  return { doc: { ...doc, events }, index: events.length - 1 };
}

/** Patch event `i` (at, dur, ease, args); `undefined` removes dur / ease / args. */
export function updateSceneEvent(doc: SceneDoc, i: number, patch: Partial<Pick<SceneEvent, "at" | "dur" | "ease" | "args">>): SceneDoc {
  const events = eventsOf(doc);
  if (!isObj(events[i])) return doc;
  const p = { ...patch };
  if (typeof p.at === "number") p.at = roundSec(p.at);
  if (typeof p.dur === "number") p.dur = p.dur > 0 ? roundSec(p.dur) : undefined;
  const next = clean({ ...events[i], ...p });
  if (JSON.stringify(next) === JSON.stringify(events[i])) return doc;
  return { ...doc, events: events.map((e, k) => (k === i ? next : e)) };
}

/** Set one argument of event `i` (`undefined` removes it). */
export function setSceneEventArg(doc: SceneDoc, i: number, name: string, value: unknown): SceneDoc {
  const e = eventsOf(doc)[i];
  if (!isObj(e)) return doc;
  return updateSceneEvent(doc, i, { args: clean({ ...(isObj(e.args) ? e.args : {}), [name]: value }) });
}

/** Change the call of event `i`: the arguments become the new call's defaults; dur and ease stay when it tweens. */
export function setSceneEventCall(doc: SceneDoc, i: number, call: string): SceneDoc {
  const e = eventsOf(doc)[i];
  if (!isObj(e) || e.call === call) return doc;
  const tw = callTweens(doc, e.obj, call);
  const next: SceneEvent = clean({ ...e, call, args: defaultCallArgs(doc, e.obj, call, e.at), dur: tw ? e.dur : undefined, ease: tw ? e.ease : undefined as SceneEase | undefined });
  return { ...doc, events: eventsOf(doc).map((x, k) => (k === i ? next : x)) };
}

/** Remove event `i`. */
export function removeSceneEvent(doc: SceneDoc, i: number): SceneDoc {
  const events = eventsOf(doc);
  if (!events[i]) return doc;
  return { ...doc, events: events.filter((_, k) => k !== i) };
}

/** Copy event `i` to start where it ends (or 0.5 s later); returns the copy's index. */
export function duplicateSceneEvent(doc: SceneDoc, i: number): { doc: SceneDoc; index: number } {
  const e = eventsOf(doc)[i];
  if (!isObj(e)) return { doc, index: i };
  const copy: SceneEvent = { ...structuredClone(e), at: roundSec(e.at + (e.dur && e.dur > 0 ? e.dur : 0.5)) };
  const events = [...eventsOf(doc), copy];
  return { doc: { ...doc, events }, index: events.length - 1 };
}

// ---------------------------------------------------------------- tracks (read model)

/** An event drawn as a block on its object's track; `row` stacks blocks that overlap in time. */
export interface SceneBlock { index: number; at: number; dur: number; end: number; call: string; row: number }
export interface SceneTrack {
  /** The object id (`camera` for the camera; "#scene", "#light-<i>" and "" (unknown objects) never take events). */
  id: string; label: string; kind: "scene" | "camera" | "shape" | "model" | "script" | "light" | "missing"; detail: string; rows: number; blocks: SceneBlock[];
  /** P81b: a light track's index in the drawn lights. */
  light?: number;
}
/** P81b: the Scene track's id (scene-wide settings; no events). */
export const SCENE_TRACK = "#scene";

/**
 * The tracks of the scene editor. P81b: the Scene track (name, length, background, lights; no events), the Camera
 * track (its moves), one per object in order, one per light (lights are static: no events), then one for events
 * that name an object that doesn't exist. Blocks are sorted by time; a block with no duration takes `minSec` of room
 * when stacking, so labels don't overlap.
 */
export function sceneTracks(doc: SceneDoc, minSec = 0.4): SceneTrack[] {
  const tracks: SceneTrack[] = [
    { id: SCENE_TRACK, label: "Scene", kind: "scene", detail: "name, length, background, lights", rows: 1, blocks: [] },
    { id: SCENE_CAMERA, label: "Camera", kind: "camera", detail: "position, look-at point, field of view", rows: 1, blocks: [] },
  ];
  for (const o of objectsOf(doc)) {
    if (!isObj(o) || typeof o.id !== "string") continue;
    const script = isObj(o.script) && typeof o.script.file === "string" ? o.script.file : undefined;
    tracks.push({ id: o.id, label: typeof o.name === "string" && o.name ? o.name : o.id, kind: script ? "script" : typeof o.model === "string" ? "model" : "shape",
      detail: script ? `script ${script}` : typeof o.model === "string" ? o.model : o.shape ?? "box", rows: 1, blocks: [] });
  }
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const { lights, defaults } = sceneLights(doc);
  lights.forEach((l, i) => tracks.push({ id: `#light-${i}`, label: sceneLightLabel(l, i), kind: "light", detail: `${l.type} light${defaults ? " (default)" : ""}`, rows: 1, blocks: [], light: i }));
  let missing: SceneTrack | undefined;
  eventsOf(doc).forEach((e, index) => {
    if (!isObj(e) || typeof e.at !== "number" || !Number.isFinite(e.at)) return;
    let t = byId.get(String(e.obj));
    if (!t) { if (!missing) missing = { id: "", label: "Unknown objects", kind: "missing", detail: "events whose object is gone", rows: 1, blocks: [] }; t = missing; }
    const dur = typeof e.dur === "number" && e.dur > 0 ? e.dur : 0;
    t.blocks.push({ index, at: e.at, dur, end: e.at + dur, call: String(e.call), row: 0 });
  });
  if (missing) tracks.push(missing);
  for (const t of tracks) {
    t.blocks.sort((a, b) => a.at - b.at || a.index - b.index);
    const rowEnds: number[] = [];
    for (const b of t.blocks) {
      const end = b.at + Math.max(b.dur, minSec);
      let r = rowEnds.findIndex((x) => x <= b.at + 1e-9);
      if (r < 0) { r = rowEnds.length; rowEnds.push(end); } else rowEnds[r] = end;
      b.row = r;
    }
    t.rows = Math.max(1, rowEnds.length);
  }
  return tracks;
}

/** Seconds the editor's ruler should show: the clip length, the scene's planned length and the last event's end. */
export function sceneSpan(doc: SceneDoc, clipSec = 0): number {
  const ends = eventsOf(doc).filter((e) => isObj(e) && typeof e.at === "number").map((e) => e.at + (typeof e.dur === "number" && e.dur > 0 ? e.dur : 0));
  return Math.max(1, clipSec, typeof doc.durationSec === "number" ? doc.durationSec : 0, ...ends);
}

/** The camera's start values with the defaults filled in (for the scene form). */
export function sceneCameraBase(doc: SceneDoc): { fov: number; position: Vec3; lookAt: Vec3; background: string } {
  const w: SceneWorld = isObj(doc.world) ? doc.world : {};
  const c: NonNullable<SceneWorld["camera"]> = isObj(w.camera) ? w.camera : {};
  return { fov: c.fov ?? SCENE_DEFAULTS.fov, position: c.position ?? SCENE_DEFAULTS.cameraPosition, lookAt: c.lookAt ?? SCENE_DEFAULTS.cameraTarget, background: w.background ?? SCENE_DEFAULTS.background };
}
