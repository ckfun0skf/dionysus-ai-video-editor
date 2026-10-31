/**
 * P21 "Plan with AI" for Insert shot after: build a copyable prompt that asks an AI chat for the shots to insert after
 * one shot, then validate its answer ({"schema":"3.1-insert", ...}) with the storyboard validator and turn it into the
 * whole revised document, which the app merges in one undo step.
 */
import { extractJson, storyDocJson, validateStoryboard, type StoryDoc, type StoryIssue, type StoryValidateOptions } from "./storyJson";
import { RULE_LIST, ruleNumber } from "./storyPrompt";
import type { Project } from "./model";

export const INSERT_SCHEMA = "3.1-insert";
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const one = (s: string, max = 140) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The guide rules quoted in the insert prompt (by key, in rule order). */
export const INSERT_RULE_KEYS = [
  "reusable-assets", "standalone-prompts", "last-frame-continuity", "ids", "text-in-layers", "duration", "references-block",
  "audio", "self-contained-prompts", "frame-of", "clip-centric", "plan-insert-shots",
] as const;

/** Example answer, also used by the docs and tests. */
export const EXAMPLE_INSERT = {
  schema: INSERT_SCHEMA,
  insertAfter: "s2",
  shots: [
    { id: "s2b", title: "Close on the lantern", description: "Close-up: the keeper's hand turns the lantern key.", durationSec: 3, clip: "s2b-clip", inSec: 0 },
    { id: "s2c", title: "Reaction", description: "The keeper looks up at the sea.", durationSec: 2.5, clip: "s2-clip", inSec: 4 },
  ],
  newAssets: [
    { id: "s2b-clip", type: "video", name: "Lantern key close-up", aspect: "16:9", assets: ["keeper", "lantern"],
      prompt: "References: Image 1 = the keeper, Image 2 = the lantern. Close-up of an old hand turning a brass key on the lantern, warm light, slow push-in." },
  ],
} as const;

/** The base document in authored 3.1 form (assets with clips, shots naming their clip). */
export function rawDoc(doc: StoryDoc): Raw { return JSON.parse(storyDocJson(doc)) as Raw; }

const rawShots = (raw: Raw) => (Array.isArray(raw.shots) ? raw.shots.filter(isObj) : []);
const rawAssets = (raw: Raw) => (Array.isArray(raw.assets) ? raw.assets.filter(isObj) : []);
const dialogueText = (d: unknown): string => typeof d === "string" ? d
  : Array.isArray(d) ? d.map((l) => (isObj(l) ? `${str(l.speaker) || str(l.character)}: ${str(l.text)}` : str(l))).join(" / ") : "";

/** Neighbouring shots for context (up to `n` before and after the target). */
export function neighbours(raw: Raw, afterId: string, n = 2): Raw[] {
  const shots = rawShots(raw), i = shots.findIndex((s) => s.id === afterId);
  return i < 0 ? [] : shots.slice(Math.max(0, i - n), i + n + 1);
}

/**
 * The copyable prompt. `generated` = ids of assets / clips that already have a generated or uploaded version
 * (marked "generated"; the rest "not generated yet").
 */
