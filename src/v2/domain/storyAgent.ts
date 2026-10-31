/**
 * P4C: storyboard tools for AI agents (WebMCP) and chunked storyboard JSON.
 *
 * Every tool edits the authored storyboard JSON (the same text Export writes) and runs the result through
 * `validateStoryboard`, the importer's own rules: a call that would make an invalid storyboard is rejected and the
 * board is left as it was. The input schemas are built from the parser's constants (asset types, renders, layer types,
 * audio kinds, reference roles, connection kinds), so tools and importer can't drift apart.
 *
 * Pure: no DOM, no engine. The UI (ui/agent/webMcp.ts) applies `doc` as one undoable command and handles `send`.
 */
import { seriesAssetList, type Series } from "./series";
import { applyInsertJson, buildInsertPrompt, insertResultText } from "./storyInsert";
import type { StoryValidateOptions } from "./storyJson";
import {
  AUDIO_KINDS, BACKGROUND_TYPES, CONNECTION_KINDS, LAYER_TYPES, REFERENCE_ROLES, SHOT_RENDERS, STORY_ASSET_TYPES,
  STORYBOARD_FORMAT, extractJson, storyDocJson, storySummary, validateStoryboard,
  type StoryDoc, type StoryIssue, type StoryParseResult,
} from "./storyJson";

type Obj = Record<string, unknown>;
type Raw = Obj & { meta?: Obj; assets: Obj[]; shots: Obj[]; connections: Obj[]; audio?: Obj[] };
type Schema = Obj;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The board as authored JSON (what Export writes), ready to edit. */
export function docToRaw(doc: StoryDoc): Raw {
  const raw = JSON.parse(storyDocJson(doc)) as Raw;
  raw.connections ??= [];
  return raw;
}

// ---------------------------------------------------------------------------------------------------------------
// Schemas (generated from the parser's constants)

const str = (description: string): Schema => ({ type: "string", description });
const num = (description: string): Schema => ({ type: "number", description });
const id = (description: string): Schema => ({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$", description });
const en = (values: readonly string[], description: string): Schema => ({ type: "string", enum: [...values], description });
const arr = (items: Schema, description: string): Schema => ({ type: "array", items, description });
const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string, open = true): Schema =>
  ({ type: "object", properties, ...(required.length ? { required } : {}), ...(open ? {} : { additionalProperties: false }), ...(description ? { description } : {}) });
const patch = (what: string): Schema => ({ type: "object", description: `Fields of the ${what} to change, in the storyboard format. Fields you leave out stay as they are; null removes a field. "id" can't change.`, additionalProperties: true });

const REFERENCE = obj({ asset: str('Asset id, "<asset>@<state>" or "<shot>.lastframe".'), role: en(REFERENCE_ROLES, "How the image is used."), note: str("What to take from it.") }, ["asset"]);
const STATE = obj({ id: id("State id, unique in its asset."), name: str("Display name."), prompt: str("What changes from the base look."), references: arr(REFERENCE, "Images to attach."), qa: arr(str("A check."), "QA checks.") }, ["id"], 'An asset state (another look of the same asset), referred to as "<asset id>@<state id>".');
const ASSET = obj({
  id: id("Unique asset id."), type: en(STORY_ASSET_TYPES, "Asset type."), name: str("Display name."), prompt: str("Generation prompt (or design / sound brief for html and json audio)."),
  source: { description: '"generate" (default), "upload", "json" (audio), "code" (html), or { "type": "lastFrame", "shot": "<id>" }.' },
  aspect: str('e.g. "16:9".'), references: arr(REFERENCE, "Images to attach."), qa: arr(str("A check."), "QA checks."), states: arr(STATE, "Other looks of this asset."),
}, ["id", "type", "name"], "A storyboard asset (see the guide's FORMAT section for every field).");
const LAYER = obj({ id: id("Layer id, unique in the shot."), type: en(LAYER_TYPES, "Layer type."), startSec: num("Start, seconds into the shot."), endSec: num("End, seconds into the shot.") }, ["id", "type", "startSec", "endSec"], "A layer drawn over the shot (text, html, image or video), as in the guide.");
const BACKGROUND: Schema = { description: `A hex colour ("#000000") or a gradient { "type": ${BACKGROUND_TYPES.map((t) => `"${t}"`).join(" | ")}, "angle"?, "stops": [{ "color", "at"? }] }. null removes it.` };
const SHOT = obj({
  id: id("Unique shot id (e.g. s12)."), title: str("Short title."), description: str("What happens."), durationSec: num("Planned on-screen length in seconds."),
  qa: arr(str("A check."), "Checks of the edit (text, layers, timing); the clip's own checks go on the clip asset."),
  render: en(SHOT_RENDERS, 'How the shot is made (default "ai").'),
  clip: str('Schema 3.1: render ai = the video asset (clip) that carries the prompt, references and generation params; the same clip in several shots reuses one generation. html asset (render html) or image asset (render still).'),
  inSec: num("Seconds into a shared clip where this shot starts playing it (default 0)."),
  layers: arr(LAYER, "Layers on top."), background: BACKGROUND,
}, ["id", "title", "durationSec"], 'A storyboard shot, schema 3.1 (RULE 51): no "prompt"; add its clip asset first (add_asset, type video) and name it in "clip". See the guide\'s FORMAT section for every field.');
const CUE = obj({
  id: id('Cue id (default "audio<n>").'), asset: str('Audio asset id (leave out when "source" is given).'),
  source: { type: "object", description: 'P18: take the sound from a video instead of an audio asset: { fromVideo: "<video asset id or shot id>", inSec?: seconds into the video (default the clip\'s in point, else 0), outSec?: seconds into the video (default its end) }.', properties: { fromVideo: { type: "string" }, inSec: { type: "number" }, outSec: { type: "number" } }, required: ["fromVideo"] }, kind: en(AUDIO_KINDS, "Cue kind."), from: str("Shot id the cue starts at."), to: str("Shot id it ends at (inclusive)."),
  atSec: num("Offset into the from shot."), volume: num("0-2, 1 = as recorded."),
  position: { type: "object", description: "P14: where the sound sits: { azimuth: -180..180 degrees (0 front, -90 left, 90 right, ±180 behind), distance: 0 (at the ear) .. 1 (≈20 m), width?: 0..1 (1 = keep a stereo file's own image) }." },
  pan: num("-1..1 shorthand: azimuth = pan × 90, distance 0."),
  positionKeys: { type: "array", description: "P14: animated position [{ t: seconds from the cue start, azimuth, distance }], linear, shortest way round." },
}, ["kind", "from"], 'An audio cue on the storyboard: needs "asset" (an audio asset) or "source" { fromVideo, inSec?, outSec? }.');
const CONNECTION = obj({ from: str("Shot id."), to: str("The next shot id."), kind: en(CONNECTION_KINDS, "How the shots join."), note: str("Why."), transition: { description: 'A transition preset { "preset", "durationSec"? }; null removes it.' } }, ["from", "to"]);

// ---------------------------------------------------------------------------------------------------------------
// Tools

export interface ToolCtx {
  /** The guide markdown served by get_guide (built by the caller from aiGuide, which imports this module). */
  guide: () => string;
  /** P5: the project's Series (seriesRef assets resolve against it; the Series tools read it). */
  series?: Series;
  /** P21: ids of assets / clips that already have a generated or uploaded version (plan_insert_shots marks them). */
  generated?: ReadonlySet<string>;
}
/** A finished call: text for the agent, plus the new doc for mutating tools (apply as one undo step labelled `label`). */
export interface ToolResult { ok: boolean; text: string; doc?: StoryDoc; label?: string; send?: boolean; sync?: boolean }
type Edit = (raw: Raw, args: Obj, ctx: ToolCtx) => string | { label: string; message: string };

export interface StoryTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  readOnly: boolean;
  /** Mutating tools: edit the raw JSON and return a label + message, or an error string. */
  edit?: Edit;
  /** Read-only tools. */
  read?: (raw: Raw | undefined, args: Obj, ctx: ToolCtx, doc: StoryDoc | undefined) => ToolResult;
  /** May run with no storyboard yet. */
  creates?: boolean;
}

