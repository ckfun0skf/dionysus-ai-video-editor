/**
 * P81a: what a drag in the scene editor's Edit view writes (docs/v2/SCENE_FORMAT.md, Edit view). Pure operations on a
 * `dionysus.scene/1` scene, like domain/sceneEdit.ts: a move, rotate or scale gizmo drag of an object ends with its new
 * position, rotation (degrees, XYZ) and scale, and the scene changes in exactly one place:
 *
 * - the selected event, when it is on that object and sets the dragged property (`moveTo` / `position`, `rotation`,
 *   `scale`): its end value (the Edit view shows the scene at that event's end, so the drag lands where it ends);
 * - else, with Auto-key on, a key that ends at the playhead: the event of that property ending there is updated, or a
 *   new tween is added from the end of the previous one (or from 0 s) to the playhead (an instant one when that leaves
 *   no time);
 * - else the object's own (start) value.
 *
 * P81b: the camera and lights are gizmo targets too (moved only). The camera's position (`camera`) and its look-at
 * point (`camera:target`) follow the same rules with the camera's calls (`moveTo` / `position`, `lookAt`) and its start
 * values (`world.camera.position` / `lookAt`); a light (`light:<index>`) is static, so a drag always sets its position.
 * Rotations come back from the gizmo as Euler angles in (-180°, 180°]; `from` (the value when the drag started) puts
 * each angle back next to the one it started from, so 360° + 10° stays 370°, not 10°.
 */
import { SCENE_BASE_FUNCTIONS, SCENE_CAMERA, SCENE_CAMERA_FUNCTIONS, type SceneDoc, type SceneEvent, type Vec3 } from "./scene";
import { addSceneEvent, lightHasPosition, roundSec, sceneLightLabel, sceneLights, setSceneEventArg, updateSceneLight, updateSceneObject, updateSceneWorld } from "./sceneEdit";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoProp = "position" | "rotation" | "scale";
/** An object's transform as the gizmo leaves it: position, rotation in degrees (XYZ), scale. */
export interface GizmoValue { position: Vec3; rotation: Vec3; scale: Vec3 }

export const GIZMO_PROP: Record<GizmoMode, GizmoProp> = { translate: "position", rotate: "rotation", scale: "scale" };
/** The calls that set each property (a new key uses the first). */
const CALLS: Record<GizmoProp, string[]> = { position: ["moveTo", "position"], rotation: ["rotation"], scale: ["scale"] };
/** A call sets the gizmo property (lookAt turns the object too, but to a target, so a drag can't write it). */
export const gizmoPropOfCall = (call: string): GizmoProp | undefined =>
  (Object.keys(CALLS) as GizmoProp[]).find((p) => CALLS[p].includes(call));
export const gizmoModeOfProp: Record<GizmoProp, GizmoMode> = { position: "translate", rotation: "rotate", scale: "scale" };

/** P81b: the Edit view's id for the camera's look-at point. */
export const GIZMO_CAMERA_TARGET = "camera:target";
/** P81b: the Edit view's id for light `i` (":" is never in an object id). */
export const gizmoLightId = (i: number) => `light:${i}`;
export const gizmoLightIndex = (id: string): number | undefined => { const m = /^light:(\d+)$/.exec(id); return m ? Number(m[1]) : undefined; };
/** P81b: a gizmo id that only moves (the camera, its target, lights). */
export const gizmoMovesOnly = (id: string): boolean => id === SCENE_CAMERA || id === GIZMO_CAMERA_TARGET || gizmoLightIndex(id) !== undefined;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * What a gizmo id drives: the event object and the calls that set the dragged property (the first is used for a new
 * key; none for a light), the argument a call takes, and how the start value is written. Undefined when the id names
 * nothing that can be dragged this way.
 */
