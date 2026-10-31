/**
 * P16: storyboard schema 3.1, the clip-centric form.
 *
 * In 3.1 the generation side of an AI shot lives only on a video asset, its clip: prompt, references (frameOf ones
 * included), genDurationSec, keyframe, camera and the clip's QA checks. A shot is a clip reference plus an in point and
 * a length, with its layers, dialogue, captions and effects: `{ "clip": "<video asset>", "inSec"?: 0, "durationSec": 3 }`.
 *
 * Internally the editor keeps the 3.0 model: a clip used by exactly one shot is that shot's own clip (its prompt and
 * references sit on the shot, its versions on the shot's backing asset), and a clip used by several shots is a video
 * slot that each of them plays from (`Shot.clipSlot` + `clipInSec`). So:
 * - `normalizeSchema` (import) folds every single-use clip asset into its shot and leaves shared clips as video assets.
 *   A 3.0 document (no `schemaVersion`) needs nothing: each shot prompt already is its own single-use clip.
 * - `toSchema31` (export) writes every own clip back out as an automatic (`"auto": true`) video asset, so the written
 *   document is always 3.1 and has no prompt on any shot.
 */
import type { StoryDoc, StoryShot } from "./storyJson";

export const SCHEMA_VERSION = "3.1";
/** Schema versions the importer reads; a document without `schemaVersion` is 3.0. */
export const SCHEMA_VERSIONS = ["3.0", "3.1"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** Fields that belong to the clip in 3.1 and are not allowed on a shot. */
export const CLIP_FIELDS = ["prompt", "references", "genDurationSec", "keyframe", "camera"] as const;

/** Every string value in `v` (deep), skipping the keys `skip` returns true for. */
function strings(v: unknown, out: string[], skip?: (k: string, owner: Obj) => boolean): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, skip));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!skip?.(k, v)) strings(x, out, skip);
  return out;
}

/** Keys whose values are ids of the owner itself or free text, never a reference to an asset. */
const TEXT_KEYS = new Set(["id", "name", "title", "description", "prompt", "notes", "note", "frameDesc", "text", "qa", "frameOf", "from", "to"]);

export interface NormalizeResult { raw: Obj; version: "3.0" | "3.1" }

/**
 * Bring a raw document into the internal (3.0-shaped) form the validator checks. Pure: `raw` is not changed.
 * Warnings: a prompt or another clip field on a 3.1 shot (moved to the clip or ignored), and an unknown version.
 */
export function normalizeSchema(raw: Obj, warn: (path: string, message: string) => void): NormalizeResult {
  const v = raw.schemaVersion;
  if (v === undefined || v === "3.0") return { raw, version: "3.0" };
  if (v !== SCHEMA_VERSION) warn("schemaVersion", `Unknown schemaVersion ${JSON.stringify(v)}; reading it as "${SCHEMA_VERSION}". Versions: ${SCHEMA_VERSIONS.join(", ")}.`);
  const out = JSON.parse(JSON.stringify(raw)) as Obj;
  const assets = Array.isArray(out.assets) ? (out.assets as unknown[]) : [];
  const shots = Array.isArray(out.shots) ? (out.shots as unknown[]) : [];
  const byId = new Map<string, Obj>();
  assets.forEach((a) => { if (isObj(a) && str(a.id)) byId.set(str(a.id)!, a); });
  const isAi = (s: Obj) => s.render === undefined || s.render === "ai";
  const clipOf = (s: unknown) => (isObj(s) && isAi(s) ? str(s.clip) : undefined);
  const drop = new Set<Obj>();
  shots.forEach((s, i) => {
    if (!isObj(s) || !isAi(s)) return;
    const path = `shots[${i}]`, id = str(s.clip);
    const a = id ? byId.get(id) : undefined;
    if (!id || !a || a.type !== "video") {
      // A 3.1 shot with its own prompt and no clip: read it as a single-use clip, with a warning.
      if (str(s.prompt) && !id) warn(`${path}.prompt`, `Schema 3.1 shots have no prompt: the prompt belongs to the shot's clip (a video asset named in "clip"). It is read as this shot's own clip.`);
      return;
    }
    for (const k of CLIP_FIELDS) {
      if (s[k] === undefined) continue;
      warn(`${path}.${k}`, k === "prompt" ? `Schema 3.1 shots have no prompt: edit the prompt of clip "${id}" instead. This one is ignored.` : `"${k}" belongs to the clip in schema 3.1; set it on clip "${id}". It is ignored here.`);
      delete s[k];
    }
    // Single use: this shot's clip and nothing else (no other shot, layer, cue or reference) names the asset.
    const uses = shots.filter((x) => clipOf(x) === id).length;
    const others = strings(assets.filter((x) => x !== a), [], (k) => TEXT_KEYS.has(k)).concat(
      strings(shots, [], (k, o) => TEXT_KEYS.has(k) || (k === "clip" && clipOf(o) === id)),
      strings(out.audio, []), strings(out.connections, []),
    ).filter((x) => x === id || x.startsWith(`${id}@`)).length;
    if (uses !== 1 || others || a.states !== undefined) {
      for (const k of ["keyframe", "camera"]) if (a[k] !== undefined) { warn(`assets[${assets.indexOf(a)}].${k}`, `"${k}" is only used on a clip that a single shot plays; clip "${id}" is shared, so it is ignored.`); delete a[k]; }
      delete a.auto;
      return;
    }
    // Fold the clip into the shot (the internal form of a single-use clip).
    s.prompt = typeof a.prompt === "string" ? a.prompt : "";
    const refs = Array.isArray(a.references) ? a.references : [];
    const list = Array.isArray(s.assets) ? [...(s.assets as unknown[])] : [];
    const objs: unknown[] = [];
    for (const r of refs) {
      if (typeof r === "string") { if (!list.includes(r)) list.push(r); } else objs.push(r);
    }
    if (list.length) s.assets = list;
    if (objs.length) s.references = objs;
    for (const k of ["genDurationSec", "keyframe", "camera"]) if (a[k] !== undefined) s[k] = a[k];
    if (Array.isArray(a.qa)) s.qa = [...a.qa, ...(Array.isArray(s.qa) ? s.qa : [])];
    if (a.needsPrompt === true) s.needsPrompt = true;
    // An automatic clip with the default id and name leaves no trace (export makes the same one again).
    const name = str(a.name) ?? id;
    const sid = str(s.id) ?? "";
    if (!(a.auto === true && id === defaultClipId(sid) && name === defaultClipName(str(s.title) ?? sid))) s.clipAsset = { id, name, ...(a.auto === true ? { auto: true } : {}) };
    delete s.clip;
    drop.add(a);
  });
  out.assets = assets.filter((a) => !drop.has(a as Obj));
  return { raw: out, version: "3.1" };
}

