/**
 * P78 (Phase 2 step 2.5): runs the scene clip type's WebMCP tools (declared in ./agentDefs.ts). Loaded lazily by the
 * core (`import("./agent")`), so this module may use the domain at runtime without a load cycle (the domain reads the
 * clip type registry). Each edit: read the clip's scene from its version's blob, apply the pure operation
 * (domain/sceneAgent.ts; refused edits change nothing), store the new scene as a blob and make ONE undo step that
 * points the clip at it through the version-save rules (`clipVersion.applyMediaFromClip`, mode new or replace).
 *
 * P79: no version per call. In mode "new" the agent works in an editing session (P80: the editor saves on Save): the first
 * edit of a clip adds a version and later edits of the same clip update that version (one undo step each) until
 * another scene clip is edited, the call passes `newVersion: true`, the clip shows another version (the user picked
 * one, undo, the editor), or SCENE_SESSION_MS pass without an edit. create_scene_clip opens a session on its first
 * version. `apply_scene_edits` runs a list of edits as one undo step and one save. GLB files may come from a URL
 * (`file: { url }`), fetched with the attach_asset_version rules (https, localhost or this site; no credentials).
 */
import {
  activeCameraAt, agentMedia, applySceneEdits, applySceneTool, board, checkScene, clipVersion, draftSceneFromShot, findPlacement, isSceneEditTool, lumaVerdict, mergeSceneDraft,
  newId, newSceneFromInput, ops, parseScene, presetSummary, reviewTimes, SCENE_MIME, SCENE_PALETTES, SCENE_POST_PRESETS, SCENE_PRESETS, sceneCameraDefs, sceneForAgent,
  sceneMediaRef, sceneObjectsForAgent, secondsToTicks, SET_PIECES, setSceneShots, STAGE_SPOTS, ticksToSeconds, TIMES_OF_DAY, timelineReview, validateScene, versionOfPlacement,
  type AssetVersion, type Placement, type Project, type SceneCheck, type SceneDoc, type StageBrief,
} from "../../domain";
import type { ClipAgentApi, ClipAgentResult } from "../types";

const fail = (text: string): ClipAgentResult => ({ ok: false, changed: false, text });

/** P79: how long an agent editing session stays open without an edit. */
export const SCENE_SESSION_MS = 10 * 60_000;
/** P79: the agent's open editing session: edits of this clip update `versionId` while it is the version shown. */
let session: { assetId: string; clipId: string; versionId: string; at: number } | undefined;
/** Tests and a new project: forget the session. */
export function resetSceneAgentSession() { session = undefined; }
export const sceneAgentSession = () => session;

/** P79: the largest GLB the tools fetch from a URL. */
export const MAX_GLB_BYTES = 64 * 1024 * 1024;
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
/**
 * P79: `file: { url, name? }` → `{ name, dataUrl }`: the URL rules of attach_asset_version (https:, http on
 * localhost / 127.0.0.1 / [::1], or this site; data: URLs go in "dataUrl"), fetched without credentials; the bytes must
 * be a binary glTF (.glb). Other inputs pass through.
 */