interface Channel { obj: string; prop: string; calls: string[]; arg: (call: string) => string; base: (doc: SceneDoc, v: Vec3 | number) => SceneDoc; name: string }
function channel(doc: SceneDoc, id: string, mode: GizmoMode): Channel | undefined {
  if (id === SCENE_CAMERA || id === GIZMO_CAMERA_TARGET) {
    if (mode !== "translate") return undefined;
    const target = id === GIZMO_CAMERA_TARGET;
    return {
      obj: SCENE_CAMERA, prop: target ? "look-at point" : "position", calls: target ? ["lookAt"] : ["moveTo", "position"],
      arg: (call) => SCENE_CAMERA_FUNCTIONS[call].arg,
      base: (d, v) => updateSceneWorld(d, { camera: target ? { lookAt: v as Vec3 } : { position: v as Vec3 } }), name: "the camera",
    };
  }
  const li = gizmoLightIndex(id);
  if (li !== undefined) {
    const l = sceneLights(doc).lights[li];
    if (!l || !lightHasPosition(l) || mode !== "translate") return undefined;
    return { obj: id, prop: "position", calls: [], arg: () => "", base: (d, v) => updateSceneLight(d, li, { position: v as Vec3 }), name: sceneLightLabel(l, li) };
  }
  if (!(Array.isArray(doc.objects) && doc.objects.some((x) => isObj(x) && x.id === id))) return undefined;
  const prop = GIZMO_PROP[mode];
  return { obj: id, prop, calls: CALLS[prop], arg: (call) => SCENE_BASE_FUNCTIONS[call].arg, base: (d, v) => updateSceneObject(d, id, { [prop]: v }), name: id };
}

export type GizmoTarget =
  | { kind: "event"; index: number; call: string }
  | { kind: "key"; index: number; call: string }
  | { kind: "newKey"; call: string; at: number; dur?: number }
  | { kind: "base" };

export interface GizmoOptions {
  /** Index of the selected event, if any. */
  selEvent?: number;
  autoKey: boolean;
  /** The playhead in scene seconds. */
  at: number;
}

function targetOf(doc: SceneDoc, c: Channel, o: GizmoOptions): GizmoTarget {
  const events = eventsOf(doc);
  const sets = (e: SceneEvent) => isObj(e) && e.obj === c.obj && c.calls.includes(e.call);
  const sel = o.selEvent !== undefined ? events[o.selEvent] : undefined;
  if (sel && sets(sel)) return { kind: "event", index: o.selEvent!, call: sel.call };
  if (!o.autoKey || !c.calls.length) return { kind: "base" };
  const at = roundSec(o.at);
  const same = events.map((e, i) => ({ e, i })).filter(({ e }) => sets(e));
  const ending = same.filter(({ e }) => near(e.at + (e.dur ?? 0), at)).at(-1);
  if (ending) return { kind: "key", index: ending.i, call: ending.e.call };
  const prevEnd = Math.max(0, ...same.map(({ e }) => e.at + (e.dur ?? 0)).filter((end) => end < at - 0.0005));
  const start = roundSec(prevEnd);
  return at - start > 0.0005 ? { kind: "newKey", call: c.calls[0], at: start, dur: roundSec(at - start) } : { kind: "newKey", call: c.calls[0], at };
}

/** Where a drag of gizmo id `obj` with `mode` writes (see the module comment). */
export function gizmoTarget(doc: SceneDoc, obj: string, mode: GizmoMode, o: GizmoOptions): GizmoTarget {
  const c = channel(doc, obj, mode);
  return c ? targetOf(doc, c, o) : { kind: "base" };
}

/** `deg` moved by whole turns to the angle nearest `ref` (so a drag from 360° to 10° reads 370°). */
export const unwrapDeg = (deg: number, ref: number): number => deg + 360 * Math.round((ref - deg) / 360);

/**
 * The value written for the property: rounded to 1/1000; a uniform scale as one number; scale stays above zero;
 * rotations unwrapped next to `from` (the value when the drag started).
 */
