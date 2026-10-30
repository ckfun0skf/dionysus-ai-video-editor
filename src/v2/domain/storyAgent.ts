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
  prompt: str("Clip generation prompt (required for render ai)."), assets: arr(str("Asset id."), "Assets that appear."), qa: arr(str("A check."), "QA checks."),
  render: en(SHOT_RENDERS, 'How the shot is made (default "ai").'), clip: str("html asset (render html) or image asset (render still)."),
  layers: arr(LAYER, "Layers on top."), references: arr(REFERENCE, "Images to attach, in order."), background: BACKGROUND,
}, ["id", "title", "durationSec"], "A storyboard shot (see the guide's FORMAT section for every field).");
const CUE = obj({
  id: id('Cue id (default "audio<n>").'), asset: str("Audio asset id."), kind: en(AUDIO_KINDS, "Cue kind."), from: str("Shot id the cue starts at."), to: str("Shot id it ends at (inclusive)."),
  atSec: num("Offset into the from shot."), volume: num("0-2, 1 = as recorded."),
}, ["asset", "kind", "from"], "An audio cue on the storyboard.");
const CONNECTION = obj({ from: str("Shot id."), to: str("The next shot id."), kind: en(CONNECTION_KINDS, "How the shots join."), note: str("Why."), transition: { description: 'A transition preset { "preset", "durationSec"? }; null removes it.' } }, ["from", "to"]);

// ---------------------------------------------------------------------------------------------------------------
// Tools

export interface ToolCtx {
  /** The guide markdown served by get_guide (built by the caller from aiGuide, which imports this module). */
  guide: () => string;
}
/** A finished call: text for the agent, plus the new doc for mutating tools (apply as one undo step labelled `label`). */
export interface ToolResult { ok: boolean; text: string; doc?: StoryDoc; label?: string; send?: boolean }
type Edit = (raw: Raw, args: Obj) => string | { label: string; message: string };

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
        const cues = (raw.audio ?? []).map((c) => `${c.id} · ${c.kind} ${c.asset} ${c.from}${c.to ? `→${c.to}` : ""}`).join("\n");
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
    description: 'Change storyboard "meta" fields (title, aspect, style, fps, textStyles, …).',
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
    description: "Change fields of a shot (title, description, durationSec, prompt, assets, references, dialogue, camera, qa, keyframe, render, clip, effects, …).",
    inputSchema: obj({ id: str("Shot id."), patch: patch("shot") }, ["id", "patch"]),
    edit: (raw, a) => shotEdit(raw, a, (s) => applyPatch(s, a.patch), (s) => `AI: edit shot ${String(s.id)}`),
  },
  {
    name: "remove_shot", title: "Remove a shot", readOnly: false,
    description: "Remove a shot and its connections. Rejected while a cue, last-frame link or other shot still needs it; change those first.",
    inputSchema: obj({ id: str("Shot id.") }, ["id"]),
    edit: (raw, a) => {
      const i = findIdx(raw.shots, a.id); if (i < 0) return `No shot "${String(a.id)}".`;
      raw.shots.splice(i, 1); raw.connections = raw.connections.filter((c) => c.from !== a.id && c.to !== a.id);
      return { label: `AI: remove shot ${String(a.id)}`, message: `Shot "${String(a.id)}" removed.` };
    },
  },
  {
    name: "set_shot_layers", title: "Set a shot's layers", readOnly: false,
    description: "Replace all layers of a shot (text, html, image, video), drawn in order on top. [] removes them.",
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
    description: 'Add an audio cue (voiceover, music, sfx, ambience, sting, dialogue) that plays from a shot. Gets "audio<n>" as id when you give none.',
    inputSchema: obj({ cue: CUE }, ["cue"]),
    edit: (raw, a) => {
      if (!isObj(a.cue)) return '"cue" must be an object.'; const c = clone(a.cue); c.id ??= nextCueId(raw);
      if (findIdx(raw.audio, c.id) >= 0) return `Cue "${String(c.id)}" already exists; use update_cue.`;
      raw.audio = [...(raw.audio ?? []), c]; return { label: `AI: add cue ${String(c.id)}`, message: `Cue "${String(c.id)}" added.` };
    },
  },
  {
    name: "update_cue", title: "Change an audio cue", readOnly: false,
    description: "Change fields of an audio cue (from, to, atSec, volume, fades, loop, volumeKeys, fx, …).",
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
    name: "validate", title: "Check the storyboard", readOnly: true,
    description: "Run the importer's checks on the current storyboard and list its warnings (edits are already checked; this reports what is left to improve).",
    inputSchema: obj({}),
    read: (raw) => {
      if (!raw) return { ok: false, text: "No storyboard yet." };
      const r = validateStoryboard(raw);
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
    description: "Update the timeline from the storyboard (update mode): adds shots that have a clip and new audio cues, switches changed clips and refreshes shot text; everything else on the timeline stays. Shots without an uploaded clip are skipped.",
    inputSchema: obj({}),
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
  if (name === "send_to_timeline") return doc ? { ok: true, text: "Sending.", send: true, label: "AI: update timeline" } : { ok: false, text: "No storyboard yet." };
  if (!raw && !tool.creates) return { ok: false, text: "No storyboard yet. Create one with create_storyboard first." };
  const work: Raw = raw ?? { format: STORYBOARD_FORMAT, meta: {}, assets: [], shots: [], connections: [] };
  let out: ReturnType<Edit>;
  try { out = tool.edit!(work, a); } catch (e) { out = `Bad arguments: ${(e as Error).message}`; }
  if (typeof out === "string") return { ok: false, text: `Rejected, nothing changed: ${out}` };
  const r = validateStoryboard(work);
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
export function mergeStoryPart(base: StoryDoc, part: Obj): PartResult {
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
  const r = validateStoryboard(raw);
  if (!r.ok) return { result: { ok: false, errors: r.errors.map((e) => ({ path: e.path && `merged ${namedPath(e.path, raw)}`, message: e.message })), warnings: [] }, counts };
  return { result: r, counts };
}

/** Parse pasted text as a storyboard part (when there is a board to merge into). Undefined when it is not a part. */
export function parseStoryPart(text: string, base: StoryDoc | undefined): PartResult | undefined {
  if (!base) return undefined;
  let raw: unknown;
  try { raw = JSON.parse(extractJson(text)); } catch { return undefined; }
  return isStoryPart(raw) ? mergeStoryPart(base, raw) : undefined;
}