export function buildInsertPrompt(doc: StoryDoc, afterId: string, lastDesc: string, generated: ReadonlySet<string> = new Set()): string {
  const raw = rawDoc(doc), shots = rawShots(raw);
  const idx = shots.findIndex((s) => s.id === afterId);
  if (idx < 0) throw new Error(`Unknown shot "${afterId}"`);
  const ctx = neighbours(raw, afterId).map((s) => {
    const d = dialogueText(s.dialogue);
    return `- ${s.id === afterId ? "▶ " : ""}${s.id} "${one(str(s.title), 60)}": clip ${str(s.clip) || "(none)"}, ${s.durationSec}s${d ? `, dialogue: ${one(d, 120)}` : ""}${s.id === afterId ? "  ← insert after this shot" : ""}`;
  });
  const assets = rawAssets(raw).map((a) => `- ${a.id} (${str(a.type)}${generated.has(str(a.id)) ? ", generated" : ", not generated yet"}): ${one(str(a.name) ? `${str(a.name)}. ${str(a.description) || str(a.prompt)}` : str(a.description) || str(a.prompt), 110)}`);
  const rules = INSERT_RULE_KEYS.map((k) => `${ruleNumber(k)}. ${RULE_LIST[ruleNumber(k) - 1].text}`);
  const shotIds = shots.map((s) => str(s.id)).join(", ");
  return [
    `You are planning shots for a storyboard (Dionysus storyboard schema 3.1, clip-centric).`,
    ``,
    `TASK: insert one or more shots after shot ${afterId} (shot ${idx + 1} of ${shots.length}).`,
    ``,
    `LAST SHOT (${afterId}), as the user describes it:`,
    one(lastDesc, 2000),
    ``,
    `NEIGHBOURING SHOTS (id, title, clip, duration, dialogue):`,
    ...ctx,
    ``,
    `EXISTING ASSETS AND CLIPS (id, type, generated or not, short description):`,
    ...(assets.length ? assets : ["- (none)"]),
    ``,
    `Reuse existing assets and clips whenever possible: a shot may show another part of an existing clip ("clip" + "inSec"). Only add a new clip (a "video" asset) or other asset to "newAssets" when nothing existing fits, and write a full prompt only for those new items. Never repeat or change existing assets.`,
    `Existing shot ids (do not reuse them for new shots): ${shotIds}.`,
    ``,
    `ASSET TYPES AND WHERE THEY GO:`,
    `- "video": a clip. An AI shot (the default render) plays it: "clip": "<video asset id>" (+ "inSec").`,
    `- "html": an animated graphic or title card. Either a whole shot with "render": "html" and "clip": "<html asset id>", or (usually) an html layer on an AI shot: "layers": [{"type": "html", "asset": "<id>", "startSec", "endSec", ...}].`,
    `- "image": a still. Either "render": "still" with "clip": "<image asset id>", or an image layer, or a reference of a clip.`,
    `- "character", "location", "prop", "style", "frame": references only (a clip's "assets"/"references"), never a shot's "clip".`,
    `- "audio": only in "audio" cues.`,
    `A shot without "render" is an AI shot, so its "clip" MUST be a "video" asset.`,
    ``,
    `GUIDE RULES:`,
    ...rules,
    ``,
    `OUTPUT FORMAT: answer with ONE JSON object and nothing else:`,
    `{"schema":"${INSERT_SCHEMA}","insertAfter":"${afterId}","shots":[...],"newAssets":[...]}`,
    `- "shots": the new shots in order, in the 3.1 shot form (id, title, description, durationSec, clip, inSec, layers, dialogue, ...). No "prompt" on a shot: prompts belong to the clip.`,
    `- "newAssets": only the new assets and clips, in the 3.1 asset form (id, type, name, aspect, prompt, assets/references, ...). Use [] when everything is reused.`,
    `- "audio" (optional): new audio cues for the new shots.`,
    ``,
    `Example:`,
    JSON.stringify({ ...EXAMPLE_INSERT, insertAfter: afterId }),
  ].join("\n");
}

export interface InsertPreviewShot { id: string; title: string; clip?: string; durationSec: number; layers: string[]; audio: string[]; dialogue?: string; clipNew: boolean }
export interface InsertPreviewAsset { id: string; name: string; type: string; isNew: boolean; generated: boolean; usedBy: string[] }
export interface InsertPreview { after: string; shots: InsertPreviewShot[]; assets: InsertPreviewAsset[] }
export type InsertResult =
  | { ok: true; doc: StoryDoc; preview: InsertPreview; warnings: StoryIssue[]; existing: StoryIssue[] }
  | { ok: false; errors: StoryIssue[]; warnings: StoryIssue[]; existing: StoryIssue[] };

/**
 * P22: a blank AI shot (no prompt, no shared clip) is a valid board state (added with Blank shot, synced from the
 * timeline, or waiting to be planned). Its 3.1 export has an automatic clip with an empty prompt, which the strict
 * importer rejects; mark it needsPrompt so the round trip reports it as a to-do, not an error.
 */
export function withBlankShotsFlagged(doc: StoryDoc): StoryDoc {
  let changed = false;
  const shots = doc.shots.map((s) => {
    if ((s.render ?? "ai") !== "ai" || s.prompt || s.clip || s.needsPrompt) return s;
    changed = true; return { ...s, needsPrompt: true as const };
  });
  return changed ? { ...doc, shots } : doc;
}