const findIdx = (list: Obj[] | undefined, key: unknown) => (list ?? []).findIndex((x) => x.id === key);
const need = (args: Obj, k: string) => (typeof args[k] === "string" && args[k] ? (args[k] as string) : undefined);

function applyPatch(target: Obj, p: unknown): string | undefined {
  if (!isObj(p)) return '"patch" must be an object of fields to change.';
  if ("id" in p && p.id !== target.id) return 'An id can\'t change: remove it and add a new one (anything that refers to the old id must change too).';
  for (const [k, v] of Object.entries(p)) { if (v === null) delete target[k]; else target[k] = clone(v); }
  return undefined;
}
const nextCueId = (raw: Raw) => { let n = (raw.audio?.length ?? 0) + 1; while (findIdx(raw.audio, `audio${n}`) >= 0) n++; return `audio${n}`; };

function shotEdit(raw: Raw, args: Obj, fn: (s: Obj) => string | undefined, label: (s: Obj) => string): ReturnType<Edit> {
  const sid = need(args, "id"); const i = findIdx(raw.shots, sid);
  if (i < 0) return `No shot "${sid ?? ""}". Shot ids: ${raw.shots.map((s) => s.id).join(", ")}.`;
  const e = fn(raw.shots[i]); if (e) return e;
  return { label: label(raw.shots[i]), message: `Shot "${String(raw.shots[i].id)}" updated.` };
}

