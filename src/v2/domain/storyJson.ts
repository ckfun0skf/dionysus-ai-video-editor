/**
 * Storyboard interchange format (V2-CUT-06): the JSON an external AI writes from the agreed story.
 * Pure parse + validate with path-addressed errors; see docs/v2/VISION.md "One-stop flow".
 */
export const STORYBOARD_FORMAT = "dionysus.storyboard/1" as const;

export const STORY_ASSET_TYPES = ["character", "location", "prop", "style", "image", "frame", "video", "audio"] as const;
export type StoryAssetType = (typeof STORY_ASSET_TYPES)[number];
export const CONNECTION_KINDS = ["cut", "continuity", "match"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

/** Where an asset comes from: generated from its prompt, uploaded by the user, or the LAST FRAME of another shot's clip. */
export type StoryAssetSource = { type: "generate" } | { type: "upload" } | { type: "lastFrame"; shot: string };

export interface StoryAsset {
  id: string; name: string; type: StoryAssetType; aspect: string;
  prompt: string; references: string[]; source: StoryAssetSource; qa: string[]; notes?: string;
}
export interface StoryShot {
  id: string; title: string; description: string; durationSec: number;
  prompt: string; assets: string[]; qa: string[]; camera?: string; dialogue?: string;
}
export interface StoryConnection { from: string; to: string; kind: ConnectionKind; note?: string }
export interface StoryMeta { title: string; logline?: string; synopsis?: string; aspect: string; style?: string; language?: string }
export interface StoryDoc { format: typeof STORYBOARD_FORMAT; meta: StoryMeta; assets: StoryAsset[]; shots: StoryShot[]; connections: StoryConnection[] }

/** `at`: character offset in the extracted JSON, for syntax errors that have no path. */
export interface StoryIssue { path: string; message: string; at?: number }
export type StoryParseResult =
  | { ok: true; doc: StoryDoc; warnings: StoryIssue[] }
  | { ok: false; errors: StoryIssue[]; warnings: StoryIssue[] };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;
const ASPECT_RE = /^\d+(\.\d+)?:\d+(\.\d+)?$/;
const MAX_ERRORS = 40;

/** Pull the JSON object out of what people paste: raw JSON, a ```json fence, or chat text around it. */
export function extractJson(text: string): string {
  const t = text.replace(/^\uFEFF/, "").trim();
  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)```/.exec(t);
  if (fence) return fence[1].trim();
  if (t.startsWith("{")) return t;
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

/** "line 3, column 7" for a character offset. */
export function lineCol(text: string, pos: number): string {
  const before = text.slice(0, Math.max(0, pos));
  const line = before.split("\n").length;
  return `line ${line}, column ${pos - before.lastIndexOf("\n")}`;
}

/**
 * Locate the first JSON syntax error with a friendly hint. Browsers word (and position) JSON.parse
 * errors differently — Safari gives no offset at all — so we scan ourselves for consistent messages.
 */
export function jsonSyntaxError(text: string): { pos: number; message: string } | undefined {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const shown = () => (i >= text.length ? "the end of the text" : `"${text[i]}"`);
  class Fail { constructor(public pos: number, public message: string) {} }
  const fail = (message: string): never => { throw new Fail(i, message); };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++; ws();
      if (text[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (text[i] === "}") fail("remove the comma before }");
        if (text[i] === "'") fail("use double quotes \" for names, not '");
        if (text[i] !== '"') fail(`expected a "name" in quotes, found ${shown()}`);
        string(); ws();
        if (text[i] !== ":") fail(`expected : after the name, found ${shown()}`);
        i++; value(); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return; }
        fail(`expected , or } — found ${shown()} (a missing comma?)`);
      }
    }
    if (c === "[") {
      i++; ws();
      if (text[i] === "]") { i++; return; }
      for (;;) {
        ws();
        if (text[i] === "]") fail("remove the comma before ]");
        value(); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return; }
        fail(`expected , or ] — found ${shown()} (a missing comma?)`);
      }
    }
    if (c === '"') return string();
    if (c === "'") fail("use double quotes \" for text, not '");
    if (c === "/") fail("comments are not allowed in JSON");
    const lit = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (lit) { i += lit[0].length; return; }
    fail(`expected a value, found ${shown()}`);
  };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\n") fail("line break inside text — use \\n");
      i += text[i] === "\\" ? 2 : 1;
    }
    if (i >= text.length) fail("text is missing its closing \"");
    i++;
  };
  try {
    value(); ws();
    if (i < text.length) fail(`unexpected ${shown()} after the end of the JSON`);
  } catch (e) {
    if (e instanceof Fail) return { pos: e.pos, message: e.message };
    throw e;
  }
  return undefined;
}

export function parseStoryboard(text: string): StoryParseResult {
  const json = extractJson(text);
  if (!json) return { ok: false, errors: [{ path: "", message: "Nothing to import — paste the storyboard JSON or choose a .json file." }], warnings: [] };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch {
    const at = jsonSyntaxError(json);
    const where = at ? ` at ${lineCol(json, at.pos)}: ${at.message}` : "";
    return { ok: false, errors: [{ path: "", message: `Not valid JSON${where}. Tip: ask the AI to reply with only the JSON in one code block.`, ...(at ? { at: at.pos } : {}) }], warnings: [] };
  }
  return validateStoryboard(raw);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

export function validateStoryboard(raw: unknown): StoryParseResult {
  const errors: StoryIssue[] = [], warnings: StoryIssue[] = [];
  const err = (path: string, message: string) => { if (errors.length < MAX_ERRORS) errors.push({ path, message }); };
  const warn = (path: string, message: string) => warnings.push({ path, message });
  if (!isObj(raw)) return { ok: false, errors: [{ path: "", message: "The storyboard must be a JSON object { … }." }], warnings };

  if (raw.format === undefined) warn("format", `Missing "format"; assuming "${STORYBOARD_FORMAT}".`);
  else if (raw.format !== STORYBOARD_FORMAT) err("format", `Unsupported format "${String(raw.format)}" — expected "${STORYBOARD_FORMAT}".`);

  const m = isObj(raw.meta) ? raw.meta : (err("meta", 'Missing "meta" object with at least "title".'), {} as Obj);
  const title = str(m.title);
  if (isObj(raw.meta) && !title) err("meta.title", "Story title is required.");
  let aspect = str(m.aspect) ?? "";
  if (!aspect) { aspect = "16:9"; if (isObj(raw.meta)) warn("meta.aspect", 'No aspect given; using "16:9".'); }
  else if (!ASPECT_RE.test(aspect)) { err("meta.aspect", `Aspect "${aspect}" should look like "16:9" or "9:16".`); }
  const meta: StoryMeta = { title: title ?? "", aspect };
  for (const k of ["logline", "synopsis", "style", "language"] as const) { const v = str(m[k]); if (v) meta[k] = v; }

  const strList = (v: unknown, path: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { err(path, "Should be a list of strings."); return []; }
    return v.flatMap((x, i) => { const s = str(x); if (!s) { err(`${path}[${i}]`, "Should be a non-empty string."); return []; } return [s]; });
  };
  const checkId = (v: unknown, path: string, seen: Set<string>, what: string): string => {
    const id = str(v) ?? "";
    if (!id) err(`${path}.id`, `Each ${what} needs an "id".`);
    else if (!ID_RE.test(id)) err(`${path}.id`, `Id "${id}" may only use letters, digits, "_", "-", "." (max 48).`);
    else if (seen.has(id)) err(`${path}.id`, `Duplicate ${what} id "${id}".`);
    seen.add(id);
    return id;
  };

  // Shots first so asset sources can be checked against them.
  const rawShots = Array.isArray(raw.shots) ? raw.shots : (err("shots", 'Missing "shots" list.'), []);
  if (Array.isArray(raw.shots) && rawShots.length === 0) err("shots", "Add at least one shot.");
  const shotIds = new Set<string>();
  const shotPre = rawShots.map((s, i) => { const path = `shots[${i}]`; if (!isObj(s)) { err(path, "Each shot must be an object."); return undefined; } return { s, path, id: checkId(s.id, path, shotIds, "shot") }; });

  const rawAssets = raw.assets === undefined ? [] : Array.isArray(raw.assets) ? raw.assets : (err("assets", '"assets" must be a list.'), []);
  const assetIds = new Set<string>();
  const assets: StoryAsset[] = [];
  rawAssets.forEach((a, i) => {
    const path = `assets[${i}]`;
    if (!isObj(a)) return err(path, "Each asset must be an object.");
    const id = checkId(a.id, path, assetIds, "asset");
    const type = str(a.type) as StoryAssetType;
    if (!STORY_ASSET_TYPES.includes(type)) err(`${path}.type`, `Type "${String(a.type ?? "")}" must be one of: ${STORY_ASSET_TYPES.join(", ")}.`);
    let source: StoryAssetSource = { type: "generate" };
    const src = a.source;
    if (src === undefined || src === "generate" || (isObj(src) && src.type === "generate")) source = { type: "generate" };
    else if (src === "upload" || (isObj(src) && src.type === "upload")) source = { type: "upload" };
    else if (isObj(src) && src.type === "lastFrame") {
      const shot = str(src.shot) ?? "";
      if (!shotIds.has(shot)) err(`${path}.source.shot`, shot ? `Unknown shot "${shot}" (shots: ${[...shotIds].join(", ")}).` : 'A lastFrame source needs "shot": the id of the shot whose last frame this is.');
      source = { type: "lastFrame", shot };
    } else err(`${path}.source`, 'Source must be "generate", "upload", or { "type": "lastFrame", "shot": "<shot id>" }.');
    const prompt = str(a.prompt) ?? "";
    if (source.type === "generate" && !prompt) err(`${path}.prompt`, `Asset "${id}" is generated, so it needs a generation "prompt".`);
    const asp = str(a.aspect);
    if (asp && !ASPECT_RE.test(asp)) err(`${path}.aspect`, `Aspect "${asp}" should look like "16:9".`);
    const name = str(a.name) || id;
    const notes = str(a.notes);
    assets.push({ id, name, type, aspect: asp || aspect, prompt, references: strList(a.references, `${path}.references`), source, qa: strList(a.qa, `${path}.qa`), ...(notes ? { notes } : {}) });
  });
  assets.forEach((a, i) => a.references.forEach((r, j) => {
    if (r === a.id) err(`assets[${i}].references[${j}]`, `Asset "${a.id}" can't reference itself.`);
    else if (!assetIds.has(r)) err(`assets[${i}].references[${j}]`, `Unknown asset "${r}".`);
  }));
  const refCycle = findCycle(new Map(assets.map((a) => [a.id, a.references])));
  if (refCycle) err("assets", `Assets reference each other in a loop: ${refCycle.join(" → ")}.`);

  const shots: StoryShot[] = [];
  for (const pre of shotPre) {
    if (!pre) continue;
    const { s, path, id } = pre;
    const dur = typeof s.durationSec === "number" ? s.durationSec : NaN;
    if (!(dur >= 0.5 && dur <= 120)) err(`${path}.durationSec`, s.durationSec === undefined ? `Shot "${id}" needs "durationSec" (seconds, 0.5–120).` : `Duration ${JSON.stringify(s.durationSec)} must be a number of seconds between 0.5 and 120.`);
    const prompt = str(s.prompt) ?? "";
    if (!prompt) err(`${path}.prompt`, `Shot "${id}" needs a clip generation "prompt".`);
    const used = strList(s.assets, `${path}.assets`);
    used.forEach((a, j) => { if (!assetIds.has(a)) err(`${path}.assets[${j}]`, `Unknown asset "${a}"${assetIds.size ? ` (assets: ${[...assetIds].slice(0, 8).join(", ")}${assetIds.size > 8 ? ", …" : ""})` : ""}.`); });
    const shot: StoryShot = { id, title: str(s.title) || id, description: str(s.description) ?? "", durationSec: dur, prompt, assets: used, qa: strList(s.qa, `${path}.qa`) };
    const camera = str(s.camera), dialogue = str(s.dialogue);
    if (camera) shot.camera = camera;
    if (dialogue) shot.dialogue = dialogue;
    shots.push(shot);
  }

  // Frame dependencies: shot B using "last frame of A" depends on A's clip.
  const byId = new Map(assets.map((a) => [a.id, a]));
  const order = new Map(shots.map((s, i) => [s.id, i]));
  const deps = new Map(shots.map((s) => [s.id, s.assets.flatMap((a) => { const src = byId.get(a)?.source; return src?.type === "lastFrame" ? [src.shot] : []; })]));
  shots.forEach((s, i) => (deps.get(s.id) ?? []).forEach((d) => {
    if (d === s.id) err(`shots[${i}].assets`, `Shot "${s.id}" can't use its own last frame.`);
    else if ((order.get(d) ?? -1) > i) warn(`shots[${i}].assets`, `Shot "${s.id}" uses the last frame of "${d}", which comes later in the order.`);
  }));
  const depCycle = findCycle(new Map([...deps].map(([k, v]) => [k, v.filter((d) => d !== k)])));
  if (depCycle) err("shots", `Last-frame links form a loop: ${depCycle.join(" → ")}.`);
  assets.forEach((a, i) => { if (!shots.some((s) => s.assets.includes(a.id)) && !assets.some((b) => b.references.includes(a.id))) warn(`assets[${i}]`, `Asset "${a.id}" isn't used by any shot.`); });

  let connections: StoryConnection[] = [];
  if (raw.connections === undefined) {
    connections = shots.slice(1).map((s, i) => ({ from: shots[i].id, to: s.id, kind: (deps.get(s.id) ?? []).includes(shots[i].id) ? "continuity" : "cut" }));
  } else if (!Array.isArray(raw.connections)) err("connections", '"connections" must be a list.');
  else raw.connections.forEach((c, i) => {
    const path = `connections[${i}]`;
    if (!isObj(c)) return err(path, "Each connection must be an object.");
    const from = str(c.from) ?? "", to = str(c.to) ?? "";
    if (!shotIds.has(from)) err(`${path}.from`, `Unknown shot "${from}".`);
    if (!shotIds.has(to)) err(`${path}.to`, `Unknown shot "${to}".`);
    const kind = (str(c.kind) ?? "cut") as ConnectionKind;
    if (!CONNECTION_KINDS.includes(kind)) err(`${path}.kind`, `Kind "${kind}" must be one of: ${CONNECTION_KINDS.join(", ")}.`);
    const note = str(c.note);
    connections.push({ from, to, kind, ...(note ? { note } : {}) });
  });

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, doc: { format: STORYBOARD_FORMAT, meta, assets, shots, connections }, warnings };
}