const key = (i: StoryIssue) => `${i.path}|${i.message}`;

/**
 * Validate an insert answer against the base document. Checks the envelope, then merges into the base (new assets
 * appended, new shots after `insertAfter`) and runs the full storyboard validator; only issues the insert brings in
 * are reported. `expectAfter` (the shot the user chose) must match `insertAfter` when given.
 */
export function applyInsertJson(base: StoryDoc, text: string, opts: StoryValidateOptions & { expectAfter?: string; generated?: ReadonlySet<string> } = {}): InsertResult {
  const errors: StoryIssue[] = [], warnings: StoryIssue[] = [];
  const existing: StoryIssue[] = [];
  const fail = (path: string, message: string) => ({ ok: false as const, errors: [...errors, { path, message }], warnings, existing });
  let v: unknown;
  try { v = JSON.parse(extractJson(text)); } catch (e) { return fail("", `Not valid JSON: ${(e as Error).message}`); }
  if (!isObj(v)) return fail("", "Expected a JSON object.");
  if (v.schema !== INSERT_SCHEMA) errors.push({ path: "schema", message: `"schema" must be "${INSERT_SCHEMA}".` });
  const after = str(v.insertAfter);
  const raw = rawDoc(withBlankShotsFlagged(base)), shots = rawShots(raw), assets = rawAssets(raw);
  const shotIds = new Set(shots.map((s) => str(s.id))), assetIds = new Set(assets.map((a) => str(a.id)));
  if (!after) errors.push({ path: "insertAfter", message: `"insertAfter" is missing.` });
  else if (!shotIds.has(after)) errors.push({ path: "insertAfter", message: `Unknown shot "${after}".` });
  else if (opts.expectAfter && after !== opts.expectAfter) errors.push({ path: "insertAfter", message: `Expected "${opts.expectAfter}" (the shot you chose), got "${after}".` });
  const newShots = Array.isArray(v.shots) ? v.shots : undefined;
  if (!newShots || !newShots.length) errors.push({ path: "shots", message: `"shots" must list at least one shot.` });
  const newAssets = v.newAssets === undefined ? [] : Array.isArray(v.newAssets) ? v.newAssets : undefined;
  if (!newAssets) errors.push({ path: "newAssets", message: `"newAssets" must be a list.` });
  const audio = v.audio === undefined ? [] : Array.isArray(v.audio) ? v.audio : undefined;
  if (!audio) errors.push({ path: "audio", message: `"audio" must be a list.` });
  (newShots ?? []).forEach((s, i) => {
    if (!isObj(s)) { errors.push({ path: `shots[${i}]`, message: "Expected an object." }); return; }
    if (shotIds.has(str(s.id))) errors.push({ path: `shots[${i}].id`, message: `Shot id "${str(s.id)}" already exists; new shots need new ids.` });
  });
  (newAssets ?? []).forEach((a, i) => {
    if (!isObj(a)) { errors.push({ path: `newAssets[${i}]`, message: "Expected an object." }); return; }
    if (assetIds.has(str(a.id))) errors.push({ path: `newAssets[${i}].id`, message: `Asset "${str(a.id)}" already exists; reuse it by id instead of listing it in newAssets.` });
  });
  if (errors.length) return { ok: false, errors, warnings, existing };

  const at = shots.findIndex((s) => s.id === after) + 1;
  const merged: Raw = {
    ...raw,
    assets: [...assets, ...(newAssets as Raw[])],
    shots: [...shots.slice(0, at), ...(newShots as Raw[]), ...shots.slice(at)],
    // The join that followed the target now follows the last inserted shot.
    connections: (Array.isArray(raw.connections) ? raw.connections : []).map((c) => isObj(c) && c.from === after && at < shots.length && c.to === shots[at].id && newShots!.length && isObj(newShots![newShots!.length - 1]) ? { ...c, from: (newShots![newShots!.length - 1] as Raw).id } : c),
    ...(audio!.length || raw.audio ? { audio: [...(Array.isArray(raw.audio) ? raw.audio : []), ...audio!] } : {}),
  };
  // Paths in the merged document point into the full lists; name them by id so the user can find them.
  const named = (doc: Raw) => (i: StoryIssue): StoryIssue => {
    const m = /^(shots|assets|audio)\[(\d+)\](.*)$/.exec(i.path);
    if (!m) return i;
    const item = (doc[m[1]] as Raw[] | undefined)?.[Number(m[2])];
    return item && isObj(item) && item.id ? { ...i, path: `${m[1]} "${str(item.id)}"${m[3]}` } : i;
  };
  const before = validateStoryboard(raw, opts);
  const nb = named(raw);
  const known = new Set([...before.warnings, ...(before.ok ? [] : before.errors)].map((i) => key(nb(i))));
  const res = validateStoryboard(merged, opts);
  const name = named(merged);
  const added = new Set((newAssets as Raw[]).map((a) => str(a.id)));
  const newIds = (newShots as Raw[]).map((s) => str(s.id));
  const newShotSet = new Set(newIds);
  // Ids the insert refers to (its shots' clips, layers, references; its new assets' references).
  const mentioned = new Set<string>();
  const walk = (v: unknown): void => { if (typeof v === "string") mentioned.add(v.split("@")[0]); else if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) Object.entries(v).forEach(([k, x]) => { if (k !== "prompt" && k !== "description" && k !== "title") walk(x); }); };
  walk(newShots); walk(newAssets); walk(audio);
  const baseAudio = Array.isArray(raw.audio) ? raw.audio.length : 0;
  const mConn = Array.isArray(merged.connections) ? (merged.connections as unknown[]) : [];
  // Blocking = about the insert; existing = a pre-existing board issue (shown, not blocking).
  const scope = (i: StoryIssue): "insert" | "existing" | "warn" => {
    const m = /^(shots|assets) "([^"]+)"/.exec(i.path);
    if (m) {
      if (m[1] === "shots") return newShotSet.has(m[2]) ? "insert" : "existing";
      if (added.has(m[2])) return "insert";
      return mentioned.has(m[2]) ? "warn" : "existing";
    }
    const a = /^audio\[(\d+)\]/.exec(i.path);
    if (a) return Number(a[1]) >= baseAudio ? "insert" : "existing";
    const c = /^connections\[(\d+)\]/.exec(i.path);
    if (c) { const x = mConn[Number(c[1])]; return isObj(x) && (newShotSet.has(str(x.from)) || newShotSet.has(str(x.to))) ? "insert" : "existing"; }
    return known.has(key(i)) ? "existing" : "insert";
  };
  const fresh = res.warnings.map(name).filter((w) => !known.has(key(w)) && scope(w) !== "existing");
  const blocking: StoryIssue[] = [];
  if (!res.ok) for (const e of res.errors.map(name)) {
    const k = scope(e);
    if (k === "insert") {
      const t = /must be a video asset, but "[^"]+" is type (html|image)/.exec(e.message);
      blocking.push(t ? { ...e, message: `${e.message} To show it as the whole shot set "render": "${t[1] === "html" ? "html" : "still"}"; otherwise keep a video clip and add it as ${t[1] === "html" ? "an html" : "an image"} layer.` } : e);
    }
    else if (k === "warn") fresh.push({ ...e, message: `${e.message} (an existing asset this insert uses; fix it on the board)` });
    else existing.push(e);
  }
  if (blocking.length) return { ok: false, errors: blocking, warnings: fresh, existing };
  // With only pre-existing errors left, keep the board's own shots and assets as they are and add the new ones.
  const p = res.ok ? res.doc : res.partial!;
  let doc: StoryDoc;
  {
    const bs = new Map(base.shots.map((x) => [x.id, x])), ba = new Map(base.assets.map((x) => [x.id, x]));
    doc = { ...p, shots: p.shots.map((x) => (newShotSet.has(x.id) ? x : bs.get(x.id) ?? x)), assets: p.assets.map((x) => (added.has(x.id) ? x : ba.get(x.id) ?? x)) };
  }
  const gen = opts.generated ?? new Set<string>();
  const out = rawDoc(doc), outShots = rawShots(out);
  const pShots: InsertPreviewShot[] = newIds.map((id) => {
    const s = outShots.find((x) => x.id === id) ?? {};
    const sd = doc.shots.find((x) => x.id === id)!;
    const clip = str(s.clip) || undefined;
    return {
      id, title: sd.title, clip, durationSec: sd.durationSec,
      layers: (sd.layers ?? []).map((l) => `${l.type}${"text" in l && typeof (l as { text?: unknown }).text === "string" ? ` “${one((l as { text: string }).text, 30)}”` : ""}`),
      audio: (doc.audio ?? []).filter((c) => c.from === id || (c as { shot?: string }).shot === id).map((c) => `${c.id}${c.asset ? ` (${c.asset})` : ""}`),
      ...(sd.dialogue ? { dialogue: one(dialogueText(sd.dialogue), 120) } : {}),
      clipNew: !!clip && (added.has(clip) || !assetIds.has(clip)),
    };
  });
  // Every asset / clip the new shots use (their clip, the clip's references and the shot's own assets), plus all new ones.
  const outAssets = new Map(rawAssets(out).map((a) => [str(a.id), a]));
  const used = new Map<string, Set<string>>();
  const use = (id: string, by: string) => { if (outAssets.has(id)) (used.get(id) ?? used.set(id, new Set()).get(id)!).add(by); };
  for (const id of newIds) {
    const s = outShots.find((x) => x.id === id) ?? {};
    const clip = str(s.clip);
    if (clip) { use(clip, id); const c = outAssets.get(clip)!; for (const r of [...(Array.isArray(c?.assets) ? c.assets : []), ...(Array.isArray(c?.references) ? c.references : [])]) use(isObj(r) ? str(r.asset) || str(r.id) : str(r), id); }
    for (const r of Array.isArray(s.assets) ? s.assets : []) use(str(r), id);
  }
  for (const id of added) if (!used.has(id)) used.set(id, new Set());
  const pAssets: InsertPreviewAsset[] = [...used].map(([id, by]) => {
    const a = outAssets.get(id) ?? {};
    const isNew = added.has(id) || !assetIds.has(id);
    return { id, name: str(a.name) || id, type: str(a.type), isNew, generated: !isNew && gen.has(id), usedBy: [...by] };
  }).sort((a, b) => Number(b.isNew) - Number(a.isNew));
  return { ok: true, doc, preview: { after, shots: pShots, assets: pAssets }, warnings: fresh, existing };
}

