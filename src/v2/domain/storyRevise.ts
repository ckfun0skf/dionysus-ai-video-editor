/**
 * P36 "Revise with AI" (whole storyboard) and "Edit with AI" (one shot), modelled on P21 Plan with AI insert: build a
 * copyable prompt from the user's short brief, then validate the AI's JSON answer and merge it into the board in one
 * undo step. Answers:
 *   {"schema":"3.1-revise","shots":[...changed shots...],"add":[{"after","shots"}],"remove":[ids],"assets":[...],"newAssets":[...],"audio"?}
 *   {"schema":"3.1-shot-revise","shotId","shot":{...},"assets"?:[...],"newAssets"?:[...]}
 * Only what the answer changes or adds can block; problems already on the board are listed, never blocking. Existing
 * ids keep their generated assets and versions (the merge is by id); removed shots leave the timeline untouched.
 */
import { extractJson, validateStoryboard, type StoryDoc, type StoryIssue, type StoryValidateOptions } from "./storyJson";
import { RULE_LIST, ruleNumber } from "./storyPrompt";
import { insertSchema, rawDoc, withBlankShotsFlagged } from "./storyInsert";

export const REVISE_SCHEMA = "3.1-revise";
export const SHOT_REVISE_SCHEMA = "3.1-shot-revise";
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const one = (s: string, max = 140) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const list = (raw: Raw, k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter(isObj) : []);

/** The guide rules quoted in revise prompts (by key, in rule order). */
export const REVISE_RULE_KEYS = [
  "reusable-assets", "standalone-prompts", "last-frame-continuity", "ids", "text-in-layers", "duration", "references-block",
  "audio", "self-contained-prompts", "frame-of", "clip-centric", "screen-insert", "revise-storyboard", "revise-shot",
] as const;

export const EXAMPLE_REVISE = {
  schema: REVISE_SCHEMA,
  shots: [{ id: "s3", title: "Storm arrives", description: "Waves hit the rocks below the lighthouse; the beam sweeps through rain.", durationSec: 4, clip: "s3-clip" }],
  add: [{ after: "s3", shots: [{ id: "s3b", title: "Keeper watches", description: "The keeper watches the storm.", durationSec: 3, clip: "s2-clip", inSec: 6 }] }],
  remove: ["s5"],
  assets: [{ id: "s3-clip", type: "video", name: "Storm on the rocks", aspect: "16:9", prompt: "Night storm, huge waves crash on black rocks under a lighthouse, beam sweeping through heavy rain, handheld." }],
  newAssets: [],
} as const;
export const EXAMPLE_SHOT_REVISE = {
  schema: SHOT_REVISE_SCHEMA,
  shotId: "s3",
  shot: { id: "s3", title: "Storm arrives", description: "Waves hit the rocks; the beam sweeps through rain.", durationSec: 4, clip: "s3-clip",
    layers: [{ id: "s3-time", type: "text", text: "23:10", startSec: 0, endSec: 2, position: { x: 0.85, y: 0.1 } }] },
  assets: [{ id: "s3-clip", type: "video", name: "Storm on the rocks", aspect: "16:9", prompt: "Night storm, huge waves crash on black rocks under a lighthouse, beam sweeping through heavy rain." }],
  newAssets: [],
} as const;

const rulesText = () => REVISE_RULE_KEYS.map((k) => `${ruleNumber(k)}. ${RULE_LIST[ruleNumber(k) - 1].text}`);
const assetLines = (raw: Raw, generated: ReadonlySet<string>) => list(raw, "assets").map((a) => `- ${a.id} (${str(a.type)}${generated.has(str(a.id)) ? ", generated" : ", not generated yet"}): ${one(str(a.name) || str(a.description) || str(a.prompt), 90)}`);