/** First cycle in a dependency map (node → nodes it depends on), as a path ending where it started. */
export function findCycle(graph: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): string[] | undefined => {
    if (state.get(n) === 2) return undefined;
    if (state.get(n) === 1) return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 1); stack.push(n);
    for (const d of graph.get(n) ?? []) { if (!graph.has(d)) continue; const c = visit(d); if (c) return c; }
    stack.pop(); state.set(n, 2);
    return undefined;
  };
  for (const n of graph.keys()) { const c = visit(n); if (c) return c; }
  return undefined;
}

/** One-line summary for the import preview. */
export function storySummary(doc: StoryDoc): string {
  const total = doc.shots.reduce((t, s) => t + s.durationSec, 0);
  const frames = doc.assets.filter((a) => a.source.type === "lastFrame").length;
  const qa = doc.assets.reduce((t, a) => t + a.qa.length, 0) + doc.shots.reduce((t, s) => t + s.qa.length, 0);
  return `${doc.shots.length} shot${doc.shots.length === 1 ? "" : "s"} · ${Math.round(total * 10) / 10}s · ${doc.assets.length} asset${doc.assets.length === 1 ? "" : "s"}${frames ? ` (${frames} last-frame link${frames === 1 ? "" : "s"})` : ""} · ${qa} QA check${qa === 1 ? "" : "s"}`;
}