/** Short text form of an insert result (WebMCP and logs). */
export function insertResultText(r: InsertResult): string {
  const iss = (l: StoryIssue[]) => l.map((i) => `- ${i.path ? `${i.path}: ` : ""}${i.message}`).join("\n");
  const ex = r.existing.length ? `\nExisting storyboard issues (not blocking):\n${iss(r.existing)}` : "";
  if (!r.ok) return `Insert JSON has ${r.errors.length} error(s):\n${iss(r.errors)}${r.warnings.length ? `\nWarnings:\n${iss(r.warnings)}` : ""}${ex}`;
  const p = r.preview;
  return [
    `Inserted ${p.shots.length} shot(s) after ${p.after}:`,
    ...p.shots.map((s) => `- ${s.id} "${s.title}": clip ${s.clip ?? "(none)"}${s.clipNew ? " (new, needs generation)" : " (reused)"}, ${s.durationSec}s${s.layers.length ? `, layers: ${s.layers.join(", ")}` : ""}${s.audio.length ? `, audio: ${s.audio.join(", ")}` : ""}`),
    `Assets: ${p.assets.map((a) => `${a.id} ${a.isNew ? "(new, needs generation)" : "(reused)"}`).join(", ") || "none"}.`,
    ...(r.warnings.length ? [`Warnings:\n${iss(r.warnings)}`] : []),
  ].join("\n") + ex;
}

/** Ids (as in the 3.1 document) of the assets and clips that already have a generated or uploaded version. */
export function generatedIds(p: Project): Set<string> {
  const sb = p.storyboard, out = new Set<string>();
  if (!sb) return out;
  const has = (id?: string) => !!id && (p.assets[id]?.versions.length ?? 0) > 0;
  for (const s of Object.values(sb.slots)) if (has(s.assetId)) out.add(s.id);
  for (const sh of Object.values(sb.shots)) if (!sh.clipSlot && has(sh.assetId)) out.add(sh.clipAsset?.id ?? `${sh.id}-clip`);
  return out;
}
