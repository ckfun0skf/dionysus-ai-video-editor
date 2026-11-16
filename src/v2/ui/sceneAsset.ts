import { newId, SCENE_MIME, type Asset, type SceneDoc } from "../domain";

type BlobPut = { put(key: string, blob: Blob): Promise<void> };

/** P74: a `scene` asset whose first version is the given `dionysus.scene/1` document (stored as a JSON blob). */
export async function sceneAsset(blobs: BlobPut, doc: SceneDoc, name = doc.name || "3D scene"): Promise<Asset> {
  const id = newId("ast"), versionId = newId("ver"), blobKey = `${id}/${versionId}`;
  await blobs.put(blobKey, new Blob([JSON.stringify(doc, null, 2)], { type: SCENE_MIME }));
  return { id, kind: "scene", name, selectedVersionId: versionId, versions: [{ id: versionId, createdAt: new Date().toISOString(), media: { blobKey, mime: SCENE_MIME, width: 1920, height: 1080 }, provenance: { source: "import", inputs: [] } }] };
}