/** Copyable prompt. `shotId` set = Edit with AI on that shot; otherwise the whole storyboard. */
export function buildRevisePrompt(doc: StoryDoc, brief: string, generated: ReadonlySet<string> = new Set(), shotId?: string): string {
  const raw = rawDoc(withBlankShotsFlagged(doc)), shots = list(raw, "shots");
  const common = [
    ``,
    `KEEP WHAT WORKS: change only what the problem needs. Keep every id. An asset or clip that already has a generated version keeps it unless you change its "prompt"; only change a prompt when the picture itself must change. Reuse existing assets and clips by id; put only genuinely new ones in "newAssets" (with full prompts).`,
    ``,
    `GUIDE RULES:`,
    ...rulesText(),
    ``,
    `SCHEMA (exact field names; never invent or rename one: a dialogue line is {"speaker", "text", "offscreen"}; a layer always has "id" and "type"; times are "startSec"/"endSec" in seconds from the shot start):`,
    insertSchema(),
  ];
  if (shotId) {
    const i = shots.findIndex((s) => s.id === shotId);
    if (i < 0) throw new Error(`Unknown shot "${shotId}"`);
    const s = shots[i], clip = str(s.clip), clipAsset = list(raw, "assets").find((a) => a.id === clip);
    const near = shots.slice(Math.max(0, i - 1), i + 2).filter((x) => x !== s).map((x) => `- ${x.id} "${one(str(x.title), 60)}": ${one(str(x.description), 120)}`);
    return [
      `You are revising ONE shot of a storyboard (Dionysus storyboard schema 3.1, clip-centric).`,
      ``,
      `THE PROBLEM, as the user describes it:`,
      one(brief, 2000),
      ``,
      `THE SHOT (${shotId}, shot ${i + 1} of ${shots.length}):`,
      JSON.stringify(s, null, 1),
      ...(clipAsset ? [``, `ITS CLIP (${clip}):`, JSON.stringify(clipAsset, null, 1)] : []),
      ``,
      `NEIGHBOURING SHOTS (for continuity, do not change them):`,
      ...(near.length ? near : ["- (none)"]),
      ``,
      `EXISTING ASSETS AND CLIPS (id, type, generated or not):`,
      ...assetLines(raw, generated),
      ...common,
      ``,
      `OUTPUT FORMAT: answer with ONE JSON object and nothing else:`,
      `{"schema":"${SHOT_REVISE_SCHEMA}","shotId":"${shotId}","shot":{...},"assets":[...],"newAssets":[...]}`,
      `- "shot": the whole revised shot in the 3.1 shot form, same "id" ("${shotId}"). No "prompt" on a shot: prompts belong to the clip.`,
      `- "assets" (optional): existing assets or clips you changed (full 3.1 asset form, same id), e.g. a clip whose prompt must change.`,
      `- "newAssets" (optional): new assets and clips only. Use [] when nothing is new.`,
      ``,
      `Example:`,
      JSON.stringify({ ...EXAMPLE_SHOT_REVISE, shotId, shot: { ...EXAMPLE_SHOT_REVISE.shot, id: shotId } }),
    ].join("\n");
  }
  return [
    `You are revising a storyboard (Dionysus storyboard schema 3.1, clip-centric).`,
    ``,
    `THE PROBLEM, as the user describes it:`,
    one(brief, 3000),
    ``,
    `THE CURRENT STORYBOARD (3.1 JSON):`,
    JSON.stringify(raw),
    ``,
    `GENERATED ALREADY: ${[...generated].join(", ") || "(nothing yet)"}.`,
    ...common,
    ``,
    `OUTPUT FORMAT: answer with ONE JSON object and nothing else, listing ONLY what changes:`,
    `{"schema":"${REVISE_SCHEMA}","shots":[...],"add":[{"after":"<shot id>","shots":[...]}],"remove":["<shot id>"],"assets":[...],"newAssets":[...]}`,
    `- "shots": changed existing shots, each the whole shot in 3.1 form with its existing "id". Shots you do not list stay as they are.`,
    `- "add" (optional): new shots (new ids) to insert after an existing shot, in order.`,
    `- "remove" (optional): ids of shots to drop from the storyboard. Their clips stay on the timeline until the user deletes them.`,
    `- "assets" (optional): existing assets or clips you changed (whole 3.1 asset form, same id).`,
    `- "newAssets" (optional): new assets and clips only.`,
    `- "audio" (optional): the whole revised list of audio cues, when cues change.`,
    `Every field except "schema" is optional, but the answer must change something.`,
    ``,
    `Example:`,
    JSON.stringify(EXAMPLE_REVISE),
  ].join("\n");
}

export interface RevisePreview { changed: string[]; added: string[]; removed: string[]; assetsChanged: string[]; assetsNew: string[]; regenerate: string[] }
export type ReviseResult =
  | { ok: true; doc: StoryDoc; preview: RevisePreview; warnings: StoryIssue[]; existing: StoryIssue[] }
  | { ok: false; errors: StoryIssue[]; warnings: StoryIssue[]; existing: StoryIssue[] };

const key = (i: StoryIssue) => `${i.path}|${i.message}`;
const named = (doc: Raw) => (i: StoryIssue): StoryIssue => {
  const m = /^(shots|assets|audio)\[(\d+)\](.*)$/.exec(i.path);
  if (!m) return i;
  const item = (doc[m[1]] as Raw[] | undefined)?.[Number(m[2])];
  return item && isObj(item) && item.id ? { ...i, path: `${m[1]} "${str(item.id)}"${m[3]}` } : i;
};

