/**
 * P78 (Phase 2 step 2.5): runs the scene clip type's WebMCP tools (declared in ./agentDefs.ts). Loaded lazily by the
 * core (`import("./agent")`), so this module may use the domain at runtime without a load cycle (the domain reads the
 * clip type registry). Each edit: read the clip's scene from its version's blob, apply the pure operation
 * (domain/sceneAgent.ts; refused edits change nothing), store the new scene as a blob and make ONE undo step that
 * points the clip at it through the version-save rules (`clipVersion.applyMediaFromClip`, mode new or replace).
 *
 * P79: no version per call. In mode "new" the agent works in an editing session like the scene editor's: the first
 * edit of a clip adds a version and later edits of the same clip update that version (one undo step each) until
 * another scene clip is edited, the call passes `newVersion: true`, the clip shows another version (the user picked
 * one, undo, the editor), or SCENE_SESSION_MS pass without an edit. create_scene_clip opens a session on its first
 * version. `apply_scene_edits` runs a list of edits as one undo step and one save. GLB files may come from a URL
 * (`file: { url }`), fetched with the attach_asset_version rules (https, localhost or this site; no credentials).
 */
import {
  agentMedia, applySceneEdits, applySceneTool, clipVersion, findPlacement, isSceneEditTool, newId, newSceneFromInput, ops, parseScene, SCENE_MIME, sceneForAgent,
  sceneMediaRef, sceneObjectsForAgent, secondsToTicks, ticksToSeconds, timelineReview, validateScene, versionOfPlacement, type AssetVersion, type Placement,
  type Project, type SceneDoc,
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
  if (!/\.glb$/i.test(name)) return { error: `"file": the model needs a .glb name; give "name" (e.g. "robot.glb")${name ? ` — "${name}" is not one` : ""}.` };
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
