/**
 * P88 (Phase 3 step 3.6): runs the plugin host's generic WebMCP tools (declared in clipTypes/pluginAgentDefs.ts):
 * list_clip_plugins, add_plugin_clip, set_plugin_clip_params and request_plugin_install. Values are checked against
 * the plugin's manifest by the host (domain/pluginAgent.ts) and each edit is one undo step. Plugin-written text is
 * only ever returned fenced in `<plugin-text>` blocks. request_plugin_install never installs: it asks the open plugin
 * screens (usePluginCenter registers itself here) to show their dialog, where the user decides.
 */
import {
  agentMedia, applyPluginParamPatch, newId, ops, checkPluginParams, findPlacement, pluginParamJson, pluginTextBlock, PLUGIN_AGENT_TEXT, PLUGIN_TEXT_NOTE, secondsToTicks,
  timelineReview, type Project,
} from "../../domain";
import { cmd, type Engine } from "../../engine";
import { isPluginEnabled, pluginMetaOf } from "../../clipTypes";
import { pluginRows, refreshPluginLibrary, type LibraryItem, type PluginRow } from "../pluginManager";

export interface PluginToolResult { ok: boolean; changed: boolean; text: string }
const fail = (text: string): PluginToolResult => ({ ok: false, changed: false, text });
const json = (v: unknown) => JSON.stringify(v, null, 1);

/** What the plugin screens did with an agent's install request. */
export type PluginInstallAnswer = "opened" | "busy" | "enabled" | "unknown";
export type PluginInstallRequest = { url: string } | { type: string };
let requester: ((req: PluginInstallRequest) => PluginInstallAnswer) | undefined;
/** usePluginCenter registers its dialog opener while it is mounted (returns the unregister function). */
export function setPluginInstallRequester(fn: (req: PluginInstallRequest) => PluginInstallAnswer): () => void {
  requester = fn;
  return () => { if (requester === fn) requester = undefined; };
}

/** The device library for the tools: the cached list, refreshed (never throws). */
const library = async (): Promise<LibraryItem[]> => refreshPluginLibrary().catch(() => []);

function pluginEntry(row: PluginRow, lib: readonly LibraryItem[]) {
  const meta = row.inProject ? pluginMetaOf(row.id) : undefined;
  const manifest = meta?.manifest ?? lib.find((e) => e.hash === row.hash)?.manifest;
  const decls = meta?.params ?? manifest?.params ?? {};
  return {
    json: {
      type: row.id, version: row.version, state: row.state, inProject: row.inProject, clips: row.clips, durationSec: row.durationSec,
      ...(row.update ? { update: row.update.version } : {}),
      ...(row.message ? { problem: row.message.slice(0, 200) } : {}),
      params: Object.entries(decls).map(([k, d]) => pluginParamJson(k, d)),
    },
    text: manifest ? pluginTextBlock(row.id, manifest) : undefined,
  };
}

async function listPlugins(project: Project, a: Record<string, unknown>): Promise<PluginToolResult> {
  const lib = await library();
  let rows = pluginRows(project, lib);
  if (typeof a.type === "string") {
    rows = rows.filter((r) => r.id === a.type);
    if (!rows.length) return fail(`No plugin "${String(a.type).slice(0, 80)}" in this project or on this device. Call list_clip_plugins without "type" to see them.`);
  }
  const shown = rows.slice(0, PLUGIN_AGENT_TEXT.plugins), entries = shown.map((r) => pluginEntry(r, lib));
  const out = { plugins: entries.map((e) => e.json), ...(rows.length > shown.length ? { more: rows.length - shown.length } : {}) };
  const texts = entries.map((e) => e.text).filter(Boolean);
  const hint = rows.length ? "" : "\nNo plugins yet. The user adds them in Plugins (Add plugin); you can open that dialog with request_plugin_install.";
  return { ok: true, changed: false, text: `${json(out)}${hint}${texts.length ? `\n\n${PLUGIN_TEXT_NOTE}\n${texts.join("\n")}` : ""}` };
}