export const STORY_TOOLS: StoryTool[] = [
  {
    name: "get_guide", title: "Read the storyboard guide", readOnly: true,
    description: "The Dionysus storyboard guide: how the format becomes a video, every field, the preset ids you may use, the numbered rules and an example. Read it before editing.",
    inputSchema: obj({}), read: (_r, _a, ctx) => ({ ok: true, text: ctx.guide() }),
  },
  {
    name: "get_storyboard", title: "Read the storyboard", readOnly: true,
    description: 'Without "id": a summary (title, counts, the shot list with ids, durations and titles, asset ids, cue ids). With "id": the full JSON of that shot, asset ("<asset>@<state>" for a state), audio cue, or "meta" / "connections".',
    inputSchema: obj({ id: str('Optional: a shot, asset, "<asset>@<state>", cue id, "meta" or "connections".') }),
    read: (raw, args, _c, doc) => {
      if (!raw || !doc) return { ok: true, text: "No storyboard yet. Create one with create_storyboard (meta, assets and at least one shot), or ask the user to import storyboard JSON." };
      const key = need(args, "id");
      if (!key) {
        const shots = raw.shots.map((s) => `${s.id} · ${s.durationSec}s · ${s.render ?? "ai"} · ${s.title}`).join("\n");
        const assets = raw.assets.map((a) => `${a.id} (${a.type}) ${a.name}${Array.isArray(a.states) && a.states.length ? ` · states: ${(a.states as Obj[]).map((s) => s.id).join(", ")}` : ""}`).join("\n");
        const cues = (raw.audio ?? []).map((c) => `${c.id} · ${c.kind} ${(c as { source?: { fromVideo?: string } }).source ? `from video ${(c as { source?: { fromVideo?: string } }).source?.fromVideo}` : c.asset} ${c.from}${c.to ? `→${c.to}` : ""}`).join("\n");
        return { ok: true, text: `${String(raw.meta?.title ?? "")}\n${storySummary(doc)}\n\nShots (in order):\n${shots}\n\nAssets:\n${assets || "(none)"}\n\nAudio cues:\n${cues || "(none)"}` };
      }
      if (key === "meta") return { ok: true, text: JSON.stringify(raw.meta, null, 2) };
      if (key === "connections") return { ok: true, text: JSON.stringify(raw.connections, null, 2) };
      const [base, state] = key.split("@");
      const hit = state ? (raw.assets[findIdx(raw.assets, base)]?.states as Obj[] | undefined)?.find((s) => s.id === state)
        : raw.shots[findIdx(raw.shots, key)] ?? raw.assets[findIdx(raw.assets, key)] ?? raw.audio?.[findIdx(raw.audio, key)];
      return hit ? { ok: true, text: JSON.stringify(hit, null, 2) } : { ok: false, text: `Nothing with id "${key}". Call get_storyboard without an id for the list.` };
    },
  },
  {
    name: "create_storyboard", title: "Create a storyboard", readOnly: false, creates: true,
    description: 'Start a new storyboard when there is none: "meta" (title, aspect, style, …), any "assets", and at least one shot. Add the rest with add_shot. Fails if a storyboard exists (edit it instead).',
    inputSchema: obj({ meta: obj({ title: str("Video title.") }, ["title"], "The storyboard meta, as in the guide."), assets: arr(ASSET, "Assets."), shots: arr(SHOT, "At least one shot."), audio: arr(CUE, "Audio cues."), connections: arr(CONNECTION, "Connections.") }, ["meta", "shots"]),
    edit: (raw, a) => {
      if (raw.shots.length) return "A storyboard already exists. Edit it with the other tools (or the user can replace it from Import).";
      raw.meta = clone(a.meta as Obj); raw.assets = clone((a.assets as Obj[]) ?? []); raw.shots = clone((a.shots as Obj[]) ?? []);
      raw.connections = clone((a.connections as Obj[]) ?? []); if (Array.isArray(a.audio)) raw.audio = clone(a.audio as Obj[]);
      return { label: "AI: create storyboard", message: "Storyboard created." };
    },
  },
  {
    name: "update_meta", title: "Update title and settings", readOnly: false,
    description: 'Change storyboard "meta" fields (title, aspect, style, fps, textStyles, audioOutput { mode: stereo | binaural, environment?: room | outdoor }, …).',
    inputSchema: obj({ patch: patch("meta") }, ["patch"]),
    edit: (raw, a) => { raw.meta ??= {}; const e = applyPatch(raw.meta, a.patch); return e ?? { label: "AI: update storyboard settings", message: "Meta updated." }; },
  },
  {
    name: "add_asset", title: "Add an asset", readOnly: false,
    description: "Add an asset (character, location, prop, style, image, frame, video, audio or html).",
    inputSchema: obj({ asset: ASSET }, ["asset"]),
    edit: (raw, a) => { if (!isObj(a.asset)) return '"asset" must be an object.'; if (findIdx(raw.assets, a.asset.id) >= 0) return `Asset "${String(a.asset.id)}" already exists; use update_asset.`; raw.assets.push(clone(a.asset)); return { label: `AI: add asset ${String(a.asset.id)}`, message: `Asset "${String(a.asset.id)}" added.` }; },
  },
  {
    name: "update_asset", title: "Change an asset", readOnly: false,
    description: "Change fields of an asset (name, prompt, references, qa, aspect, source, states, …).",
    inputSchema: obj({ id: str("Asset id."), patch: patch("asset") }, ["id", "patch"]),
    edit: (raw, a) => { const i = findIdx(raw.assets, a.id); if (i < 0) return `No asset "${String(a.id)}".`; const e = applyPatch(raw.assets[i], a.patch); return e ?? { label: `AI: edit asset ${String(a.id)}`, message: `Asset "${String(a.id)}" updated.` }; },
  },
  {
    name: "remove_asset", title: "Remove an asset", readOnly: false,
    description: "Remove an asset. Rejected while a shot, layer, cue or other asset still uses it (the error lists where); change those first.",
    inputSchema: obj({ id: str("Asset id.") }, ["id"]),
    edit: (raw, a) => { const i = findIdx(raw.assets, a.id); if (i < 0) return `No asset "${String(a.id)}".`; raw.assets.splice(i, 1); return { label: `AI: remove asset ${String(a.id)}`, message: `Asset "${String(a.id)}" removed.` }; },
  },
  {
    name: "add_asset_state", title: "Add an asset state", readOnly: false,
    description: 'Add another look of an asset (lamp on, coat soaked, street at night), used as "<asset>@<state>".',
    inputSchema: obj({ asset: str("Asset id."), state: STATE }, ["asset", "state"]),
    edit: (raw, a) => {
      const i = findIdx(raw.assets, a.asset); if (i < 0) return `No asset "${String(a.asset)}".`; if (!isObj(a.state)) return '"state" must be an object.';
      const states = (raw.assets[i].states as Obj[] | undefined) ?? [];
      if (states.some((s) => s.id === (a.state as Obj).id)) return `State "${String(a.asset)}@${String(a.state.id)}" already exists; use update_asset_state.`;
      raw.assets[i].states = [...states, clone(a.state)];
      return { label: `AI: add state ${String(a.asset)}@${String(a.state.id)}`, message: `State "${String(a.asset)}@${String(a.state.id)}" added.` };
    },
  },
  {
    name: "update_asset_state", title: "Change an asset state", readOnly: false,
    description: "Change fields of an asset state (name, prompt, references, qa).",
    inputSchema: obj({ asset: str("Asset id."), id: str("State id."), patch: patch("state") }, ["asset", "id", "patch"]),
    edit: (raw, a) => {
      const i = findIdx(raw.assets, a.asset); const st = (raw.assets[i]?.states as Obj[] | undefined)?.find((s) => s.id === a.id);
      if (!st) return `No state "${String(a.asset)}@${String(a.id)}".`;
      const e = applyPatch(st, a.patch); return e ?? { label: `AI: edit state ${String(a.asset)}@${String(a.id)}`, message: `State "${String(a.asset)}@${String(a.id)}" updated.` };
    },
  },
  {
    name: "add_shot", title: "Add a shot", readOnly: false,
    description: 'Add a shot. "after": the shot id to insert after (omit to append at the end; null to insert first). Add a long story in batches of shots.',
    inputSchema: obj({ shot: SHOT, after: { type: ["string", "null"], description: "Insert after this shot id; null = first; omitted = last." } }, ["shot"]),
    edit: (raw, a) => {
      if (!isObj(a.shot)) return '"shot" must be an object.'; const sid = String(a.shot.id);
      if (findIdx(raw.shots, sid) >= 0) return `Shot "${sid}" already exists; use update_shot.`;
      let at = raw.shots.length;
      if (a.after === null) at = 0; else if (typeof a.after === "string") { const j = findIdx(raw.shots, a.after); if (j < 0) return `No shot "${a.after}" to insert after.`; at = j + 1; }
      raw.shots.splice(at, 0, clone(a.shot));
      return { label: `AI: add shot ${sid}`, message: `Shot "${sid}" added at position ${at + 1} of ${raw.shots.length}.` };
    },
  },
  {
    name: "update_shot", title: "Change a shot", readOnly: false,
    description: "Change fields of a shot (title, description, durationSec, clip, inSec, dialogue, qa, render, effects (each may set applyTo: main, overlay or all), …). Schema 3.1: a shot has no prompt; change the prompt, references, camera, keyframe or genDurationSec of its clip with update_asset (a shared clip changes every shot that uses it).",
    inputSchema: obj({ id: str("Shot id."), patch: patch("shot") }, ["id", "patch"]),
    edit: (raw, a) => shotEdit(raw, a, (s) => applyPatch(s, a.patch), (s) => `AI: edit shot ${String(s.id)}`),
  },
  {
    name: "remove_shot", title: "Remove a shot", readOnly: false,
    description: "Remove a shot, its connections and its own (auto) clip. Rejected while a cue, last-frame link or other shot still needs it; change those first.",
    inputSchema: obj({ id: str("Shot id.") }, ["id"]),
    edit: (raw, a) => {
      const i = findIdx(raw.shots, a.id); if (i < 0) return `No shot "${String(a.id)}".`;
      const [gone] = raw.shots.splice(i, 1); raw.connections = raw.connections.filter((c) => c.from !== a.id && c.to !== a.id);
      // P16: its own auto clip goes with it (a clip another shot still plays stays).
      const own = raw.assets.find((x) => x.id === gone.clip && x.auto === true);
      if (own) {
        const rest = raw.assets.filter((x) => x !== own);
        if (!JSON.stringify({ ...raw, assets: rest }).includes(`"${String(own.id)}"`)) raw.assets = rest;
      }
      return { label: `AI: remove shot ${String(a.id)}`, message: `Shot "${String(a.id)}" removed.` };
    },
  },
  {
    name: "set_shot_layers", title: "Set a shot's layers", readOnly: false,
    description: "Replace all layers of a shot (text, html, image, video), drawn in order on top. [] removes them. Text layers may set anim.inParams, e.g. the typewriter cursor { cursor, blink, after: blink|hide|fade, scramble }. A layer is linked to its shot's main clip on Send to timeline unless it sets link: false (RULE 46).",
    inputSchema: obj({ id: str("Shot id."), layers: arr(LAYER, "The layers, in drawing order.") }, ["id", "layers"]),
    edit: (raw, a) => shotEdit(raw, a, (s) => { if (!Array.isArray(a.layers)) return '"layers" must be a list.'; if (a.layers.length) s.layers = clone(a.layers); else delete s.layers; return undefined; }, (s) => `AI: layers of shot ${String(s.id)}`),
  },
  {
    name: "set_shot_background", title: "Set a shot's background", readOnly: false,
    description: 'Give a still shot a colour or gradient background (sets "render": "still"); null removes it. Use clip or background, not both.',
    inputSchema: obj({ id: str("Shot id."), background: BACKGROUND }, ["id", "background"]),
    edit: (raw, a) => shotEdit(raw, a, (s) => { if (a.background === null || a.background === undefined) delete s.background; else { s.background = clone(a.background); s.render = "still"; } return undefined; }, (s) => `AI: background of shot ${String(s.id)}`),
  },
  {
    name: "set_shot_params", title: "Set an html shot's params", readOnly: false,
    description: 'Set the params of an html shot\'s clip (e.g. a title card\'s text). Merged into the current values; null removes one; "replace": true replaces them all.',
    inputSchema: obj({ id: str("Shot id."), params: { type: "object", description: "Param key → value.", additionalProperties: true }, replace: { type: "boolean", description: "Replace instead of merge." } }, ["id", "params"]),
    edit: (raw, a) => shotEdit(raw, a, (s) => {
      if (!isObj(a.params)) return '"params" must be an object.';
      const next: Obj = a.replace ? {} : { ...(isObj(s.params) ? s.params : {}) };
      for (const [k, v] of Object.entries(a.params)) { if (v === null) delete next[k]; else next[k] = clone(v); }
      if (Object.keys(next).length) s.params = next; else delete s.params; return undefined;
    }, (s) => `AI: params of shot ${String(s.id)}`),
  },
  {
    name: "reorder_shots", title: "Reorder shots", readOnly: false,
    description: 'Move one shot ("id" + 0-based "index") or give the whole new "order" (every shot id once).',
    inputSchema: obj({ id: str("Shot to move."), index: { type: "integer", minimum: 0, description: "New 0-based position." }, order: arr(str("Shot id."), "Every shot id in the new order.") }),
    edit: (raw, a) => {
      if (Array.isArray(a.order)) {
        const ids = raw.shots.map((s) => s.id as string); const o = a.order as string[];
        if (o.length !== ids.length || new Set(o).size !== o.length || !o.every((x) => ids.includes(x))) return `"order" must list every shot id exactly once: ${ids.join(", ")}.`;
        raw.shots = o.map((x) => raw.shots[findIdx(raw.shots, x)]);
        return { label: "AI: reorder shots", message: "Shots reordered." };
      }
      const i = findIdx(raw.shots, a.id); if (i < 0) return `No shot "${String(a.id ?? "")}" (give "id" and "index", or "order").`;
      const to = Math.max(0, Math.min(raw.shots.length - 1, Math.floor(Number(a.index)))); if (!Number.isFinite(to)) return '"index" must be a number.';
      const [s] = raw.shots.splice(i, 1); raw.shots.splice(to, 0, s);
      return { label: `AI: move shot ${String(a.id)}`, message: `Shot "${String(a.id)}" moved to position ${to + 1}.` };
    },
  },
  {
    name: "set_connection", title: "Set how two shots join", readOnly: false,
    description: 'Set the connection between two adjacent shots (kind cut / continuity / match, note, transition). "remove": true deletes it.',
    inputSchema: obj({ connection: CONNECTION, remove: { type: "boolean", description: "Delete the connection." } }, ["connection"]),
    edit: (raw, a) => {
      if (!isObj(a.connection)) return '"connection" must be an object.'; const c = a.connection;
      const i = raw.connections.findIndex((x) => x.from === c.from && x.to === c.to);
      if (a.remove) { if (i < 0) return `No connection ${String(c.from)} → ${String(c.to)}.`; raw.connections.splice(i, 1); }
      else if (i < 0) raw.connections.push(Object.fromEntries(Object.entries(clone(c)).filter(([, v]) => v !== null)));
      else { const e = applyPatch(raw.connections[i], c); if (e) return e; }
      return { label: `AI: connection ${String(c.from)} → ${String(c.to)}`, message: `Connection ${String(c.from)} → ${String(c.to)} ${a.remove ? "removed" : "set"}.` };
    },
  },
  {
    name: "add_cue", title: "Add an audio cue", readOnly: false,
    description: 'Add an audio cue (voiceover, music, sfx, ambience, sting, dialogue) that plays from a shot: an audio "asset", or "source": { "fromVideo", "inSec"?, "outSec"? } to use the sound of a video asset or of a shot\'s clip. Gets "audio<n>" as id when you give none.',
    inputSchema: obj({ cue: CUE }, ["cue"]),
    edit: (raw, a) => {
      if (!isObj(a.cue)) return '"cue" must be an object.'; const c = clone(a.cue); c.id ??= nextCueId(raw);
      if (findIdx(raw.audio, c.id) >= 0) return `Cue "${String(c.id)}" already exists; use update_cue.`;
      raw.audio = [...(raw.audio ?? []), c]; return { label: `AI: add cue ${String(c.id)}`, message: `Cue "${String(c.id)}" added.` };
    },
  },
  {
    name: "update_cue", title: "Change an audio cue", readOnly: false,
    description: "Change fields of an audio cue (from, to, atSec, volume, fades, loop, volumeKeys, fx, position { azimuth, distance, width? }, pan, positionKeys, source { fromVideo, inSec?, outSec? }, …).",
    inputSchema: obj({ id: str("Cue id."), patch: patch("cue") }, ["id", "patch"]),
    edit: (raw, a) => { const i = findIdx(raw.audio, a.id); if (i < 0) return `No cue "${String(a.id)}".`; const e = applyPatch(raw.audio![i], a.patch); return e ?? { label: `AI: edit cue ${String(a.id)}`, message: `Cue "${String(a.id)}" updated.` }; },
  },
  {
    name: "remove_cue", title: "Remove an audio cue", readOnly: false,
    description: "Remove an audio cue.",
    inputSchema: obj({ id: str("Cue id.") }, ["id"]),
    edit: (raw, a) => { const i = findIdx(raw.audio, a.id); if (i < 0) return `No cue "${String(a.id)}".`; raw.audio!.splice(i, 1); if (!raw.audio!.length) delete raw.audio; return { label: `AI: remove cue ${String(a.id)}`, message: `Cue "${String(a.id)}" removed.` }; },
  },
  {
    name: "list_series_assets", title: "List the Series assets", readOnly: true,
    description: "List the shared assets of the Series this project belongs to (id, type, name, short description, states). Reuse them with use_series_asset instead of defining a new character, prop, location or style.",
    inputSchema: obj({}),
    read: (_r, _a, ctx) => {
      if (!ctx.series) return { ok: true, text: "This project isn't in a Series. (The user picks one in Project settings → Series.)" };
      const rows = seriesAssetList(ctx.series);
      return { ok: true, text: rows.length ? `Series "${ctx.series.name}", ${rows.length} asset(s):\n${rows.map((r) => `- ${r.id} (${r.type}) ${r.name}${r.description ? ` — ${r.description}` : ""}${r.states.length ? ` · states: ${r.states.join(", ")}` : ""}${r.versions ? ` · ${r.versions} version(s)` : ""}`).join("\n")}` : `Series "${ctx.series.name}" has no assets yet.` };
    },
  },
  {
    name: "use_series_asset", title: "Use a Series asset", readOnly: false,
    description: 'Add a Series asset to the board, linked: its definition, states and uploads come from the Series and stay in sync. Then use its id (or "<id>@<state>") in shots.',
    inputSchema: obj({ id: str("Series asset id (see list_series_assets)."), as: str("Board id to use, when it must differ from the Series id (default: the same id).") }, ["id"]),
    edit: (raw, a, ctx) => {
      const id = String(a.id ?? ""), as = typeof a.as === "string" && a.as ? a.as : id;
      if (!ctx.series) return "This project isn't in a Series.";
      if (!ctx.series.assets[id]) return `The Series has no asset "${id}". Series assets: ${Object.keys(ctx.series.assets).join(", ") || "none"}.`;
      const i = findIdx(raw.assets, as);
      if (i >= 0) { if (raw.assets[i].seriesRef === id) return `"${as}" already uses the Series asset "${id}".`; raw.assets[i] = { id: as, seriesRef: id }; }
      else raw.assets.push({ id: as, seriesRef: id });
      return { label: `AI: use series asset ${id}`, message: `"${as}" now uses the Series asset "${id}".` };
    },
  },
  {
    name: "promote_to_series", title: "Add an asset to the Series", readOnly: false,
    description: "Add a board asset to the project's Series so later episodes can reuse it (sets \"series\": true; the app adds it with its uploads and links it). If the Series already has that id, the board links to it (dedupe by id).",
    inputSchema: obj({ id: str("Board asset id.") }, ["id"]),
    edit: (raw, a, ctx) => {
      const i = findIdx(raw.assets, a.id);
      if (i < 0) return `No asset "${String(a.id)}".`;
      if (!ctx.series) return "This project isn't in a Series.";
      if (raw.assets[i].seriesRef) return `"${String(a.id)}" already uses the Series asset "${String(raw.assets[i].seriesRef)}".`;
      raw.assets[i].series = true;
      return { label: `AI: promote ${String(a.id)} to series`, message: `"${String(a.id)}" will be added to the Series "${ctx.series.name}".` };
    },
  },
  {
    name: "validate", title: "Check the storyboard", readOnly: true,
    description: "Run the importer's checks on the current storyboard and list its warnings (edits are already checked; this reports what is left to improve).",
    inputSchema: obj({}),
    read: (raw, _a, ctx) => {
      if (!raw) return { ok: false, text: "No storyboard yet." };
      const r = validateStoryboard(raw, { series: ctx.series });
      return r.ok ? { ok: true, text: r.warnings.length ? `Valid, with ${r.warnings.length} warning(s):\n${issueLines(r.warnings, raw)}` : "Valid, no warnings." } : { ok: false, text: `Invalid:\n${issueLines(r.errors, raw)}` };
    },
  },
  {
    name: "export_json", title: "Export storyboard JSON", readOnly: true,
    description: 'The whole storyboard as storyboard JSON ("dionysus.storyboard/1"), edits included.',
    inputSchema: obj({}), read: (_r, _a, _c, doc) => (doc ? { ok: true, text: storyDocJson(doc) } : { ok: false, text: "No storyboard yet." }),
  },
  {
    name: "send_to_timeline", title: "Update the timeline", readOnly: false,
    description: "Update the timeline from the storyboard (update mode): adds shots that have a clip and new audio cues, switches changed clips and refreshes shot text; everything else on the timeline stays. Shots without an uploaded clip are skipped. New layers and in-shot cues are linked to their shot's main clip (moved, trimmed and deleted with it) unless they set link: false.",
    inputSchema: obj({}),
  },
  {
    name: "sync_to_storyboard", title: "Sync the timeline to the storyboard", readOnly: false,
    description: "Write timeline edits back to the storyboard (one undo step): clip lengths, order and trims, layers, effects and audio cues of the shots they came from. Timeline clips with no shot become new shots, layers or cues flagged needsPrompt; shots whose clip was removed are kept and flagged removedFromTimeline. Afterwards call list_needs_prompt and fill every item.",
    inputSchema: obj({}),
  },
  {
    name: "list_needs_prompt", title: "List items that need a prompt", readOnly: true,
    description: "List the shots, layers and audio cues flagged needsPrompt (made on the timeline by Sync to Storyboard). Fill each: a shot needs a description (update_shot) and a clip generation prompt on its clip asset (update_asset), a layer or cue needs a description (set_shot_layers / update_cue); filling it clears the flag.",
    inputSchema: obj({}),
    read: (_r, _a, _c, doc) => {
      if (!doc) return { ok: false, text: "No storyboard yet." };
      const rows: string[] = [];
      for (const s of doc.shots) {
        if (s.needsPrompt) rows.push(`- shot ${s.id} "${s.title}" (${s.durationSec}s): write description and prompt`);
        for (const l of s.layers ?? []) if (l.needsPrompt) rows.push(`- layer ${l.id} of shot ${s.id} (${l.type}${l.type === "text" ? ` "${l.text}"` : ` asset ${l.asset}`}, ${l.startSec}–${l.endSec}s): write a description`);
      }
      for (const c of doc.audio ?? []) if (c.needsPrompt) rows.push(`- audio cue ${c.id} (asset ${c.asset}, shot ${c.from}): write a description`);
      return { ok: true, text: rows.length ? `${rows.length} item(s) need a prompt:\n${rows.join("\n")}` : "Nothing needs a prompt." };
    },
  },
  {
    name: "plan_insert_shots", title: "Plan shots to insert", readOnly: false,
    description: 'P21 "Plan with AI" for Insert shot after. Without "insertJson": returns the planning prompt for inserting shots after shot "after" (last-shot description, neighbouring shots, every asset and clip with generated or not, the guide rules and the strict answer format). With "insertJson" ({"schema":"3.1-insert","insertAfter","shots","newAssets","audio"?}): validates it with the importer and inserts the shots after "after" with the new assets, in one undo step; the following shots are renumbered.',
    inputSchema: obj({
      after: { type: "string", description: "The shot id to insert after." },
      lastShotDescription: { type: "string", description: "Short description of that shot (default: its description)." },
      insertJson: { type: ["string", "object"], description: "The insert answer to apply (omit to get the prompt)." },
    }, ["after"]),
    read: (_raw, a, ctx, doc) => {
      if (!doc) return { ok: false, text: "No storyboard yet." };
      const after = need(a, "after"); const shot = doc.shots.find((s) => s.id === after);
      if (!shot) return { ok: false, text: `No shot "${after ?? ""}". Shot ids: ${doc.shots.map((s) => s.id).join(", ")}.` };
      if (a.insertJson === undefined) {
        const desc = need(a, "lastShotDescription") ?? shot.description;
        if (!desc.trim()) return { ok: false, text: `Shot "${after}" has no description: pass "lastShotDescription".` };
        return { ok: true, text: buildInsertPrompt(doc, shot.id, desc, ctx.generated) };
      }
      const text = typeof a.insertJson === "string" ? a.insertJson : JSON.stringify(a.insertJson);
      const r = applyInsertJson(doc, text, { series: ctx.series, expectAfter: shot.id, generated: ctx.generated });
      return r.ok ? { ok: true, text: insertResultText(r), doc: r.doc, label: `AI: insert ${r.preview.shots.length} shot(s) after ${shot.id}` } : { ok: false, text: `Rejected, nothing changed. ${insertResultText(r)}` };
    },
  },
];