async function resolveFile(file: unknown): Promise<unknown | { error: string }> {
  if (!file || typeof file !== "object" || Array.isArray(file)) return file;
  const f = file as Record<string, unknown>;
  if (typeof f.url !== "string") return file;
  if (f.dataUrl !== undefined) return { error: '"file": give "url" or "dataUrl", not both.' };
  const ok = agentMedia.checkAgentUrl(f.url, { origin: typeof location !== "undefined" ? location.origin : undefined });
  if (!ok.ok) return { error: `"file.url": ${ok.error}` };
  let name = typeof f.name === "string" && f.name ? f.name : "";
  if (!name) { try { name = decodeURIComponent(new URL(ok.url).pathname.split("/").pop() ?? ""); } catch { name = ""; } }
  if (!/\.(glb|vrm)$/i.test(name)) return { error: `"file": the model needs a .glb (or .vrm) name; give "name" (e.g. "robot.glb")${name ? ` — "${name}" is not one` : ""}.` };
  let res: Response;
  try { res = await fetch(ok.url, { credentials: "omit" }); } catch (e) { return { error: `Couldn't fetch ${ok.url.slice(0, 120)}: ${(e as Error).message || "network error"} (the server must allow this site with CORS).` }; }
  if (!res.ok) return { error: `Couldn't fetch ${ok.url.slice(0, 120)}: HTTP ${res.status}.` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_GLB_BYTES) return { error: `${name} is ${Math.round(bytes.length / 1048576)} MB; the limit is ${MAX_GLB_BYTES / 1048576} MB.` };
  if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "glTF") return { error: `${name} is not a binary glTF (.glb) file.` };
  return { name, dataUrl: bytesToDataUrl(bytes, "model/gltf-binary") };
}
/** Resolve `file.url` in a tool input (and in each edit of a batch). */
async function withFiles(name: string, a: Record<string, unknown>): Promise<Record<string, unknown> | { error: string }> {
  const one = async (x: Record<string, unknown>, where: string) => {
    if (x.file === undefined) return x;
    const f = await resolveFile(x.file);
    if (f && typeof f === "object" && "error" in (f as object)) return { error: `${where}${(f as { error: string }).error}` };
    return { ...x, file: f };
  };
  if (name !== "apply_scene_edits") return one(a, "");
  if (!Array.isArray(a.edits)) return a;
  const edits: unknown[] = [];
  for (let i = 0; i < a.edits.length; i++) {
    const e = a.edits[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) { edits.push(e); continue; }
    const r = await one(e as Record<string, unknown>, `edits[${i}]: `);
    if ("error" in r && typeof r.error === "string" && Object.keys(r).length === 1) return r as { error: string };
    edits.push(r);
  }
  return { ...a, edits };
}
const json = (v: unknown) => JSON.stringify(v, null, 1);

async function blobText(b: Blob): Promise<string> {
  if (typeof b.text === "function") return b.text();
  return new Response(b).text();
}

function findClip(p: Project, id: string): Placement | undefined {
  for (const c of Object.values(p.compositions)) { const f = findPlacement(c, id); if (f) return f.placement; }
  return undefined;
}

async function store(blobs: NonNullable<ClipAgentApi["blobs"]>, assetId: string, doc: SceneDoc): Promise<AssetVersion> {
  const id = newId("ver"), blobKey = `${assetId}/${id}`;
  await blobs.put(blobKey, new Blob([JSON.stringify(doc, null, 2)], { type: SCENE_MIME }));
  return { id, createdAt: new Date().toISOString(), media: sceneMediaRef(blobKey), provenance: { source: "import", inputs: [] } };
}

/** Scene Phase 4: a one-clip project that plays `doc` (stored under a temporary key) from scene time 0. */
function reviewProject(p: Project, pl: Placement, asset: Project["assets"][string], key: string, maxSec: number): Project {
  const root = p.compositions[p.rootCompositionId];
  const main = root.tracks.find((t) => t.placements.some((x) => x.id === pl.id)) ?? ops.mainTrack(root) ?? root.tracks[0];
  const version: AssetVersion = { id: "scene-review", createdAt: "", media: sceneMediaRef(key), provenance: { source: "import", inputs: [] } };
  const clip: Placement = { id: "scene-review", startTicks: 0, durationTicks: Math.max(1, secondsToTicks(maxSec)), sourceInTicks: 0, source: { kind: "assetVersion", assetId: asset.id, versionId: version.id }, clipType: "scene" };
  const tracks = root.tracks.map((t) => ({ ...t, hidden: false, muted: false, placements: t.id === main.id ? [clip] : [] }));
  return { ...p, assets: { ...p.assets, [asset.id]: { ...asset, versions: [...asset.versions, version] } }, compositions: { ...p.compositions, [root.id]: { ...root, tracks, subtitles: [] } } };
}

