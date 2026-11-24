/**
 * Scene agent operations (P78, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 2 step 2.5): what the scene clip type's
 * WebMCP tools do to a `dionysus.scene/1` scene, as pure functions. The tool declarations and the AI guide rule live
 * in clipTypes/scene/agentDefs.ts; clipTypes/scene/agent.ts reads the clip's scene, calls `applySceneTool`, stores the
 * result as a scene version and makes ONE undo step.
 *
 * Every edit is checked twice: before (the object, call, argument names and values the agent named, with the valid
 * choices in the message) and after (the scene validator: an edit that adds an error is refused, nothing changes).
 * Warnings the edit touches are returned so the agent can fix them.
 */
import {
  addSceneModel, cameraKeyOf, lookTargetOf, sceneCameraDefs, sceneShots, SCENE_BASE_FUNCTIONS, SCENE_CAMERA, SCENE_CAMERA_FUNCTIONS, SCENE_EASES, SCENE_FORMAT, SCENE_LIGHTS, SCENE_SHAPES,
  SCENE_MIME, isVec3, sortedEvents, validateScene, type SceneDoc, type SceneEvent, type SceneIssue, type SceneLight, type SceneObject, type SceneShape,
} from "./scene";
import {
  addSceneLight, addSceneObject, callTweens, defaultCallArgs, lightIdProblem, removeSceneEvent, removeSceneLight, removeSceneObject, renameSceneObject,
  addSceneAnimation, addSceneCamera, removeSceneAnimation, removeSceneCamera, setSceneShots, updateSceneCamera, roundSec, sceneCallArgs, sceneCalls, sceneCameraBase, sceneLightIndex, sceneLights, updateSceneLight, updateSceneLook, updateSceneObject, updateSceneWorld, type SceneArgField,
} from "./sceneEdit";
import { SCENE_LOOK_IDS } from "./sceneLook";
import { BUILTIN_CLIP_NAMES, SCENE_CHARACTER_CALLS } from "./sceneCharacter";
import { SCENE_CAMERA_RIGS } from "./sceneCamera";
import { moveSceneEventTo } from "./sceneRetime";
import { addSceneScript, removeSceneScript, SCENE_SCRIPT_TEMPLATES, sceneScriptCode, setSceneScriptCode, setSceneScriptParams } from "./sceneScript";
import { SCENE_SCRIPT_MAX, scriptParamsProblem, scriptProblems, type SceneScriptParams } from "./sceneScriptCode";
import { applyScenePreset, blockAction, setMood, stageScene, type Beat, type MoodSpec, type StageBrief } from "./sceneStage";
import type { AssetVersion } from "./model";

/** A scene version's media: the JSON blob at 1920×1080, no length (a scene's length is free, like a code clip's). */
export const sceneMediaRef = (blobKey: string): AssetVersion["media"] => ({ blobKey, mime: SCENE_MIME, width: 1920, height: 1080 });

/** The tools that change a scene (the others read it). */
export const SCENE_EDIT_TOOLS = [
  "add_scene_object", "set_scene_object", "remove_scene_object", "add_scene_event", "update_scene_event", "retime_scene_event",
  "remove_scene_event", "set_scene_world", "set_scene_light", "set_scene_script", "set_scene_animation", "set_scene_camera", "set_scene_shots",
  // Scene Phase 4 (#353): semantic tools that compile intent into the fields and events above.
  "stage_scene", "block_action", "set_mood", "apply_scene_preset",
] as const;
export type SceneEditTool = (typeof SCENE_EDIT_TOOLS)[number];
export const isSceneEditTool = (n: string): n is SceneEditTool => (SCENE_EDIT_TOOLS as readonly string[]).includes(n);