const TOOL = new Map(STORY_TOOLS.map((t) => [t.name, t]));

/** Issues as lines, with the shot/asset id next to list paths ("shots[3] (s4).prompt"). */
export const namedPath = (p: string, raw?: Obj) => p.replace(/^(shots|assets|audio)\[(\d+)\]/, (m, k: string, i: string) => { const x = (raw?.[k] as Obj[] | undefined)?.[Number(i)]; return x && typeof x.id === "string" ? `${m} (${x.id})` : m; });
export function issueLines(issues: StoryIssue[], raw?: Raw, max = 20): string {
  const named = (p: string) => namedPath(p, raw);
  const lines = issues.slice(0, max).map((e) => `- ${e.path ? `${named(e.path)}: ` : ""}${e.message}`);
  if (issues.length > max) lines.push(`- … and ${issues.length - max} more`);
  return lines.join("\n");
}

/** Run one tool against the current board. Mutating tools return the validated new doc; nothing is applied here. */
export function runStoryTool(name: string, args: unknown, doc: StoryDoc | undefined, ctx: ToolCtx): ToolResult {
  const tool = TOOL.get(name);
  if (!tool) return { ok: false, text: `Unknown tool "${name}".` };
  const a: Obj = isObj(args) ? args : {};
  const raw = doc ? docToRaw(doc) : undefined;
  if (tool.read) return tool.read(raw, a, ctx, doc);
  if (name === "sync_to_storyboard") return doc ? { ok: true, text: "Syncing.", sync: true, label: "AI: sync to storyboard" } : { ok: false, text: "No storyboard yet." };
  if (name === "send_to_timeline") return doc ? { ok: true, text: "Sending.", send: true, label: "AI: update timeline" } : { ok: false, text: "No storyboard yet." };
  if (!raw && !tool.creates) return { ok: false, text: "No storyboard yet. Create one with create_storyboard first." };
  const work: Raw = raw ?? { format: STORYBOARD_FORMAT, meta: {}, assets: [], shots: [], connections: [] };
  let out: ReturnType<Edit>;
  try { out = tool.edit!(work, a, ctx); } catch (e) { out = `Bad arguments: ${(e as Error).message}`; }
  if (typeof out === "string") return { ok: false, text: `Rejected, nothing changed: ${out}` };
  const r = validateStoryboard(work, { series: ctx.series });
  if (!r.ok) return { ok: false, text: `Rejected, nothing changed. The storyboard would be invalid:\n${issueLines(r.errors, work)}` };
  const warn = r.warnings.length ? `\n${r.warnings.length} warning(s) on the board (call validate to list them).` : "";
  return { ok: true, text: `${out.message} ${storySummary(r.doc)}.${warn}`, doc: r.doc, label: out.label };
}