/** Scene Phase 4: render stills at `times` as a labelled contact sheet (the host draws it) and add brightness checks. */
async function reviewScene(api: ClipAgentApi, p: Project, pl: Placement, asset: Project["assets"][string], doc: SceneDoc, times: number[], checks: SceneCheck[], camera: string | undefined, clipId: string, maxWidth: number): Promise<ClipAgentResult> {
  if (!api.stills) return fail("Rendering stills isn't available here (open the project in the app); check_scene runs the checks without rendering.");
  const view: SceneDoc = camera ? setSceneShots(doc, [{ at: 0, camera }]) : doc;
  const key = `scene-review/${asset.id}/${newId("rev")}`;
  const proj = reviewProject(p, pl, asset, key, Math.max(...times) + 1);
  const cams = times.map((t) => camera ?? activeCameraAt(doc, t));
  const marked = times.map((t) => checks.some((c) => c.level === "warning" && Math.abs(c.at - t) < 1e-6));
  const r = await api.stills(proj, times.map((t) => secondsToTicks(t)), {
    sheetWidth: Math.max(320, Math.min(2048, Math.round(maxWidth))), labels: times.map((t, i) => `${i + 1}. ${t.toFixed(2)}s · ${cams[i]}`), marked,
    extraBlobs: { [key]: new Blob([JSON.stringify(view)], { type: SCENE_MIME }) },
  });
  const all = [...checks];
  r.luma.forEach((l, i) => { const v = l && lumaVerdict(l, times[i], cams[i]); if (v) all.push(v); });
  const warnings = all.filter((c) => c.level === "warning").length;
  return { ok: true, changed: false, ...(r.image ? { image: r.image } : {}), text: json({
    clipId, frames: times.map((t, i) => ({ index: i + 1, at: t, camera: cams[i], ...(r.luma[i] ? { luma: r.luma[i] } : {}) })), problems: all,
    summary: warnings ? `${warnings} problem${warnings === 1 ? "" : "s"} to fix; then review again.` : "No problems found by the checks; look at the sheet for composition and mood.",
  }) };
}