export type SceneToolResult = { ok: true; doc: SceneDoc; info: Record<string, unknown>; warnings: string[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (error: string): SceneToolResult => ({ ok: false, error });
const objectsOf = (doc: SceneDoc): SceneObject[] => (Array.isArray(doc.objects) ? doc.objects : []);
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
const numOk = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const issueText = (i: SceneIssue) => `${i.path ? `${i.path}: ` : ""}${i.message}`;

/** "camera, ball, cube" — every id an event may name. */
export const sceneObjectIds = (doc: SceneDoc): string[] => [SCENE_CAMERA, ...objectsOf(doc).filter((o) => isObj(o) && typeof o.id === "string").map((o) => o.id)];

/** Scene Phase 1 (#350): what else events may name: lights with an id, and world.post / fog / sky when the scene has them. */
export const sceneLookTargets = (doc: SceneDoc): string[] => [
  ...sceneLights(doc).lights.flatMap((l) => (l.id && lookTargetOf(doc, l.id) ? [l.id] : [])),
  ...SCENE_LOOK_IDS.filter((id) => isObj(doc.world) && isObj((doc.world as Record<string, unknown>)[id]) && lookTargetOf(doc, id)),
];

/** A short hint of what an argument takes. */
export function argHint(f: SceneArgField): string {
  switch (f.kind) {
    case "vec3": return "[x, y, z]";
    case "scale": return "number or [x, y, z]";
    case "target": return `${f.angle ? "object id, [x, y, z] or an angle in degrees" : f.camera ? "object id, [x, y, z] or \"camera\"" : "object id or [x, y, z]"}${f.optional ? ", optional" : ""}`;
    case "points": return "[x, y, z] or a list of [x, y, z] (a path on the floor)";
    case "expressions": return "{ happy | angry | sad | surprised | relaxed | blink | aa | ih | ou | ee | oh: 0–1 }";
    case "text": return `text${f.optional ? ", optional" : ""}`;
    case "visemes": return "[[seconds, aa | ih | ou | ee | oh, weight 0–1], …], optional";
    case "number": return `number${f.min !== undefined || f.max !== undefined ? ` ${f.min ?? "…"}..${f.max ?? "…"}` : ""}${f.optional ? ", optional" : ""}`;
    case "bool": return "true or false";
    case "color": return "\"#rrggbb\"";
    case "select": return `${f.options.length ? f.options.map((o) => JSON.stringify(o)).join(" | ") : "text"}${f.free ? " (or another name)" : ""}${f.optional ? ", optional" : ""}`;
    case "nodes": return `{ "<node>": true | false }${f.nodes?.length ? ` with nodes ${f.nodes.join(", ")}` : ""}`;
    case "param": return `${f.param.type}${f.param.options ? ` ${f.param.options.map((o) => JSON.stringify(o)).join(" | ")}` : ""}${f.param.min !== undefined || f.param.max !== undefined ? ` ${f.param.min ?? "…"}..${f.param.max ?? "…"}` : ""} (default ${JSON.stringify(f.param.default)})`;
  }
}
const argList = (fields: SceneArgField[]) => (fields.length ? fields.map((f) => `${f.name}: ${argHint(f)}`).join("; ") : "no arguments");

/** The object `id` (or a message naming the ones there are). */
function needObject(doc: SceneDoc, id: unknown, camera = false): string | undefined {
  if (typeof id !== "string" || !id) return `Name an object. Objects: ${(camera ? sceneObjectIds(doc) : sceneObjectIds(doc).slice(1)).join(", ") || "none yet (add_scene_object)"}.`;
  if (id === SCENE_CAMERA) return camera ? undefined : `"camera" is not an object here; use set_scene_world for the camera's start, events for its moves.`;
  // Scene Phase 3 (#352): the other cameras take events too.
  if (cameraKeyOf(doc, id)) return camera ? undefined : `"${id}" is a camera: change it with set_scene_camera (its moves are events on "${id}").`;
  if (!objectsOf(doc).some((o) => isObj(o) && o.id === id)) {
    // Scene Phase 1 (#350): events may also name a light (with an id) or world.post / fog / sky.
    const look = lookTargetOf(doc, id);
    const declared = look && (look.kind === "light" || (isObj(doc.world) && isObj((doc.world as Record<string, unknown>)[look.kind])));
    if (look && !declared) return `The scene has no world.${id}; add it with set_scene_world first${camera ? `, then add events on "${id}"` : ""}.`;
    if (look && camera) return undefined;
    if (look?.kind === "light") return `"${id}" is a light: change it with set_scene_light (its changes over time are events on "${id}").`;
    if (look) return `"${id}" is world.${id}: set it with set_scene_world (its changes over time are events on "${id}").`;
    const more = camera ? sceneLookTargets(doc) : [];
    return `No object "${id}". Objects: ${sceneObjectIds(doc).join(", ")}${more.length ? `; lights and world: ${more.join(", ")}` : ""}. Add one with add_scene_object.`;
  }
  return undefined;
}

/** Check `call` and `args` on `obj` (names, then the validator does values). */
function checkCall(doc: SceneDoc, obj: string, call: unknown, args: unknown): string | undefined {
  const calls = sceneCalls(doc, obj);
  if (typeof call !== "string" || !calls.some((c) => c.call === call)) {
    const base = calls.filter((c) => c.kind !== "custom").map((c) => c.call), own = calls.filter((c) => c.kind === "custom").map((c) => c.call);
    return `"${obj}" has no call ${JSON.stringify(call ?? "")}. Its calls: ${base.join(", ")}${own.length ? `; its own functions: ${own.join(", ")}` : ""}.`;
  }
  if (args !== undefined && !isObj(args)) return `"args" must be an object: ${obj}.${call} takes ${argList(sceneCallArgs(doc, obj, call))}.`;
  const fields = sceneCallArgs(doc, obj, call), names = new Set(fields.map((f) => f.name));
  const extra = Object.keys(isObj(args) ? args : {}).filter((k) => !names.has(k));
  if (extra.length) return `${obj}.${call} has no argument ${extra.map((k) => `"${k}"`).join(", ")}. It takes ${argList(fields)}.`;
  return undefined;
}

/** Refuse an edit that adds a validation error; else the warnings it touches. */
function guard(before: SceneDoc, after: SceneDoc, touched: string[]): { error?: string; warnings: string[] } {
  const was = new Set(validateScene(before).map((i) => `${i.level}|${issueText(i)}`));
  const now = validateScene(after);
  const added = now.filter((i) => !was.has(`${i.level}|${issueText(i)}`));
  const errors = added.filter((i) => i.level === "error");
  if (errors.length) return { error: `The scene would not be valid, nothing changed: ${errors.slice(0, 5).map(issueText).join(" ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`, warnings: [] };
  const near = (i: SceneIssue) => touched.some((t) => i.path === t || i.path.startsWith(`${t}.`) || i.path.startsWith(`${t}[`));
  return { warnings: now.filter((i) => i.level === "warning" && (added.includes(i) || near(i))).map(issueText) };
}

const done = (before: SceneDoc, after: SceneDoc, info: Record<string, unknown>, touched: string[]): SceneToolResult => {
  if (after === before) return { ok: true, doc: before, info: { ...info, unchanged: true }, warnings: [] };
  const g = guard(before, after, touched);
  return g.error ? fail(g.error) : { ok: true, doc: after, info, warnings: g.warnings };
};

const OBJECT_KEYS = ["name", "shape", "size", "color", "position", "rotation", "scale", "visible", "opacity", "material", "character", "model", "animation", "nodes", "functions"] as const;
type ObjectKey = (typeof OBJECT_KEYS)[number];

/** Object fields from an input object; `null` removes a field. */
function objectPatch(from: Record<string, unknown>): { patch: Partial<Record<ObjectKey, unknown>> } | { error: string } {
  const patch: Partial<Record<ObjectKey, unknown>> = {};
  for (const [k, v] of Object.entries(from)) {
    if (!(OBJECT_KEYS as readonly string[]).includes(k)) return { error: `Unknown object field "${k}". Fields: ${OBJECT_KEYS.join(", ")} (null removes one).` };
    if (k === "shape" && v !== null && !SCENE_SHAPES.includes(v as SceneShape)) return { error: `"shape" must be one of ${SCENE_SHAPES.join(", ")}.` };
    patch[k as ObjectKey] = v === null ? undefined : v;
  }
  return { patch };
}

function applyObjectPatch(doc: SceneDoc, id: string, patch: Partial<Record<ObjectKey, unknown>>): SceneDoc {
  const { functions, ...rest } = patch;
  let next = Object.keys(rest).length ? updateSceneObject(doc, id, rest as Parameters<typeof updateSceneObject>[2]) : doc;
  if ("functions" in patch) {
    next = { ...next, objects: objectsOf(next).map((o) => {
      if (o.id !== id) return o;
      const { functions: _old, ...keep } = o; void _old;
      return functions === undefined ? keep : { ...keep, functions: functions as SceneObject["functions"] };
    }) };
  }
  return next;
}

/** An event index the agent gave (or a message with the range and a listing hint). */
function needEvent(doc: SceneDoc, index: unknown): number | string {
  const n = eventsOf(doc).length;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= n) return n ? `"index" must be an event index 0..${n - 1} (list_scene_objects lists them).` : "The scene has no events yet (add_scene_event).";
  return index;
}

const eventInfo = (doc: SceneDoc, i: number) => ({ index: i, event: eventsOf(doc)[i] });

/**
 * Apply scene tool `name` to `doc` with the tool's input. Pure; `{ ok: false, error }` names what to fix and the valid
 * choices. `info` is what the tool reports (ids, indices, counts).
 */
export function applySceneTool(name: SceneEditTool, doc: SceneDoc, a: Record<string, unknown>): SceneToolResult {
  switch (name) {
    case "add_scene_object": {
      const file = a.file;
      let d: SceneDoc, id: string;
      if (file !== undefined) {
        if (!isObj(file) || typeof file.name !== "string" || typeof file.dataUrl !== "string" || !/^data:/.test(file.dataUrl)) return fail('"file" must be { name: "robot.glb", dataUrl: "data:model/gltf-binary;base64,…" }.');
        if (!/\.(glb|vrm)$/i.test(file.name)) return fail("Only .glb models (and .vrm characters) can be added (a binary glTF in one file).");
        ({ doc: d, id } = addSceneModel(doc, file.name, file.dataUrl, numOk(a.size) ? a.size : undefined));
      } else if (typeof a.model === "string") {
        if (!isObj(doc.files) || typeof doc.files[a.model] !== "string") return fail(`No file "${a.model}" in the scene. Files: ${Object.keys(isObj(doc.files) ? doc.files : {}).join(", ") || "none"}. Give "file" { name, dataUrl } to add one.`);
        ({ doc: d, id } = addSceneObject(doc, "box"));
        d = updateSceneObject(d, id, { model: a.model, shape: undefined, size: numOk(a.size) ? a.size : 1.6 });
      } else {
        const shape = (a.shape ?? "box") as SceneShape;
        if (!SCENE_SHAPES.includes(shape)) return fail(`"shape" must be one of ${SCENE_SHAPES.join(", ")} (or give "file" for a GLB model).`);
        ({ doc: d, id } = addSceneObject(doc, shape));
      }
      if (a.id !== undefined) {
        if (typeof a.id !== "string") return fail('"id" must be text.');
        const r = renameSceneObject(d, id, a.id);
        if (r.error) return fail(`"id": ${r.error}`);
        d = r.doc; id = a.id;
      }
      const props = isObj(a.props) ? a.props : {};
      const p = objectPatch(props);
      if ("error" in p) return fail(p.error);
      d = applyObjectPatch(d, id, p.patch);
      const k = objectsOf(d).findIndex((o) => o.id === id);
      return done(doc, d, { objectId: id, object: objectsOf(d)[k] }, [`objects[${k}]`]);
    }
    case "set_scene_object": {
      const bad = needObject(doc, a.objectId); if (bad) return fail(bad);
      let id = a.objectId as string, d = doc;
      if (a.rename !== undefined) {
        if (typeof a.rename !== "string") return fail('"rename" must be the new id (text).');
        const r = renameSceneObject(d, id, a.rename);
        if (r.error) return fail(`"rename": ${r.error}`);
        d = r.doc; id = a.rename;
      }
      if (a.file !== undefined) {
        // P79: give the object a GLB model file (added to the scene's files; the object becomes that model).
        const file = a.file;
        if (!isObj(file) || typeof file.name !== "string" || typeof file.dataUrl !== "string" || !/^data:/.test(file.dataUrl)) return fail('"file" must be { name: "robot.glb", dataUrl: "data:model/gltf-binary;base64,…" } or { url }.');
        if (!/\.(glb|vrm)$/i.test(file.name)) return fail("Only .glb models (and .vrm characters) can be added (a binary glTF in one file).");
        d = { ...d, files: { ...(isObj(d.files) ? d.files : {}), [file.name]: file.dataUrl } };
        const cur = objectsOf(d).find((o) => o.id === id);
        d = updateSceneObject(d, id, { model: file.name, shape: undefined, ...(cur?.model ? {} : { size: 1.6 }) });
      }
      if (a.props !== undefined && !isObj(a.props)) return fail(`"props" must be an object of fields: ${OBJECT_KEYS.join(", ")}.`);
      const p = objectPatch(isObj(a.props) ? a.props : {});
      if ("error" in p) return fail(p.error);
      if ("model" in p.patch && typeof p.patch.model === "string" && !(isObj(d.files) && typeof d.files[p.patch.model] === "string")) return fail(`No file "${p.patch.model}" in the scene. Files: ${Object.keys(isObj(d.files) ? d.files : {}).join(", ") || "none"}.`);
      d = applyObjectPatch(d, id, p.patch);
      const k = objectsOf(d).findIndex((o) => o.id === id);
      return done(doc, d, { objectId: id, object: objectsOf(d)[k] }, [`objects[${k}]`]);
    }
    case "remove_scene_object": {
      const bad = needObject(doc, a.objectId); if (bad) return fail(bad);
      const r = removeSceneObject(doc, a.objectId as string);
      return done(doc, r.doc, { removed: a.objectId, removedEvents: r.removedEvents }, []);
    }
    case "add_scene_event": {
      const ev = isObj(a.event) ? a.event : undefined;
      if (!ev) return fail('"event" must be { at, obj, call, args?, dur?, ease? } (at and dur in seconds of scene time).');
      const bad = needObject(doc, ev.obj, true); if (bad) return fail(bad);
      const obj = ev.obj as string;
      const callBad = checkCall(doc, obj, ev.call, ev.args); if (callBad) return fail(callBad);
      if (!numOk(ev.at) || ev.at < 0) return fail('"at" must be a number of seconds ≥ 0 (scene time: 0 is the scene\'s start).');
      if (ev.dur !== undefined && (!numOk(ev.dur) || ev.dur < 0)) return fail('"dur" must be seconds ≥ 0 (leave it out for an instant change).');
      if (ev.ease !== undefined && !(SCENE_EASES as readonly string[]).includes(ev.ease as string)) return fail(`"ease" must be one of ${SCENE_EASES.join(", ")}.`);
      const call = ev.call as string, tw = callTweens(doc, obj, call);
      const notes: string[] = [];
      const missing = sceneCallArgs(doc, obj, call).filter((f) => !(isObj(ev.args) && f.name in ev.args) && !("optional" in f && f.optional)).map((f) => f.name);
      const args = { ...(missing.length ? defaultCallArgs(doc, obj, call, ev.at) : {}), ...(isObj(ev.args) ? ev.args : {}) };
      if (missing.length) notes.push(`Filled ${missing.join(", ")} with the value at ${ev.at} s (no visible change until set).`);
      if (ev.dur && !tw) notes.push(`${call} never tweens: "dur" was left out.`);
      const event: SceneEvent = { at: roundSec(ev.at), obj, call, ...(Object.keys(args).length ? { args } : {}), ...(numOk(ev.dur) && ev.dur > 0 && tw ? { dur: roundSec(ev.dur) } : {}), ...(ev.ease && tw ? { ease: ev.ease as SceneEvent["ease"] } : {}) };
      const events = [...eventsOf(doc), event];
      const d: SceneDoc = { ...doc, events };
      const r = done(doc, d, { ...eventInfo(d, events.length - 1), ...(notes.length ? { notes } : {}) }, [`events[${events.length - 1}]`]);
      return r;
    }
    case "update_scene_event": {
      const i = needEvent(doc, a.index); if (typeof i === "string") return fail(i);
      const cur = eventsOf(doc)[i];
      let d = doc;
      if (a.obj !== undefined && a.obj !== cur.obj) {
        const bad = needObject(doc, a.obj, true); if (bad) return fail(bad);
        const m = moveSceneEventTo(d, i, a.obj as string);
        if (m.error) return fail(m.error);
        d = m.doc;
      }
      const obj = String(eventsOf(d)[i].obj);
      const call = a.call !== undefined ? a.call : cur.call;
      if (a.args !== undefined && a.args !== null && !isObj(a.args)) return fail('"args" must be an object (its keys are merged; a null value removes one).');
      const given = isObj(a.args) ? Object.fromEntries(Object.entries(a.args).filter(([, v]) => v !== null)) : {};
      const callBad = checkCall(d, obj, call, given); if (callBad) return fail(callBad);
      const e = eventsOf(d)[i];
      let args: Record<string, unknown> = call !== e.call ? defaultCallArgs(d, obj, call as string, e.at) : { ...(isObj(e.args) ? e.args : {}) };
      if (isObj(a.args)) for (const [k, v] of Object.entries(a.args)) { if (v === null) delete args[k]; else args[k] = v; }
      if (a.at !== undefined && (!numOk(a.at) || a.at < 0)) return fail('"at" must be a number of seconds ≥ 0.');
      if (a.dur !== undefined && a.dur !== null && (!numOk(a.dur) || a.dur < 0)) return fail('"dur" must be seconds ≥ 0, or null to remove it.');
      if (a.ease !== undefined && a.ease !== null && !(SCENE_EASES as readonly string[]).includes(a.ease as string)) return fail(`"ease" must be one of ${SCENE_EASES.join(", ")}, or null.`);
      const tw = callTweens(d, obj, call as string);
      const next: SceneEvent = { ...e, call: call as string, args };
      if (numOk(a.at)) next.at = roundSec(a.at);
      if (a.dur === null || (numOk(a.dur) && a.dur === 0) || !tw) delete next.dur; else if (numOk(a.dur)) next.dur = roundSec(a.dur);
      if (a.ease === null || !tw) delete next.ease; else if (typeof a.ease === "string") next.ease = a.ease as SceneEvent["ease"];
      if (!Object.keys(args).length) delete next.args;
      const same = JSON.stringify(next) === JSON.stringify(eventsOf(doc)[i]);
      d = same ? doc : { ...d, events: eventsOf(d).map((x, k) => (k === i ? next : x)) };
      return done(doc, d, eventInfo(d, i), [`events[${i}]`]);
    }
    case "retime_scene_event": {
      const i = needEvent(doc, a.index); if (typeof i === "string") return fail(i);
      const e = eventsOf(doc)[i];
      if (a.at !== undefined && a.shiftSec !== undefined) return fail('Give "at" or "shiftSec", not both.');
      if (a.at !== undefined && (!numOk(a.at) || a.at < 0)) return fail('"at" must be seconds ≥ 0.');
      if (a.shiftSec !== undefined && !numOk(a.shiftSec)) return fail('"shiftSec" must be a number of seconds (negative moves earlier).');
      if (a.dur !== undefined && (!numOk(a.dur) || a.dur < 0)) return fail('"dur" must be seconds ≥ 0 (0 makes it instant).');
      if (a.dur && !callTweens(doc, String(e.obj), String(e.call))) return fail(`${e.obj}.${e.call} never tweens, so it has no "dur"; move it with "at" or "shiftSec".`);
      const at = numOk(a.at) ? a.at : numOk(a.shiftSec) ? e.at + a.shiftSec : e.at;
      if (at < 0) return fail(`That would start at ${Math.round(at * 1000) / 1000} s; events start at 0 s or later.`);
      const next: SceneEvent = { ...e, at: roundSec(at) };
      if (numOk(a.dur)) { if (a.dur > 0) next.dur = roundSec(a.dur); else delete next.dur; }
      const same = JSON.stringify(next) === JSON.stringify(e);
      const d = same ? doc : { ...doc, events: eventsOf(doc).map((x, k) => (k === i ? next : x)) };
      return done(doc, d, eventInfo(d, i), [`events[${i}]`]);
    }
    case "remove_scene_event": {
      const i = needEvent(doc, a.index); if (typeof i === "string") return fail(i);
      const removed = eventsOf(doc)[i];
      return done(doc, removeSceneEvent(doc, i), { removed, note: "Later events moved down one index." }, []);
    }
    case "set_scene_world": {
      let d = doc;
      if (a.name !== undefined) { if (a.name !== null && typeof a.name !== "string") return fail('"name" must be text.'); d = a.name ? { ...d, name: a.name } : (({ name: _n, ...r }) => (void _n, r as SceneDoc))(d); }
      if (a.durationSec !== undefined) {
        if (a.durationSec !== null && (!numOk(a.durationSec) || a.durationSec <= 0)) return fail('"durationSec" must be seconds > 0 (the planned length), or null.');
        d = numOk(a.durationSec) ? { ...d, durationSec: a.durationSec } : (({ durationSec: _x, ...r }) => (void _x, r as SceneDoc))(d);
      }
      if (a.background !== undefined) { if (typeof a.background !== "string") return fail('"background" must be "#rrggbb".'); d = updateSceneWorld(d, { background: a.background }); }
      if (a.camera !== undefined) {
        if (!isObj(a.camera)) return fail('"camera" must be { fov?, position?: [x, y, z], lookAt?: [x, y, z] } (its start; move it later with camera events).');
        const extra = Object.keys(a.camera).filter((k) => !["fov", "position", "lookAt"].includes(k));
        if (extra.length) return fail(`Unknown camera field ${extra.map((k) => `"${k}"`).join(", ")}: use fov, position, lookAt.`);
        d = updateSceneWorld(d, { camera: a.camera as never });
      }
      if (a.lights !== undefined) {
        if (a.lights !== null && !Array.isArray(a.lights)) return fail(`"lights" must be a list of { type: ${SCENE_LIGHTS.join(" | ")}, color?, intensity?, position? }, or null for the default lights.`);
        const world = { ...(isObj(d.world) ? d.world : {}) };
        if (a.lights === null) delete world.lights; else world.lights = a.lights as SceneLight[];
        d = { ...d, world };
      }
      // Scene Phase 1 (#350): the look — each replaces the whole entry; null removes it.
      for (const key of ["post", "fog", "sky", "environment", "export"] as const) {
        const v = a[key];
        if (v === undefined) continue;
        if (v !== null && !isObj(v) && !(key !== "environment" && key !== "export" && v === true)) return fail(`"${key}" must be an object (see the scene format), true for the defaults, or null to remove it.`);
        d = updateSceneLook(updateSceneLook(d, key, undefined), key, v === null ? undefined : v === true ? {} : v);
      }
      return done(doc, d, { world: d.world ?? {}, name: d.name, durationSec: d.durationSec }, ["world", "durationSec", "name"]);
    }
    case "set_scene_light": {
      // P81b: one light by id or index (omit "light" to add one); lights are static, so this sets its start for good.
      const { lights, defaults } = sceneLights(doc);
      const listing = () => `Lights: ${lights.map((l, k) => (l.id ? `${k} ("${l.id}", ${l.type})` : `${k} (${l.type})`)).join(", ")}${defaults ? " — the default lights; changing one writes them into the scene" : ""}.`;
      let d = doc, i: number;
      if (a.light === undefined || a.light === null) {
        if (a.remove === true) return fail(`Name the light to remove ("light": its id or index). ${listing()}`);
        const type = a.type ?? "point";
        if (!(SCENE_LIGHTS as readonly unknown[]).includes(type)) return fail(`"type" must be one of ${SCENE_LIGHTS.join(", ")}.`);
        d = addSceneLight(d, { type: type as SceneLight["type"], color: "#ffffff", intensity: 1, ...(type === "point" || type === "directional" ? { position: [0, 3, 2] as [number, number, number] } : {}) });
        i = lights.length;
      } else {
        const k = sceneLightIndex(doc, a.light);
        if (k === undefined) return fail(`No light ${JSON.stringify(a.light)}. ${listing()}`);
        i = k;
      }
      if (a.remove === true) return done(doc, removeSceneLight(d, i), { removed: lights[i], note: "Later lights moved down one index." }, ["world"]);
      const patch: Partial<SceneLight> = {};
      if (a.id !== undefined) {
        if (a.id === null || a.id === "") patch.id = undefined;
        else if (typeof a.id !== "string") return fail('"id" must be text (or null to remove it).');
        else { const why = lightIdProblem(d, i, a.id); if (why) return fail(`"id": ${why}`); patch.id = a.id; }
      }
      if (a.type !== undefined) { if (!(SCENE_LIGHTS as readonly unknown[]).includes(a.type)) return fail(`"type" must be one of ${SCENE_LIGHTS.join(", ")}.`); patch.type = a.type as SceneLight["type"]; }
      if (a.color !== undefined) { if (typeof a.color !== "string") return fail('"color" must be "#rrggbb".'); patch.color = a.color; }
      if (a.intensity !== undefined) { if (!numOk(a.intensity) || a.intensity < 0) return fail('"intensity" must be a number ≥ 0.'); patch.intensity = a.intensity; }
      if (a.position !== undefined) {
        if (a.position !== null && !isVec3(a.position)) return fail('"position" must be [x, y, z] (directional and point lights), or null.');
        patch.position = a.position === null ? undefined : a.position;
      }
      // Scene Phase 1 (#350): ground colour, aim, shadows.
      if (a.groundColor !== undefined) { if (a.groundColor !== null && typeof a.groundColor !== "string") return fail('"groundColor" must be "#rrggbb" (hemisphere lights), or null.'); patch.groundColor = a.groundColor ?? undefined; }
      if (a.lookAt !== undefined) { if (a.lookAt !== null && !isVec3(a.lookAt)) return fail('"lookAt" must be [x, y, z] (where a directional light aims), or null.'); patch.lookAt = a.lookAt ?? undefined; }
      if (a.shadow !== undefined) {
        if (a.shadow !== null && typeof a.shadow !== "boolean" && !isObj(a.shadow)) return fail('"shadow" must be true, false, { mapSize, bias, normalBias, radius, area } or null.');
        patch.shadow = a.shadow === null || a.shadow === false ? undefined : a.shadow as SceneLight["shadow"];
      }
      d = updateSceneLight(d, i, patch);
      return done(doc, d, { lightIndex: i, light: sceneLights(d).lights[i] }, [`world.lights[${i}]`]);
    }
    case "set_scene_camera": {
      // Scene Phase 3: add a camera (omit "camera"), change one ("camera": its id, "camera" = the default) or remove it.
      const cams = sceneCameraDefs(doc);
      const listing = `Cameras: ${cams.map((c) => c.id).join(", ")}.`;
      const fields: Record<string, unknown> = {};
      for (const k of ["name", "position", "lookAt", "fov", "lens"] as const) if (a[k] !== undefined) fields[k] = a[k] === null ? undefined : a[k];
      let d = doc, id: string;
      if (a.camera === undefined || a.camera === null) {
        if (a.remove === true) return fail(`Name the camera to remove. ${listing}`);
        if (a.id !== undefined && typeof a.id !== "string") return fail('"id" must be text.');
        const r = addSceneCamera(doc, numOk(a.at) ? a.at : 0, { ...(typeof a.id === "string" ? { id: a.id } : {}), ...(fields as object) });
        if (typeof a.id === "string" && r.id !== a.id) return fail(`"${a.id}" is taken (or reserved); pick another id.`);
        d = r.doc; id = r.id;
      } else {
        if (typeof a.camera !== "string" || !cams.some((c) => c.id === a.camera)) return fail(`No camera ${JSON.stringify(a.camera)}. ${listing}`);
        id = a.camera;
        if (a.remove === true) { if (id === SCENE_CAMERA) return fail("The default camera can't be removed."); return done(doc, removeSceneCamera(doc, id), { removed: id, note: "Its events and shots went too." }, ["world", "shots"]); }
        if (id === SCENE_CAMERA && fields.name !== undefined) return fail("The default camera has no name.");
        d = updateSceneCamera(doc, id, fields as never);
      }
      return done(doc, d, { camera: id, cameras: sceneCameraDefs(d).map((c) => c.id) }, ["world"]);
    }
    case "set_scene_shots": {
      if (a.shots === null) return done(doc, setSceneShots(doc, []), { shots: [] }, ["shots"]);
      if (!Array.isArray(a.shots)) return fail(`"shots" must be a list of { at, camera, name? } (camera ids: ${sceneCameraDefs(doc).map((c) => c.id).join(", ")}), or null to remove them.`);
      const d = setSceneShots(doc, a.shots as never);
      return done(doc, d, { shots: d.shots ?? [] }, ["shots"]);
    }
    case "stage_scene": {
      // Scene Phase 4: a brief → set pieces, characters, mood and cameras (domain/sceneStage.ts).
      if (a.brief === undefined || !isObj(a.brief)) return fail('"brief" must be { name?, durationSec?, stage?, style?, mood?, set?: [{ id?, kind, at?, facing?, size?, color? }], characters?: [{ id?, name?, at?, facing?, body? }], cameras?: [{ id?, subject?, shot?, angle?, height?, focalLength?, at? }] }.');
      if (a.replace !== undefined && typeof a.replace !== "boolean") return fail('"replace" must be true or false.');
      const r = stageScene(doc, a.brief as StageBrief, { replace: a.replace === true });
      if ("error" in r) return fail(r.error);
      return done(doc, r.doc, { ...r.report }, ["objects", "world", "shots"]);
    }
    case "block_action": {
      if (a.text !== undefined && typeof a.text !== "string") return fail('"text" must be the blocking as text, e.g. "Ana walks to the door, turns to Ben, camera pushes in".');
      if (a.beats !== undefined && !Array.isArray(a.beats)) return fail('"beats" must be a list of { who, do, target?, text?, clip?, shot?, angle?, height?, distance?, degrees?, at?, dur?, with? }.');
      if (a.at !== undefined && (!numOk(a.at) || a.at < 0)) return fail('"at" must be seconds ≥ 0 (when the first beat starts).');
      const r = blockAction(doc, { text: a.text as string | undefined, beats: a.beats as Beat[] | undefined, at: a.at as number | undefined });
      if ("error" in r) return fail(r.error);
      const first = eventsOf(doc).length;
      return done(doc, r.doc, { beats: r.beats.map((b) => ({ ...(b.text ? { text: b.text } : {}), who: b.beat.who, do: b.beat.do, at: b.at, dur: b.dur })), eventIndices: r.events.map((_, k) => first + k), endSec: r.endSec, ...(r.skipped.length ? { skipped: r.skipped } : {}), ...(r.notes.length ? { notes: r.notes } : {}) }, r.events.map((_, k) => `events[${first + k}]`));
    }
    case "set_mood": {
      const m: MoodSpec = {};
      for (const k of ["preset", "timeOfDay", "palette", "post"] as const) if (a[k] !== undefined) { if (typeof a[k] !== "string") return fail(`"${k}" must be text.`); (m as Record<string, unknown>)[k] = a[k]; }
      if (a.at !== undefined) { if (!numOk(a.at) || a.at < 0) return fail('"at" must be seconds ≥ 0.'); m.at = a.at; }
      if (a.dur !== undefined) { if (!numOk(a.dur) || a.dur <= 0) return fail('"dur" must be seconds > 0.'); m.dur = a.dur; }
      const r = setMood(doc, m);
      if ("error" in r) return fail(r.error);
      return done(doc, r.doc, { notes: r.notes, world: r.doc.world }, ["world"]);
    }
    case "apply_scene_preset": {
      if (a.preset === undefined) return fail('Give "preset": a built-in id (list_scene_presets) or a preset object.');
      for (const k of ["at", "dur"] as const) if (a[k] !== undefined && (!numOk(a[k]) || (a[k] as number) < 0)) return fail(`"${k}" must be seconds ≥ 0.`);
      const r = applyScenePreset(doc, a.preset, { at: a.at as number | undefined, dur: a.dur as number | undefined, camera: typeof a.camera === "string" ? a.camera : undefined, subject: typeof a.subject === "string" ? a.subject : undefined });
      if ("error" in r) return fail(r.error);
      return done(doc, r.doc, { notes: r.notes }, ["world", "objects"]);
    }
    case "set_scene_animation": {
      // Scene Phase 2 (#351): a library clip — add (file { url } or { name, dataUrl }) or change one, or remove it.
      if (typeof a.name !== "string" || !a.name) return fail(`Name the clip ("name"). Library: ${Object.keys(isObj(doc.animations) ? doc.animations : {}).join(", ") || "empty"}; built-in: ${BUILTIN_CLIP_NAMES.join(", ")}.`);
      const lib = isObj(doc.animations) ? doc.animations : {};
      if (a.remove === true) {
        if (!lib[a.name]) return fail(`No library clip "${a.name}". Library: ${Object.keys(lib).join(", ") || "empty"}.`);
        return done(doc, removeSceneAnimation(doc, a.name), { removed: a.name }, ["animations"]);
      }
      const extra: Record<string, unknown> = {};
      for (const k of ["clip", "stride", "length", "loop", "mask", "rig"] as const) if (a[k] !== undefined) extra[k] = a[k] === null ? undefined : a[k];
      let d = doc;
      if (a.file !== undefined) {
        const file = a.file;
        if (!isObj(file) || typeof file.name !== "string" || typeof file.dataUrl !== "string" || !/^data:/.test(file.dataUrl)) return fail('"file" must be { url } or { name: "walk.glb", dataUrl: "data:model/gltf-binary;base64,…" }.');
        if (!/\.glb$/i.test(file.name)) return fail("Animation files are .glb (a binary glTF with animations; FBX converted to GLB).");
        d = addSceneAnimation(doc, file.name, file.dataUrl, a.name, extra as never).doc;
      } else {
        if (!lib[a.name]) return fail(`No library clip "${a.name}"; give "file" to add it.`);
        const entry = Object.fromEntries(Object.entries({ ...lib[a.name], ...extra }).filter(([, v]) => v !== undefined));
        d = { ...doc, animations: { ...lib, [a.name]: entry as never } };
      }
      return done(doc, d, { name: a.name, animation: (d.animations ?? {})[a.name] }, ["animations"]);
    }
    case "set_scene_script": {
      // P82: a Script object (three.js code in the scene's files): add one (from a template or code), change its code,
      // params or template, or turn it back into a plain shape.
      const tplIds = SCENE_SCRIPT_TEMPLATES.map((t) => t.id);
      if (a.template !== undefined && !tplIds.includes(a.template as string)) return fail(`"template" must be one of ${tplIds.join(", ")}.`);
      if (a.code !== undefined) {
        if (typeof a.code !== "string") return fail('"code" must be the script\'s JavaScript (text).');
        if (a.code.length > SCENE_SCRIPT_MAX) return fail(`"code" is longer than ${SCENE_SCRIPT_MAX / 1024} KB.`);
        const why = scriptProblems(a.code);
        if (why.length) return fail(`The code can't be used: ${why.join(" ")}`);
      }
      if (a.params !== undefined && a.params !== null) { const why = scriptParamsProblem(a.params); if (why) return fail(`"params" ${why}.`); }
      const tpl = SCENE_SCRIPT_TEMPLATES.find((t) => t.id === a.template);
      let d = doc, id: string;
      if (a.objectId === undefined || a.objectId === null) {
        if (a.remove === true) return fail("Name the Script object to turn back into a shape (\"objectId\").");
        if (!tpl && typeof a.code !== "string") return fail(`Give "template" (${tplIds.join(", ")}) or "code" to add a Script object, or "objectId" to change one.`);
        ({ doc: d, id } = addSceneScript(d, tpl ? tpl.id : { code: a.code as string, params: isObj(a.params) ? a.params as SceneScriptParams : undefined, stem: typeof a.id === "string" ? a.id : "script" }));
        if (tpl && typeof a.code === "string") d = setSceneScriptCode(d, id, a.code);
        if (tpl && a.params !== undefined) d = setSceneScriptParams(d, id, isObj(a.params) ? a.params as SceneScriptParams : {});
        if (a.id !== undefined && a.id !== id) {
          if (typeof a.id !== "string") return fail('"id" must be text.');
          const r = renameSceneObject(d, id, a.id);
          if (r.error) return fail(`"id": ${r.error}`);
          d = r.doc; id = a.id;
        }
      } else {
        const bad = needObject(doc, a.objectId); if (bad) return fail(bad);
        id = a.objectId as string;
        const cur = objectsOf(doc).find((o) => o.id === id)!;
        if (a.remove === true) {
          if (!cur.script) return fail(`"${id}" is not a Script object.`);
          d = removeSceneScript(d, id);
          const k = objectsOf(d).findIndex((o) => o.id === id);
          return done(doc, d, { objectId: id, object: objectsOf(d)[k], note: "It is a plain shape again (its unused script file went too)." }, [`objects[${k}]`]);
        }
        if (!cur.script && !tpl && typeof a.code !== "string") return fail(`"${id}" is not a Script object yet: give "template" or "code" to make it one.`);
        if (cur.model) return fail(`"${id}" is a GLB model; an object has a model or a script, not both. Add a new Script object instead (omit objectId).`);
        if (tpl || typeof a.code === "string") d = setSceneScriptCode(d, id, typeof a.code === "string" ? a.code : tpl!.code);
        if (a.params !== undefined) d = setSceneScriptParams(d, id, isObj(a.params) ? a.params as SceneScriptParams : {});
        else if (tpl) d = setSceneScriptParams(d, id, { ...tpl.params });
      }
      if (a.position !== undefined) {
        if (!isVec3(a.position)) return fail('"position" must be [x, y, z].');
        d = updateSceneObject(d, id, { position: a.position });
      }
      const k = objectsOf(d).findIndex((o) => o.id === id);
      return done(doc, d, { objectId: id, script: objectsOf(d)[k]?.script }, [`objects[${k}]`]);
    }
  }
}

/** A new scene for create_scene_clip: the given one (an object or JSON text), else an empty scene with default lights. */
export function newSceneFromInput(input: unknown, durationSec?: number): { doc: SceneDoc; warnings: string[] } | { error: string } {
  let raw: unknown = input;
  if (raw === undefined) raw = { format: SCENE_FORMAT, durationSec: durationSec ?? 5, world: { background: "#14161c", camera: { fov: 40, position: [0, 1.6, 6], lookAt: [0, 0.8, 0] } }, objects: [], events: [] };
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return { error: '"scene" is not valid JSON.' }; } }
  if (isObj(raw) && raw.format === undefined) raw = { format: SCENE_FORMAT, ...raw };
  if (isObj(raw) && raw.objects === undefined) raw = { ...raw, objects: [] };
  const issues = validateScene(raw);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) return { error: `The scene is not valid: ${errors.slice(0, 6).map(issueText).join(" ")}${errors.length > 6 ? ` (+${errors.length - 6} more)` : ""}` };
  return { doc: raw as SceneDoc, warnings: issues.filter((i) => i.level === "warning").map(issueText) };
}

