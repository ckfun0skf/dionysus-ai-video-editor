import { board, draftSceneFromShot, mergeSceneDraft, newId, newSceneFromInput, parseScene, SCENE_MIME, sceneMediaRef, type Asset, type AssetVersion, type MediaRef, type Project, type SceneDoc } from "../domain";

type BlobPut = { put(key: string, blob: Blob): Promise<void> };

/** P74: a `scene` asset whose first version is the given `dionysus.scene/1` document (stored as a JSON blob). */
export async function sceneAsset(blobs: BlobPut, doc: SceneDoc, name = doc.name || "3D scene"): Promise<Asset> {
  const id = newId("ast"), versionId = newId("ver"), blobKey = `${id}/${versionId}`;
  await blobs.put(blobKey, new Blob([JSON.stringify(doc, null, 2)], { type: SCENE_MIME }));
  return { id, kind: "scene", name, selectedVersionId: versionId, versions: [{ id: versionId, createdAt: new Date().toISOString(), media: sceneMedia(blobKey), provenance: { source: "import", inputs: [] } }] };
}

/** A scene version's media: the JSON blob at 1920×1080. No `durationTicks`: a scene's length is free (like a code clip's). */
export const sceneMedia = sceneMediaRef;

/** P75: store a changed scene document as a new version of `asset` (the caller dispatches `cmd.addAssetVersion`). */
export async function sceneVersion(blobs: BlobPut, asset: Asset, doc: SceneDoc): Promise<AssetVersion> {
  const id = newId("ver"), blobKey = `${asset.id}/${id}`;
  await blobs.put(blobKey, new Blob([JSON.stringify(doc, null, 2)], { type: SCENE_MIME }));
  rememberSceneDoc(blobKey, doc);
  return { id, createdAt: new Date().toISOString(), media: sceneMedia(blobKey), provenance: { source: "import", inputs: [] } };
}

/**
 * P76: scenes the editor has read or written, by blob key (the newest 24), so a stored edit, an undo or a redo shows
 * at once without reading the blob again. Blobs under a key never change, so a cached scene is never stale.
 */
const docs = new Map<string, SceneDoc>();
export function rememberSceneDoc(blobKey: string, doc: SceneDoc) {
  docs.delete(blobKey); docs.set(blobKey, doc);
  while (docs.size > 24) docs.delete(docs.keys().next().value as string);
}
export const cachedSceneDoc = (blobKey: string | undefined): SceneDoc | undefined => (blobKey ? docs.get(blobKey) : undefined);

/**
 * P79: read a dionysus.scene/1 scene from JSON text or an object (storyboard uploads, attach_asset_version, inline
 * storyboard scenes): the format is filled in when missing; an invalid scene is refused with its problems.
 */
export function readSceneInput(input: unknown): { doc: SceneDoc; warnings: string[] } | { error: string } {
  const r = newSceneFromInput(input);
  return "error" in r ? { error: r.error } : { doc: r.doc, warnings: r.warnings };
}

/** P79: store a scene as a new blob (key `<owner>/<version id>`) and return its media; the caller adds the version. */
export async function storeSceneMedia(blobs: BlobPut, doc: SceneDoc, owner = newId("ast"), versionId = newId("ver")): Promise<MediaRef> {
  const blobKey = `${owner}/${versionId}`;
  await blobs.put(blobKey, new Blob([JSON.stringify(doc, null, 2)], { type: SCENE_MIME }));
  rememberSceneDoc(blobKey, doc);
  return sceneMedia(blobKey);
}

/**
 * Scene Phase 4 (#353): a first-draft scene for scene slot `slotId` from its shot's prompt and references
 * (domain/sceneStage.ts draftSceneFromShot), merged with the slot's current version (the user's edits win where ids
 * match) unless `fresh`; stored as a blob. The caller adds the version (cmd.addStoryVersion).
 */
export async function draftShotScene(p: Project, blobs: BlobPut & { get(key: string): Promise<Blob | undefined> }, slotId: string, shotId?: string, fresh = false) {
  const input = board.sceneDraftInput(p, slotId, shotId);
  const draft = draftSceneFromShot(input);
  const slot = p.storyboard?.slots[slotId];
  const asset = slot?.assetId ? p.assets[slot.assetId] : undefined;
  const v = asset?.versions.find((x) => x.id === asset.selectedVersionId);
  let prev: SceneDoc | undefined;
  if (v && !fresh) {
    prev = cachedSceneDoc(v.media.blobKey);
    if (!prev) { const b = await blobs.get(v.media.blobKey); if (b) prev = parseScene(await (typeof b.text === "function" ? b.text() : new Response(b).text())).doc; }
  }
  const merged = prev ? mergeSceneDraft(prev, draft.doc) : { doc: draft.doc, kept: [] as string[], added: draft.doc.objects.map((o) => o.id) };
  const media = await storeSceneMedia(blobs, merged.doc, asset?.id);
  return { media, merged: !!prev, kept: merged.kept, added: merged.added, skipped: draft.skipped, doc: merged.doc };
}