/** Scene Phase 4: draft_scene_from_shot — a first-draft scene for a storyboard shot, merged with the current version. */
async function draftFromShot(a: Record<string, unknown>, api: ClipAgentApi, blobs: NonNullable<ClipAgentApi["blobs"]>): Promise<ClipAgentResult> {
  const p = api.project(), b = p.storyboard;
  if (!b) return fail('No storyboard yet. Create one (create_storyboard) with a shot that has render "scene".');
  const shotId = typeof a.shotId === "string" ? a.shotId : undefined, slotArg = typeof a.slotId === "string" ? a.slotId : undefined;
  if (!shotId && !slotArg) return fail('Give "shotId" (a shot with render "scene") or "slotId" (a scene asset).');
  let shot = shotId ? b.shots[shotId] : undefined;
  if (shotId && !shot) return fail(`No shot "${shotId}". Shots: ${b.order.join(", ")}.`);
  if (shot && shot.render !== "scene") return fail(`Shot "${shotId}" is not a 3D scene shot (render "${shot.render ?? "ai"}"). Set render "scene" with "clip" set to a scene asset first (update_shot).`);
  const slotId = slotArg ?? shot?.clipSlot;
  const slot = slotId ? b.slots[slotId] : undefined;
  if (!slot || slot.type !== "scene") return fail(slotArg ? `"${slotArg}" is not a scene asset.` : `Shot "${shotId}" has no scene asset ("clip"); give it one first.`);
  shot ??= b.order.map((id) => b.shots[id]).find((x) => x?.clipSlot === slot.id);
  if (a.brief !== undefined && (!a.brief || typeof a.brief !== "object" || Array.isArray(a.brief))) return fail('"brief" must be a stage_scene brief object.');
  if (a.blocking !== undefined && typeof a.blocking !== "string") return fail('"blocking" must be text.');
  const input = board.sceneDraftInput(p, slot.id, shot?.id);
  const draft = draftSceneFromShot(input, { ...(a.brief ? { brief: a.brief as StageBrief } : {}), ...(typeof a.blocking === "string" ? { blocking: a.blocking } : {}) });
  // The current version (if any) wins wherever ids match.
  let prev: SceneDoc | undefined;
  const sel = slot.assetId ? p.assets[slot.assetId] : undefined, v = sel?.versions.find((x) => x.id === sel.selectedVersionId);
  if (v && a.fresh !== true) {
    const blob = await blobs.get(v.media.blobKey);
    if (blob) prev = parseScene(await blobText(blob)).doc;
  }
  const merged = prev ? mergeSceneDraft(prev, draft.doc) : { doc: draft.doc, kept: [] as string[], added: draft.doc.objects.map((o) => o.id) };
  const errors = validateScene(merged.doc).filter((i) => i.level === "error");
  if (errors.length) return fail(`The draft would not be valid: ${errors.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join(" ")}`);
  const versionId = newId("ver"), key = `${slot.assetId ?? newId("ast")}/${versionId}`;
  await blobs.put(key, new Blob([JSON.stringify(merged.doc, null, 2)], { type: SCENE_MIME }));
  const changed = api.edit(prev ? "AI: regenerate scene draft" : "AI: draft scene", (q) => board.addStoryVersion(q, { slot: slot.id }, sceneMediaRef(key), { versionId }));
  if (!changed) return fail("The draft could not be stored.");
  return { ok: true, changed, text: json({
    slotId: slot.id, ...(shot ? { shotId: shot.id } : {}), versionId, merged: !!prev, kept: merged.kept, added: merged.added,
    objects: merged.doc.objects.length, events: merged.doc.events?.length ?? 0, brief: draft.brief, blocking: draft.blocking,
    ...(draft.skipped.length ? { skipped: draft.skipped } : {}), ...(draft.notes.length ? { notes: draft.notes } : {}),
    next: "Send the storyboard to the timeline (or update it) to get the scene clip, then review_scene it and fix what it reports.",
  }) };
}