/** The scene with every embedded file shortened to its size (for get_scene; files can be megabytes). */
export function sceneForAgent(doc: SceneDoc): SceneDoc {
  if (!isObj(doc.files)) return doc;
  return { ...doc, files: Object.fromEntries(Object.entries(doc.files).map(([k, v]) => [k, typeof v === "string" ? `<${v.slice(0, v.indexOf(",") + 1 || 24)}… ${v.length} chars>` : v])) };
}

/** list_scene_objects: every object with its fields and calls (argument fields with hints), the camera's calls and the events. */
export function sceneObjectsForAgent(doc: SceneDoc) {
  const calls = (obj: string) => sceneCalls(doc, obj).map((c) => ({
    call: c.call, kind: c.kind, tweens: callTweens(doc, obj, c.call), description: c.description,
    args: Object.fromEntries(sceneCallArgs(doc, obj, c.call).map((f) => [f.name, argHint(f)])),
  }));
  return {
    objects: objectsOf(doc).filter((o) => isObj(o) && typeof o.id === "string").map((o) => {
      const { functions, script, ...fields } = o;
      // P82: a Script object's code comes with it (get_scene shortens files).
      const code = script ? sceneScriptCode(doc, o.id) : undefined;
      return { ...fields, ...(script ? { script: { ...script, ...(code !== undefined ? { code } : {}) } } : {}), ...(functions ? { functions: Object.keys(functions) } : {}), calls: calls(o.id) };
    }),
    // P81b: the camera's start values and the lights (index, optional id) as drawn.
    camera: { start: (({ background: _b, ...c }) => (void _b, c))(sceneCameraBase(doc)), calls: calls(SCENE_CAMERA) },
    lights: sceneLights(doc).lights.map((l, index) => ({ index, ...l, ...(l.id && lookTargetOf(doc, l.id) ? { calls: calls(l.id) } : {}) })),
    // Scene Phase 1 (#350): world.post / fog / sky and their calls (events on "post", "fog", "sky").
    look: Object.fromEntries(SCENE_LOOK_IDS.filter((id) => isObj(doc.world) && isObj((doc.world as Record<string, unknown>)[id]) && lookTargetOf(doc, id))
      .map((id) => [id, { value: (doc.world as Record<string, unknown>)[id], calls: calls(id) }])),
    defaultLights: sceneLights(doc).defaults,
    // P82: the starting points set_scene_script takes as "template".
    scriptTemplates: SCENE_SCRIPT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description, params: t.params })),
    events: sortedEvents(doc).map(({ e, i }) => ({ index: i, ...e })),
    eases: [...SCENE_EASES],
    baseCalls: Object.keys(SCENE_BASE_FUNCTIONS),
    // Scene Phase 2 (#351): character calls (objects with "character"), the built-in clips and the library.
    characterCalls: Object.keys(SCENE_CHARACTER_CALLS),
    clips: { builtIn: BUILTIN_CLIP_NAMES, library: Object.keys(isObj(doc.animations) ? doc.animations : {}) },
    // Scene Phase 3 (#352): every camera (start pose, lens, calls) and the shots.
    cameras: sceneCameraDefs(doc).map((c) => ({ id: c.id, ...(c.name ? { name: c.name } : {}), fov: c.fov, position: c.position, lookAt: c.target, ...(c.lens ? { lens: c.lens } : {}) })),
    cameraRigCalls: Object.keys(SCENE_CAMERA_RIGS),
    shots: sceneShots(doc),
    cameraCalls: Object.keys(SCENE_CAMERA_FUNCTIONS),
  };
}

