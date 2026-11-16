/**
 * P78 (Phase 2 step 2.5): runs the scene clip type's WebMCP tools (declared in ./agentDefs.ts). Loaded lazily by the
 * core (`import("./agent")`), so this module may use the domain at runtime without a load cycle (the domain reads the
 * clip type registry). Each edit: read the clip's scene from its version's blob, apply the pure operation
 * (domain/sceneAgent.ts; refused edits change nothing), store the new scene as a blob and make ONE undo step that
 * points the clip at it through the version-save rules (`clipVersion.applyMediaFromClip`, mode new or replace).
 */
import {
  applySceneTool, clipVersion, findPlacement, isSceneEditTool, newId, newSceneFromInput, ops, parseScene, SCENE_MIME, sceneForAgent,
  sceneMediaRef, sceneObjectsForAgent, secondsToTicks, ticksToSeconds, timelineReview, validateScene, versionOfPlacement, type AssetVersion, type Placement,
  type Project, type SceneDoc,
} from "../../domain";
import type { ClipAgentApi, ClipAgentResult } from "../types";

const fail = (text: string): ClipAgentResult => ({ ok: false, changed: false, text });
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
  if (!isSceneEditTool(name)) return fail(`Unknown tool ${name}.`);

  const r = applySceneTool(name, doc, a);
  if (!r.ok) return fail(r.error);
  if (r.doc === doc) return { ok: true, changed: false, text: json({ clipId, ...r.info, unchanged: true, version: versionInfo }) };
  const mode = (a.mode as clipVersion.VersionSaveMode | undefined) ?? clipVersion.versionSaveModeOf(p);
  const next = await store(blobs, asset.id, r.doc);
  const opts = { mode, versionId: next.id, seed: next, remember: a.mode !== undefined };
  const check = clipVersion.applyMediaFromClip(api.project(), clipId, next.media, opts);
  if (!check.ok) return fail(check.error);
  const changed = api.edit(`Scene: ${name}`, (q) => {
    const res = clipVersion.applyMediaFromClip(q, clipId, next.media, opts);
    if (!res.ok) throw new Error(res.error);
    return res.project;
  });
  if (!changed) return fail("The edit could not be saved.");
  const after = api.project(), a2 = after.assets[asset.id], shown = versionOfPlacement(after, findClip(after, clipId)!);
  const info = { id: shown?.id, number: a2.versions.findIndex((v) => v.id === shown?.id) + 1, of: a2.versions.length, mode };
  return { ok: true, changed, text: json({ clipId, ...r.info, ...(r.warnings.length ? { warnings: r.warnings } : {}), version: info }) };
}