const MAX_SEC = 600;

function addClip(engine: Engine, a: Record<string, unknown>): PluginToolResult {
  const type = typeof a.type === "string" ? a.type : "";
  if (!type) return fail('"type" is required: a plugin type ("x-…") from list_clip_plugins.');
  const meta = pluginMetaOf(type);
  if (!meta || !/^x-/.test(type)) return fail(`Plugin "${type.slice(0, 80)}" isn't loaded in this project. Call list_clip_plugins; a plugin with state device or review needs the user: request_plugin_install({ type }).`);
  if (!isPluginEnabled(type)) return fail(`Plugin "${type}" is in this project but not allowed on this device yet. Ask the user with request_plugin_install({ type: "${type}" }); they decide in the dialog.`);
  const atSec = a.atSec === undefined ? 0 : a.atSec, dur = a.durationSec === undefined ? meta.durationSec : a.durationSec;
  if (typeof atSec !== "number" || !Number.isFinite(atSec) || atSec < 0) return fail('"atSec" must be a number ≥ 0.');
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur < 0.1 || dur > MAX_SEC) return fail(`"durationSec" must be a number from 0.1 to ${MAX_SEC}.`);
  const track = a.track === undefined ? "overlay" : a.track;
  if (typeof track !== "string" || !track) return fail('"track" must be "overlay", "main" or a video track id.');
  const project = engine.getState().project, root = project.compositions[project.rootCompositionId];
  let where: "main" | "overlay" | { trackId: string };
  if (track === "main" || track === "overlay") where = track;
  else {
    const t = root.tracks.find((x) => x.id === track);
    if (!t) return fail(`No track "${track.slice(0, 80)}". Use "overlay", "main" or a video track id from get_timeline.`);
    if (t.kind !== "video") return fail(`Track ${track} is a ${t.kind} track; plugin clips go on video tracks.`);
    const start = secondsToTicks(atSec), end = start + secondsToTicks(dur);
    if (t.id !== ops.mainTrack(root)?.id && !t.placements.every((o) => o.startTicks >= end || o.startTicks + o.durationTicks <= start)) return fail(`Track ${track} already has a clip between ${atSec} and ${atSec + dur} s; pick another time, another track or "overlay".`);
    where = { trackId: track };
  }
  const checked = checkPluginParams(meta.params, a.params, false);
  if (!checked.ok) return fail(`Nothing was added. ${checked.errors.join(" ")}`);
  const id = newId("plc");
  const steps = [cmd.addPluginClip(secondsToTicks(atSec), type as `x-${string}`, meta.version, secondsToTicks(dur), where, id)];
  const patch = applyPluginParamPatch({}, checked.patch);
  if (Object.keys(patch).length) steps.push(cmd.setPluginParams(id, patch, meta.version));
  if (!engine.dispatch(steps, `Add “${meta.name}” clip`)) return fail("The clip couldn't be added there.");
  const p = engine.getState().project, hit = findPlacement(p.compositions[p.rootCompositionId], id);
  if (!hit) return fail("The clip couldn't be added there.");
  return { ok: true, changed: true, text: json(timelineReview.clipJson(p, hit.placement)) };
}