/**
 * P79: apply_scene_edits — run several edits in order on one scene, all or nothing: the first refused edit refuses the
 * batch (its index in the message) and nothing changes. The caller stores the result as ONE version in ONE undo step.
 */
export function applySceneEdits(doc: SceneDoc, edits: unknown): { ok: true; doc: SceneDoc; results: Record<string, unknown>[]; warnings: string[] } | { ok: false; error: string } {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, error: `"edits" must be a non-empty list of { tool, …that tool's arguments } (tools: ${SCENE_EDIT_TOOLS.join(", ")}).` };
  if (edits.length > MAX_SCENE_EDITS) return { ok: false, error: `At most ${MAX_SCENE_EDITS} edits per call (got ${edits.length}). Split the list.` };
  let d = doc;
  const results: Record<string, unknown>[] = [], warnings: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const tool = isObj(e) ? e.tool : undefined;
    if (typeof tool !== "string" || !isSceneEditTool(tool)) return { ok: false, error: `edits[${i}]: "tool" must be one of ${SCENE_EDIT_TOOLS.join(", ")}. Nothing changed.` };
    const r = applySceneTool(tool, d, e as Record<string, unknown>);
    if (!r.ok) return { ok: false, error: `edits[${i}] (${tool}): ${r.error} Nothing changed.` };
    d = r.doc;
    results.push({ index: i, tool, ...r.info });
    for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  return { ok: true, doc: d, results, warnings };
}
/** P79: the most edits apply_scene_edits takes in one call. */
export const MAX_SCENE_EDITS = 200;