/** Validate a revise answer (either schema) and merge it into `base`. `shotId` = Edit with AI on that shot. */
export function applyReviseJson(base: StoryDoc, text: string, opts: StoryValidateOptions & { shotId?: string; generated?: ReadonlySet<string> } = {}): ReviseResult {
  const errors: StoryIssue[] = [], warnings: StoryIssue[] = [], existing: StoryIssue[] = [];
  const fail = (path: string, message: string): ReviseResult => ({ ok: false, errors: [...errors, { path, message }], warnings, existing });
  let v: unknown;
  try { v = JSON.parse(extractJson(text)); } catch (e) { return fail("", `Not valid JSON: ${(e as Error).message}`); }
  if (!isObj(v)) return fail("", "Expected a JSON object.");
  const raw = rawDoc(withBlankShotsFlagged(base)), shots = list(raw, "shots"), assets = list(raw, "assets");
  const shotIds = new Set(shots.map((s) => str(s.id))), assetIds = new Set(assets.map((a) => str(a.id)));
  const want = opts.shotId ? SHOT_REVISE_SCHEMA : REVISE_SCHEMA;
  if (v.schema !== want) errors.push({ path: "schema", message: `"schema" must be "${want}".` });
  const arr = (k: string): Raw[] | undefined => { if (v === undefined || !isObj(v) || v[k] === undefined) return []; if (!Array.isArray(v[k])) { errors.push({ path: k, message: `"${k}" must be a list.` }); return undefined; } return (v[k] as unknown[]).filter((x, i) => isObj(x) || (errors.push({ path: `${k}[${i}]`, message: "Expected an object." }), false)) as Raw[]; };
  let changed: Raw[] = [], adds: { after: string; shots: Raw[] }[] = [], remove: string[] = [];
  if (opts.shotId) {
    if (str(v.shotId) !== opts.shotId) errors.push({ path: "shotId", message: `Expected "${opts.shotId}" (the shot you chose), got "${str(v.shotId)}".` });
    if (!isObj(v.shot)) errors.push({ path: "shot", message: `"shot" must be the whole revised shot.` });
    else if (str(v.shot.id) !== opts.shotId) errors.push({ path: "shot.id", message: `The shot keeps its id "${opts.shotId}".` });
    else changed = [v.shot];
  } else {
    changed = arr("shots") ?? [];
    for (const [i, a] of (arr("add") ?? []).entries()) {
      if (!shotIds.has(str(a.after))) errors.push({ path: `add[${i}].after`, message: `Unknown shot "${str(a.after)}".` });
      if (!Array.isArray(a.shots) || !a.shots.length || !a.shots.every(isObj)) errors.push({ path: `add[${i}].shots`, message: `"shots" must list the new shots.` });
      else adds.push({ after: str(a.after), shots: a.shots as Raw[] });
    }
    if (v.remove !== undefined && (!Array.isArray(v.remove) || !v.remove.every((x) => typeof x === "string"))) errors.push({ path: "remove", message: `"remove" must be a list of shot ids.` });
    else remove = (v.remove as string[] | undefined) ?? [];
    remove.forEach((id, i) => { if (!shotIds.has(id)) errors.push({ path: `remove[${i}]`, message: `Unknown shot "${id}".` }); });
    changed.forEach((s, i) => { if (!shotIds.has(str(s.id))) errors.push({ path: `shots[${i}].id`, message: `Unknown shot "${str(s.id)}": new shots go in "add".` }); else if (remove.includes(str(s.id))) errors.push({ path: `shots[${i}].id`, message: `Shot "${str(s.id)}" is both changed and removed.` }); });
  }
  const addedShots = adds.flatMap((a) => a.shots);
  addedShots.forEach((s, i) => { if (shotIds.has(str(s.id))) errors.push({ path: `add shots[${i}].id`, message: `Shot id "${str(s.id)}" already exists; new shots need new ids.` }); });
  const assetsChanged = arr("assets") ?? [], assetsNew = arr("newAssets") ?? [];
  assetsChanged.forEach((a, i) => { if (!assetIds.has(str(a.id))) errors.push({ path: `assets[${i}].id`, message: `Unknown asset "${str(a.id)}": new ones go in "newAssets".` }); });
  assetsNew.forEach((a, i) => { if (assetIds.has(str(a.id))) errors.push({ path: `newAssets[${i}].id`, message: `Asset "${str(a.id)}" already exists; list a change in "assets".` }); });
  const audio = !opts.shotId && v.audio !== undefined ? arr("audio") : undefined;
  if (!errors.length && !changed.length && !addedShots.length && !remove.length && !assetsChanged.length && !assetsNew.length && !audio) errors.push({ path: "", message: "The answer changes nothing." });
  if (errors.length) return { ok: false, errors, warnings, existing };

  // Merge by id: changed shots replace theirs, added shots go after their anchor, removed ones drop out.
  const byId = new Map(changed.map((s) => [str(s.id), s]));
  const outShots: Raw[] = [];
  for (const s of shots) {
    if (!remove.includes(str(s.id))) outShots.push(byId.get(str(s.id)) ?? s);
    for (const a of adds) if (a.after === str(s.id)) outShots.push(...a.shots);
  }
  const aById = new Map(assetsChanged.map((a) => [str(a.id), a]));
  const merged: Raw = {
    ...raw,
    shots: outShots,
    assets: [...assets.map((a) => aById.get(str(a.id)) ?? a), ...assetsNew],
    connections: (Array.isArray(raw.connections) ? raw.connections : []).filter((c) => !isObj(c) || (!remove.includes(str(c.from)) && !remove.includes(str(c.to)))),
    ...(audio ? { audio } : {}),
  };
  const touchedShots = new Set([...changed, ...addedShots].map((s) => str(s.id)));
  const touchedAssets = new Set([...assetsChanged, ...assetsNew].map((a) => str(a.id)));
  const before = validateStoryboard(raw, opts), nb = named(raw);
  const known = new Set([...before.warnings, ...(before.ok ? [] : before.errors)].map((i) => key(nb(i))));
  const res = validateStoryboard(merged, opts), name = named(merged);
  const scope = (i: StoryIssue): "mine" | "existing" => {
    const m = /^(shots|assets) "([^"]+)"/.exec(i.path);
    if (m) return (m[1] === "shots" ? touchedShots : touchedAssets).has(m[2]) ? "mine" : "existing";
    if (/^audio/.test(i.path)) return audio ? (known.has(key(i)) ? "existing" : "mine") : "existing";
    return known.has(key(i)) ? "existing" : "mine";
  };
  const fresh = res.warnings.map(name).filter((w) => !known.has(key(w)) && scope(w) === "mine");
  const blocking: StoryIssue[] = [];
  if (!res.ok) for (const e of res.errors.map(name)) (scope(e) === "mine" ? blocking : existing).push(e);
  if (blocking.length) return { ok: false, errors: blocking, warnings: fresh, existing };
  const p = res.ok ? res.doc : res.partial!;
  // Untouched shots and assets stay exactly as they were on the board.
  const bs = new Map(base.shots.map((x) => [x.id, x])), ba = new Map(base.assets.map((x) => [x.id, x]));
  const doc: StoryDoc = { ...p, shots: p.shots.map((x) => (touchedShots.has(x.id) ? x : bs.get(x.id) ?? x)), assets: p.assets.map((x) => (touchedAssets.has(x.id) ? x : ba.get(x.id) ?? x)) };
  const gen = opts.generated ?? new Set<string>();
  const oldAsset = new Map(assets.map((a) => [str(a.id), a]));
  const regenerate = assetsChanged.filter((a) => gen.has(str(a.id)) && str(a.prompt) !== str(oldAsset.get(str(a.id))?.prompt)).map((a) => str(a.id));
  return { ok: true, doc, warnings: fresh, existing, preview: { changed: changed.map((s) => str(s.id)), added: addedShots.map((s) => str(s.id)), removed: remove, assetsChanged: assetsChanged.map((a) => str(a.id)), assetsNew: assetsNew.map((a) => str(a.id)), regenerate } };
}

/** Short text form (WebMCP and logs). */
export function reviseResultText(r: ReviseResult): string {
  const iss = (l: StoryIssue[]) => l.map((i) => `- ${i.path ? `${i.path}: ` : ""}${i.message}`).join("\n");
  const ex = r.existing.length ? `\nExisting storyboard issues (not blocking):\n${iss(r.existing)}` : "";
  if (!r.ok) return `Revise JSON has ${r.errors.length} error(s):\n${iss(r.errors)}${r.warnings.length ? `\nWarnings:\n${iss(r.warnings)}` : ""}${ex}`;
  const p = r.preview, l = (t: string, xs: string[]) => (xs.length ? [`${t}: ${xs.join(", ")}`] : []);
  return [
    "Revised the storyboard.",
    ...l("Changed shots", p.changed), ...l("Added shots", p.added), ...l("Removed shots (their timeline clips stay)", p.removed),
    ...l("Changed assets", p.assetsChanged), ...l("New assets (need generation)", p.assetsNew), ...l("Prompt changed on generated assets (regenerate when ready; old versions kept)", p.regenerate),
    ...(r.warnings.length ? [`Warnings:\n${iss(r.warnings)}`] : []),
  ].join("\n") + ex;
}