function setParams(engine: Engine, a: Record<string, unknown>): PluginToolResult {
  const clipId = typeof a.clipId === "string" ? a.clipId : "";
  if (!clipId) return fail('"clipId" is required.');
  if (a.params === undefined && a.reset !== true) return fail('Give "params" and/or reset: true.');
  if (a.reset !== undefined && typeof a.reset !== "boolean") return fail('"reset" must be true or false.');
  const project = engine.getState().project;
  const hit = Object.values(project.compositions).map((c) => findPlacement(c, clipId)).find(Boolean);
  if (!hit) return fail(`No clip "${clipId.slice(0, 80)}".`);
  const pl = hit.placement;
  if (!/^x-/.test(pl.clipType)) return fail(`Clip ${clipId} is a ${pl.clipType} clip, not a plugin clip.`);
  const meta = pluginMetaOf(pl.clipType);
  if (!meta) return fail(`The plugin of clip ${clipId} ("${pl.clipType}") isn't loaded, so its settings can't be checked. See list_clip_plugins.`);
  const checked = checkPluginParams(meta.params, a.params);
  if (!checked.ok) return fail(`Nothing was changed. ${checked.errors.join(" ")}`);
  const next = applyPluginParamPatch(a.reset ? {} : pl.plugin?.data?.params ?? {}, checked.patch);
  const same = JSON.stringify(next) === JSON.stringify(pl.plugin?.data?.params ?? {}) && pl.plugin?.v === meta.version;
  const changed = !same && engine.dispatch([cmd.setPluginParams(clipId, undefined, meta.version), cmd.setPluginParams(clipId, next, meta.version)], `Change “${meta.name}” settings`);
  const p = engine.getState().project, after = Object.values(p.compositions).map((c) => findPlacement(c, clipId)).find(Boolean);
  const described = after ? timelineReview.clipJson(p, after.placement) : {};
  return { ok: true, changed, text: json({ clipId, params: described.params, stored: after?.placement.plugin?.data?.params ?? {} }) };
}

async function requestInstall(project: Project, a: Record<string, unknown>): Promise<PluginToolResult> {
  const hasUrl = a.url !== undefined, hasType = a.type !== undefined;
  if (hasUrl === hasType) return fail('Give exactly one of "url" (a plugin package address) or "type" (a plugin listed with state device or review).');
  let req: PluginInstallRequest;
  if (hasUrl) {
    if (typeof a.url !== "string") return fail('"url" must be a string.');
    const ok = agentMedia.checkAgentUrl(a.url.trim(), { origin: typeof location !== "undefined" ? location.origin : undefined });
    if (!ok.ok) return fail(`"url": ${ok.error}`);
    req = { url: ok.url };
  } else {
    if (typeof a.type !== "string") return fail('"type" must be a string.');
    const row = pluginRows(project, await library()).find((r) => r.id === a.type);
    if (!row) return fail(`No plugin "${a.type.slice(0, 80)}" in this project or on this device; give its package "url" instead.`);
    if (row.state === "enabled") return { ok: true, changed: false, text: `"${row.id}" is already enabled in this project; add clips with add_plugin_clip.` };
    if (row.state !== "device" && row.state !== "review") return fail(`"${row.id}" can't be loaded (${row.state}${row.message ? `: ${row.message.slice(0, 200)}` : ""}); the user needs its package: request_plugin_install({ url }).`);
    req = { type: row.id };
  }
  if (!requester) return fail("The plugin dialog isn't available in this view of the editor; ask the user to open Plugins → Add plugin.");
  const answer = requester(req);
  if (answer === "busy") return fail("A plugin dialog is busy right now; try again when the user has finished it.");
  if (answer === "enabled") return { ok: true, changed: false, text: "That plugin is already enabled in this project; add clips with add_plugin_clip." };
  if (answer === "unknown") return fail("That plugin isn't on this device any more; give its package url.");
  return { ok: true, changed: false, text: "The plugin dialog is open for the user. Nothing is installed or allowed until they read it and confirm; they may cancel. Call list_clip_plugins later: the plugin's state is enabled once they agreed." };
}

/** Runs one of the plugin host tools; undefined when `name` isn't one. */
export async function runPluginTool(engine: Engine, name: string, a: Record<string, unknown>): Promise<PluginToolResult | undefined> {
  switch (name) {
    case "list_clip_plugins": return listPlugins(engine.getState().project, a);
    case "add_plugin_clip": return addClip(engine, a);
    case "set_plugin_clip_params": return setParams(engine, a);
    case "request_plugin_install": return requestInstall(engine.getState().project, a);
    default: return undefined;
  }
}
