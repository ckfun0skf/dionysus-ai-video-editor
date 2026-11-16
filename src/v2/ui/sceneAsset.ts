import { newId, SCENE_MIME, sceneMediaRef, type Asset, type AssetVersion, type SceneDoc } from "../domain";

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