export function gizmoArg(prop: GizmoProp, v: GizmoValue, from?: GizmoValue): Vec3 | number {
  if (prop === "scale") {
    const s = v.scale.map((x) => Math.max(0.001, r3(x))) as Vec3;
    return s[0] === s[1] && s[1] === s[2] ? s[0] : s;
  }
  const raw = prop === "rotation" && from ? v.rotation.map((x, k) => unwrapDeg(x, from.rotation[k])) : v[prop];
  return raw.map((x) => r3(x) + 0) as Vec3; // + 0 turns -0 into 0
}

/** Apply a finished drag; returns the new scene (unchanged when nothing differs), the event it wrote and a note. */
export function applyGizmo(doc: SceneDoc, obj: string, mode: GizmoMode, value: GizmoValue, o: GizmoOptions & { from?: GizmoValue }): { doc: SceneDoc; index?: number; note: string } {
  const c = channel(doc, obj, mode);
  if (!c) return { doc, note: gizmoMovesOnly(obj) ? "This can only be moved." : `There is no object “${obj}”.` };
  const prop = obj === SCENE_CAMERA || obj === GIZMO_CAMERA_TARGET || gizmoLightIndex(obj) !== undefined ? "position" : GIZMO_PROP[mode];
  const v = gizmoArg(prop, value, o.from);
  const t = targetOf(doc, c, o);
  const verb = mode === "translate" ? "Moved" : mode === "rotate" ? "Rotated" : "Scaled";
  const what = obj === GIZMO_CAMERA_TARGET ? "the camera's look-at point" : c.obj === SCENE_CAMERA ? "the camera" : `“${c.name}”`;
  if (t.kind === "base") return { doc: c.base(doc, v), note: `${verb} ${what} (its start ${c.prop}).` };
  if (t.kind === "event" || t.kind === "key") {
    const e = eventsOf(doc)[t.index];
    const wasObj = typeof e.args?.[c.arg(t.call)] === "string" ? ` (it aimed at “${e.args![c.arg(t.call)]}”; now a point)` : "";
    return { doc: setSceneEventArg(doc, t.index, c.arg(t.call), v), index: t.index, note: `${verb} ${what}: ${e.obj}.${e.call} at ${e.at}s now ends there${wasObj}.` };
  }
  const added = addSceneEvent(doc, c.obj, t.call, t.at, t.dur);
  const next = setSceneEventArg(added.doc, added.index, c.arg(t.call), v);
  return { doc: next, index: added.index, note: `${verb} ${what}: added ${c.obj}.${t.call} at ${t.at}s${t.dur ? ` for ${t.dur}s` : ""} (Auto-key).` };
}

/**
 * The scene time the Edit view shows: the selected event's end when the gizmo writes that event (so the object is
 * drawn where the drag will put it), else the playhead.
 */
export function gizmoViewTime(doc: SceneDoc, obj: string | undefined, mode: GizmoMode, o: GizmoOptions): number {
  if (!obj) return o.at;
  const t = gizmoTarget(doc, obj, mode, { ...o, autoKey: false });
  if (t.kind !== "event") return o.at;
  const e = eventsOf(doc)[t.index];
  return roundSec(e.at + (e.dur ?? 0));
}

/** A short line for the chip bar: where the next drag writes. */
export function gizmoTargetLabel(doc: SceneDoc, obj: string, mode: GizmoMode, o: GizmoOptions): string {
  const c = channel(doc, obj, mode);
  if (!c) return gizmoMovesOnly(obj) ? "nothing: this can only be moved (Move)" : "nothing";
  const t = targetOf(doc, c, o);
  const who = c.obj === SCENE_CAMERA ? "the camera" : c.name;
  // P82: "particles' start position", not "particles's".
  const of = /s$/.test(who) ? `${who}'` : `${who}'s`;
  if (t.kind === "base") return gizmoLightIndex(obj) !== undefined ? `${of} position (lights don't animate)` : `${of} start ${c.prop}`;
  if (t.kind === "newKey") return `new ${c.obj}.${t.call} ending at ${roundSec(o.at)}s`;
  const e = eventsOf(doc)[t.index];
  return `${e.obj}.${e.call} at ${e.at}s (its end)`;
}