/**
 * Character ranges of every member in a JSON text, keyed by the validator's paths
 * ("meta.title", "shots[0].durationSec"). A member's range covers `"key": value`; array items cover the value.
 * Best effort: stops quietly at the first syntax error.
 */
export function jsonPathRanges(json: string): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  let i = 0;
  const ws = () => { while (i < json.length && /\s/.test(json[i])) i++; };
  const str = () => { const a = i++; while (i < json.length && json[i] !== '"') i += json[i] === "\\" ? 2 : 1; i++; return json.slice(a, i); };
  const value = (path: string, start: number): void => {
    ws();
    const c = json[i];
    if (c === "{") {
      i++; ws();
      while (i < json.length && json[i] !== "}") {
        ws(); const ks = i; if (json[i] !== '"') throw 0;
        const key = JSON.parse(str()) as string; ws(); if (json[i++] !== ":") throw 0;
        value(path ? `${path}.${key}` : key, ks); ws();
        if (json[i] === ",") i++;
        else if (json[i] !== "}") throw 0;
      }
      i++;
    } else if (c === "[") {
      i++; ws(); let n = 0;
      while (i < json.length && json[i] !== "]") {
        ws(); value(`${path}[${n++}]`, i); ws();
        if (json[i] === ",") i++;
        else if (json[i] !== "]") throw 0;
      }
      i++;
    } else if (c === '"') str();
    else { const m = /^[^,}\]\s]+/.exec(json.slice(i)); if (!m) throw 0; i += m[0].length; }
    if (path) out.set(path, { start, end: i });
  };
  try { value("", 0); } catch { /* partial map is still useful */ }
  return out;
}

/** Where an issue points in the pasted text (which may wrap the JSON in chat text or a fence); falls back to the nearest parent. */
export function locateIssue(text: string, issue: StoryIssue): { start: number; end: number } | undefined {
  const json = extractJson(text);
  const base = Math.max(0, text.indexOf(json));
  if (issue.at !== undefined) { const end = json.indexOf("\n", issue.at); return { start: base + issue.at, end: base + (end < 0 ? json.length : end) }; }
  if (!issue.path) return undefined;
  const ranges = jsonPathRanges(json);
  for (let p = issue.path; p; p = p.replace(/(\.[^.[\]]+|\[\d+\])$/, "") ) {
    const r = ranges.get(p);
    if (r) return { start: base + r.start, end: base + r.end };
    if (!/(\.[^.[\]]+|\[\d+\])$/.test(p)) break;
  }
  return undefined;
}
