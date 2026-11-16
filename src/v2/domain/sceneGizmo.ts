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
 */
import { SCENE_BASE_FUNCTIONS, SCENE_CAMERA, type SceneDoc, type SceneEvent, type Vec3 } from "./scene";
import { addSceneEvent, roundSec, setSceneEventArg, updateSceneObject } from "./sceneEdit";

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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

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

/** Where a drag of `obj` with `mode` writes (see the module comment). */
export function gizmoTarget(doc: SceneDoc, obj: string, mode: GizmoMode, o: GizmoOptions): GizmoTarget {
  const prop = GIZMO_PROP[mode];
  const events = eventsOf(doc);
  const sel = o.selEvent !== undefined ? events[o.selEvent] : undefined;
  if (sel && sel.obj === obj && gizmoPropOfCall(sel.call) === prop) return { kind: "event", index: o.selEvent!, call: sel.call };
  if (!o.autoKey) return { kind: "base" };
  const at = roundSec(o.at);
  const same = events.map((e, i) => ({ e, i })).filter(({ e }) => isObj(e) && e.obj === obj && gizmoPropOfCall(e.call) === prop);
  const ending = same.filter(({ e }) => near(e.at + (e.dur ?? 0), at)).at(-1);
  if (ending) return { kind: "key", index: ending.i, call: ending.e.call };
  const prevEnd = Math.max(0, ...same.map(({ e }) => e.at + (e.dur ?? 0)).filter((end) => end < at - 0.0005));
  const start = roundSec(prevEnd);
  return at - start > 0.0005 ? { kind: "newKey", call: CALLS[prop][0], at: start, dur: roundSec(at - start) } : { kind: "newKey", call: CALLS[prop][0], at };
}

/** The value written for the property: rounded to 1/1000; a uniform scale as one number; scale stays above zero. */
export function gizmoArg(prop: GizmoProp, v: GizmoValue): Vec3 | number {
  if (prop === "scale") {
    const s = v.scale.map((x) => Math.max(0.001, r3(x))) as Vec3;
    return s[0] === s[1] && s[1] === s[2] ? s[0] : s;
  }
  return v[prop].map((x) => r3(x) + 0) as Vec3; // + 0 turns -0 into 0
}

/** Apply a finished drag; returns the new scene (unchanged when nothing differs), the event it wrote and a note. */
export function applyGizmo(doc: SceneDoc, obj: string, mode: GizmoMode, value: GizmoValue, o: GizmoOptions): { doc: SceneDoc; index?: number; note: string } {
  if (obj === SCENE_CAMERA || !(Array.isArray(doc.objects) && doc.objects.some((x) => isObj(x) && x.id === obj))) return { doc, note: `There is no object “${obj}”.` };
  const prop = GIZMO_PROP[mode];
  const v = gizmoArg(prop, value);
  const t = gizmoTarget(doc, obj, mode, o);
  const verb = mode === "translate" ? "Moved" : mode === "rotate" ? "Rotated" : "Scaled";
  if (t.kind === "base") return { doc: updateSceneObject(doc, obj, { [prop]: v }), note: `${verb} “${obj}” (its start ${prop}).` };
  if (t.kind === "event" || t.kind === "key") {
    const arg = SCENE_BASE_FUNCTIONS[t.call].arg;
    const next = setSceneEventArg(doc, t.index, arg, v);
    const e = eventsOf(doc)[t.index];
    return { doc: next, index: t.index, note: `${verb} “${obj}”: ${e.obj}.${e.call} at ${e.at}s now ends there.` };
  }
  const added = addSceneEvent(doc, obj, t.call, t.at, t.dur);
  const next = setSceneEventArg(added.doc, added.index, SCENE_BASE_FUNCTIONS[t.call].arg, v);
  return { doc: next, index: added.index, note: `${verb} “${obj}”: added ${obj}.${t.call} at ${t.at}s${t.dur ? ` for ${t.dur}s` : ""} (Auto-key).` };
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
  const t = gizmoTarget(doc, obj, mode, o);
  const prop = GIZMO_PROP[mode];
  if (t.kind === "base") return `${obj}'s start ${prop}`;
  if (t.kind === "newKey") return `new ${obj}.${t.call} ending at ${roundSec(o.at)}s`;
  const e = eventsOf(doc)[t.index];
  return `${e.obj}.${e.call} at ${e.at}s (its end)`;
}