/** Markdown list of the tools (WEB_MCP.md and llms.txt), generated so the docs match the code. */
export function storyToolsMarkdown(): string {
  return STORY_TOOLS.map((t) => {
    const props = Object.keys((t.inputSchema.properties as Obj | undefined) ?? {});
    return `- \`${t.name}\`${props.length ? `(${props.join(", ")})` : ""}${t.readOnly ? " · read-only" : ""}: ${t.description}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Chunked JSON (a storyboard in parts)

/** True for a storyboard part: it has a "part" object, or it has no "meta" but brings shots, assets or audio. */
export function isStoryPart(raw: unknown): raw is Obj {
  if (!isObj(raw)) return false;
  if (isObj(raw.part)) return true;
  return raw.meta === undefined && ["shots", "assets", "audio", "connections"].some((k) => Array.isArray(raw[k]));
}

export interface PartResult { result: StoryParseResult; counts?: { shots: number; assets: number; audio: number; connections: number; removed: number } }

const mergeById = (base: Obj[], add: unknown, key = (x: Obj) => x.id as unknown, place?: (list: Obj[], x: Obj) => void) => {
  const list = [...base];
  for (const x of Array.isArray(add) ? add : []) {
    if (!isObj(x)) continue;
    const i = list.findIndex((y) => key(y) === key(x));
    if (i >= 0) list[i] = clone(x); else if (place) place(list, clone(x)); else list.push(clone(x));
  }
  return list;
};

/**
 * Merge a storyboard part into the current board by id: assets, shots, audio cues (and asset states inside a changed
 * asset) replace the ones with the same id, new ones are added (shots after "part.after", else at the end);
 * connections match by from/to; "meta" fields are merged. "part.remove": ["id", …] removes shots, assets or cues.
 * The merged storyboard is checked as a whole.
 */
export function mergeStoryPart(base: StoryDoc, part: Obj, opts: StoryValidateOptions = {}): PartResult {
  const raw = docToRaw(base);
  const p = isObj(part.part) ? part.part : {};
  const errs: StoryIssue[] = [];
  if (part.format !== undefined && part.format !== STORYBOARD_FORMAT) errs.push({ path: "format", message: `"format" must be "${STORYBOARD_FORMAT}".` });
  if (isObj(part.meta)) raw.meta = { ...(raw.meta ?? {}), ...clone(part.meta) };
  let after = typeof p.after === "string" ? p.after : undefined;
  if (after !== undefined && findIdx(raw.shots, after) < 0) errs.push({ path: "part.after", message: `"part.after" is "${after}", which is not a shot on the board.` });
  raw.assets = mergeById(raw.assets, part.assets);
  raw.shots = mergeById(raw.shots, part.shots, undefined, (list, x) => {
    if (p.after === null) { list.splice(0, 0, x); return; }
    const j = after !== undefined ? findIdx(list, after) : -1;
    if (j >= 0) { list.splice(j + 1, 0, x); after = x.id as string; } else list.push(x);
  });
  raw.connections = mergeById(raw.connections, part.connections, (c) => `${String(c.from)}→${String(c.to)}`);
  if (Array.isArray(part.audio)) {
    const cues = (part.audio as unknown[]).map((c, i) => (isObj(c) && !c.id ? { ...c, id: `audio${(raw.audio?.length ?? 0) + i + 1}` } : c));
    raw.audio = mergeById(raw.audio ?? [], cues);
  }
  const removeIds = Array.isArray(p.remove) ? (p.remove as unknown[]).filter((x): x is string => typeof x === "string") : [];
  let removed = 0;
  for (const rid of removeIds) {
    const before = raw.shots.length + raw.assets.length + (raw.audio?.length ?? 0);
    raw.shots = raw.shots.filter((s) => s.id !== rid); raw.assets = raw.assets.filter((s) => s.id !== rid);
    if (raw.audio) raw.audio = raw.audio.filter((s) => s.id !== rid);
    raw.connections = raw.connections.filter((c) => c.from !== rid && c.to !== rid);
    const n = before - (raw.shots.length + raw.assets.length + (raw.audio?.length ?? 0));
    if (!n) errs.push({ path: "part.remove", message: `"part.remove" lists "${rid}", which is not on the board.` });
    removed += n;
  }
  if (raw.audio && !raw.audio.length) delete raw.audio;
  const counts = { shots: Array.isArray(part.shots) ? part.shots.length : 0, assets: Array.isArray(part.assets) ? part.assets.length : 0, audio: Array.isArray(part.audio) ? part.audio.length : 0, connections: Array.isArray(part.connections) ? part.connections.length : 0, removed };
  if (errs.length) return { result: { ok: false, errors: errs, warnings: [] }, counts };
  const r = validateStoryboard(raw, opts);
  if (!r.ok) return { result: { ok: false, errors: r.errors.map((e) => ({ path: e.path && `merged ${namedPath(e.path, raw)}`, message: e.message })), warnings: [] }, counts };
  return { result: r, counts };
}

/** Parse pasted text as a storyboard part (when there is a board to merge into). Undefined when it is not a part. */
export function parseStoryPart(text: string, base: StoryDoc | undefined, opts: StoryValidateOptions = {}): PartResult | undefined {
  if (!base) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(extractJson(text)); } catch { return undefined; }
  return isStoryPart(raw) ? mergeStoryPart(base, raw, opts) : undefined;
}