export async function runSceneTool(name: string, a: Record<string, unknown>, api: ClipAgentApi): Promise<ClipAgentResult> {
  const blobs = api.blobs;
  if (!blobs) return fail("Scene tools need the project's media store (open the project in the app).");
  if (a.mode !== undefined && a.mode !== "new" && a.mode !== "replace") return fail('"mode" must be "new" or "replace".');

  if (name === "create_scene_clip") {
    if (a.durationSec !== undefined && !(typeof a.durationSec === "number" && a.durationSec > 0)) return fail('"durationSec" must be seconds > 0.');
    if (a.atSec !== undefined && !(typeof a.atSec === "number" && a.atSec >= 0)) return fail('"atSec" must be seconds ≥ 0.');
    const made = newSceneFromInput(a.scene, a.durationSec as number | undefined);
    if ("error" in made) return fail(made.error);
    const doc = made.doc;
    const assetId = newId("ast");
    const version = await store(blobs, assetId, doc);
    const p0 = api.project();
    const root = p0.compositions[p0.rootCompositionId];
    const main = ops.mainTrack(root);
    if (!main) return fail("The timeline has no main track.");
    const end = main.placements.reduce((m, x) => Math.max(m, x.startTicks + x.durationTicks), 0);
    const durSec = (a.durationSec as number | undefined) ?? doc.durationSec ?? 5;
    const pl: Placement = {
      id: newId("plc"), startTicks: typeof a.atSec === "number" ? secondsToTicks(a.atSec) : end, durationTicks: Math.max(1, secondsToTicks(durSec)),
      sourceInTicks: 0, source: { kind: "assetVersion", assetId, versionId: version.id }, clipType: "scene",
    };
    const name0 = typeof a.name === "string" && a.name ? a.name : doc.name || "3D scene";
    const changed = api.edit("Add 3D scene", (p) => {
      const withAsset: Project = { ...p, assets: { ...p.assets, [assetId]: { id: assetId, kind: "scene", name: name0, selectedVersionId: version.id, versions: [version] } } };
      const id = withAsset.rootCompositionId;
      return { ...withAsset, compositions: { ...withAsset.compositions, [id]: ops.insertPlacement(withAsset.compositions[id], main.id, pl) } };
    });
    if (!changed) return fail("The clip could not be added.");
    const p = api.project(), placed = findClip(p, pl.id)!;
    // P79: the agent's next edits of this clip update this first version (mode "new"), not one version per call.
    session = clipVersion.versionSaveModeOf(p) === "new" ? { assetId, clipId: pl.id, versionId: version.id, at: Date.now() } : undefined;
    return { ok: true, changed, text: json({ clip: timelineReview.clipJson(p, placed), assetId, objects: doc.objects.length, events: doc.events?.length ?? 0, ...(made.warnings.length ? { warnings: made.warnings } : {}) }) };
  }

  // Scene Phase 4 (#353): presets need no clip; drafting works on the storyboard.
  if (name === "list_scene_presets") {
    const full = a.full !== false;
    return { ok: true, changed: false, text: json({
      presets: SCENE_PRESETS.map((x) => (full ? x : presetSummary(x))), setPieces: Object.keys(SET_PIECES), spots: STAGE_SPOTS, timesOfDay: TIMES_OF_DAY, palettes: SCENE_PALETTES, post: SCENE_POST_PRESETS,
    }) };
  }
  if (name === "draft_scene_from_shot") return draftFromShot(a, api, blobs);

  const clipId = typeof a.clipId === "string" ? a.clipId : "";
  const p = api.project();
  const pl = clipId ? findClip(p, clipId) : undefined;
  if (!pl) return fail(`No clip "${clipId}". Call get_timeline for clip ids (3D scene clips have type "scene"), or create_scene_clip.`);
  if (pl.clipType !== "scene") return fail(`Clip ${clipId} is a ${pl.clipType} clip; scene tools work on 3D scene clips (type "scene").`);
  const version = versionOfPlacement(p, pl), asset = p.assets[pl.source.assetId];
  if (!version || !asset) return fail(`Clip ${clipId} has no scene version.`);
  const blob = await blobs.get(version.media.blobKey);
  if (!blob) return fail(`The scene file of clip ${clipId} is missing.`);
  const parsed = parseScene(await blobText(blob));
  if (!parsed.doc) return fail(`The scene of clip ${clipId} can't be read: ${parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(" ")}`);
  const doc = parsed.doc;
  const n = asset.versions.findIndex((v) => v.id === version.id) + 1;
  const versionInfo = { id: version.id, number: n, of: asset.versions.length };

  if (name === "get_scene") {
    return { ok: true, changed: false, text: json({ clipId, assetId: asset.id, version: versionInfo, clipSec: { start: ticksToSeconds(pl.startTicks), length: ticksToSeconds(pl.durationTicks), sceneFrom: ticksToSeconds(pl.sourceInTicks) }, scene: sceneForAgent(doc), problems: validateScene(doc) }) };
  }
  if (name === "list_scene_objects") return { ok: true, changed: false, text: json({ clipId, version: versionInfo, ...sceneObjectsForAgent(doc) }) };
  if (name === "check_scene" || name === "review_scene") {
    const camera = typeof a.camera === "string" && a.camera ? a.camera : undefined;
    if (camera && !sceneCameraDefs(doc).some((c) => c.id === camera)) return fail(`No camera "${camera}". Cameras: ${sceneCameraDefs(doc).map((c) => c.id).join(", ")}.`);
    if (a.times !== undefined && !(Array.isArray(a.times) && a.times.every((t) => typeof t === "number" && Number.isFinite(t) && t >= 0))) return fail('"times" must be a list of scene seconds ≥ 0.');
    const count = typeof a.count === "number" ? Math.max(1, Math.min(24, Math.round(a.count))) : 6;
    const times = (Array.isArray(a.times) && a.times.length ? (a.times as number[]) : reviewTimes(doc, count)).slice(0, name === "review_scene" ? 24 : 72);
    const checks = checkScene(doc, { times, aspect: p.settings.width / p.settings.height, camera });
    if (name === "check_scene") return { ok: true, changed: false, text: json({ clipId, times, problems: checks, ...(checks.length ? {} : { note: "No problems found at these times." }) }) };
    return reviewScene(api, p, pl, asset, doc, times, checks, camera, clipId, typeof a.maxWidth === "number" ? a.maxWidth : 1280);
  }
  if (!isSceneEditTool(name) && name !== "apply_scene_edits") return fail(`Unknown tool ${name}.`);
  if (a.newVersion !== undefined && typeof a.newVersion !== "boolean") return fail('"newVersion" must be true or false.');

  const input = await withFiles(name, a);
  if ("error" in input && typeof input.error === "string" && Object.keys(input).length === 1) return fail(input.error);
  let r: { ok: true; doc: SceneDoc; info: Record<string, unknown>; warnings: string[] } | { ok: false; error: string };
  if (name === "apply_scene_edits") {
    const b = applySceneEdits(doc, (input as Record<string, unknown>).edits);
    r = b.ok ? { ok: true, doc: b.doc, info: { edits: b.results.length, results: b.results }, warnings: b.warnings } : b;
  } else r = applySceneTool(name as Parameters<typeof applySceneTool>[0], doc, input as Record<string, unknown>);
  if (!r.ok) return fail(r.error);
  if (r.doc === doc) return { ok: true, changed: false, text: json({ clipId, ...r.info, unchanged: true, version: versionInfo }) };
  const mode = (a.mode as clipVersion.VersionSaveMode | undefined) ?? clipVersion.versionSaveModeOf(p);
  const now = Date.now();
  // P79: in mode "new", later edits of the session's clip update the session's version (see the header).
  const s0 = session;
  const coalesce = mode === "new" && a.newVersion !== true && !!s0 && s0.assetId === asset.id && s0.clipId === clipId && s0.versionId === version.id && now - s0.at <= SCENE_SESSION_MS;
  const next = await store(blobs, asset.id, r.doc);
  const opts = coalesce ? { mode: "replace" as const, remember: false } : { mode, versionId: next.id, seed: next, remember: a.mode !== undefined };
  const check = clipVersion.applyMediaFromClip(api.project(), clipId, next.media, opts);
  if (!check.ok) return fail(check.error);
  const changed = api.edit(`Scene: ${name}`, (q) => {
    const res = clipVersion.applyMediaFromClip(q, clipId, next.media, opts);
    if (!res.ok) throw new Error(res.error);
    return res.project;
  });
  if (!changed) return fail("The edit could not be saved.");
  const after = api.project(), a2 = after.assets[asset.id], shown = versionOfPlacement(after, findClip(after, clipId)!);
  session = mode === "new" && shown ? { assetId: asset.id, clipId, versionId: shown.id, at: now } : undefined;
  const saved = coalesce ? "updated this session's version" : mode === "new" ? "new version" : "replaced the shown version";
  const info = { id: shown?.id, number: a2.versions.findIndex((v) => v.id === shown?.id) + 1, of: a2.versions.length, mode, saved };
  return { ok: true, changed, text: json({ clipId, ...r.info, ...(r.warnings.length ? { warnings: r.warnings } : {}), version: info }) };
}