/** The id and name export gives a shot's automatic clip. */
export const defaultClipId = (shotId: string) => `${shotId.slice(0, 43)}-clip`;
export const defaultClipName = (shotTitle: string) => `Clip · ${shotTitle}`;

const clipIdFor = (shotId: string, used: Set<string>) => {
  const base = defaultClipId(shotId);
  let id = base, n = 2;
  while (used.has(id)) id = `${base.slice(0, 44 - String(n).length)}-${n++}`;
  return id;
};

/**
 * The 3.1 form of a validated document (export): every AI shot names a clip; own clips become automatic clip assets
 * after the declared assets. html / still shots are unchanged. Takes the authored shapes (already JSON-ready).
 */
export function toSchema31(doc: Omit<StoryDoc, "shots" | "assets"> & { assets: Obj[]; shots: Obj[] }): Obj {
  const used = new Set(doc.assets.map((a) => String(a.id)));
  doc.shots.forEach((s) => { const c = s.clipAsset as StoryShot["clipAsset"]; if (c && !used.has(c.id)) used.add(c.id); });
  const clips: Obj[] = [];
  const taken = new Set(doc.assets.map((a) => String(a.id)));
  const shots = doc.shots.map((s) => {
    const { clipAsset, inSec, ...rest } = s as Obj & { clipAsset?: StoryShot["clipAsset"]; inSec?: number };
    if (rest.render !== undefined && rest.render !== "ai") return rest;
    if (rest.clip) {
      // Shared clip: the shot only plays it.
      for (const k of [...CLIP_FIELDS, "assets"]) delete rest[k];
      if (Array.isArray(rest.qa) && !rest.qa.length) delete rest.qa;
      return { ...rest, ...(inSec ? { inSec } : {}) };
    }
    const id = clipAsset && !taken.has(clipAsset.id) ? clipAsset.id : clipIdFor(String(s.id), new Set([...taken, ...used]));
    taken.add(id);
    const objs = Array.isArray(rest.references) ? (rest.references as Obj[]) : [];
    const inObj = new Set(objs.map((r) => r.asset).filter(Boolean));
    const refs = [...objs, ...((rest.assets as string[] | undefined) ?? []).filter((a) => !inObj.has(a))];
    const clip: Obj = {
      id, name: clipAsset?.name ?? defaultClipName(String(s.title ?? s.id)), type: "video", prompt: rest.prompt ?? "", source: "generate",
      ...(refs.length ? { references: refs } : {}),
      ...(Array.isArray(rest.qa) && rest.qa.length ? { qa: rest.qa } : {}),
      ...(rest.genDurationSec !== undefined ? { genDurationSec: rest.genDurationSec } : {}),
      ...(rest.camera !== undefined ? { camera: rest.camera } : {}),
      ...(rest.keyframe !== undefined ? { keyframe: rest.keyframe } : {}),
      ...(!clipAsset || clipAsset.auto ? { auto: true } : {}),
    };
    clips.push(clip);
    for (const k of [...CLIP_FIELDS, "assets", "qa"]) delete rest[k];
    const { id: sid, title, description, durationSec, ...tail } = rest;
    return { id: sid, title, description, durationSec, clip: id, ...(inSec ? { inSec } : {}), ...tail };
  });
  const { format, ...restDoc } = doc;
  return { format, schemaVersion: SCHEMA_VERSION, ...restDoc, assets: [...doc.assets, ...clips], shots };
}
