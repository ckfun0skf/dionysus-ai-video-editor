import { stringifyAudioClip, type AudioClip } from "../domain";
import { newId, type Asset, type MediaRef } from "../domain";
import { secondsToTicks } from "../domain";
import { audioClipWav, type OfflineCtor } from "../render";

/** Where blobs go: anything with put(key, blob). */
export interface BlobPut { put(key: string, blob: Blob): Promise<unknown> }

export const AUDIO_CLIP_EXT = ".audioclip.json";

/** Render a clip and store its WAV (blobKey) and JSON (specKey) under `assetId/versionId`. */
export async function storeAudioClip(blobs: BlobPut, clip: AudioClip, assetId: string, versionId: string, opts?: { Offline?: OfflineCtor }): Promise<MediaRef> {
  const { wav, seconds } = await audioClipWav(clip, opts);
  const blobKey = `${assetId}/${versionId}`, specKey = `${blobKey}${AUDIO_CLIP_EXT}`;
  await blobs.put(specKey, new Blob([stringifyAudioClip(clip)], { type: "application/json" }));
  await blobs.put(blobKey, wav);
  return { blobKey, mime: "audio/wav", durationTicks: secondsToTicks(seconds), specKey };
}

/** A new audio asset made from a clip (one version). */
export async function audioClipAsset(blobs: BlobPut, clip: AudioClip, opts?: { Offline?: OfflineCtor }): Promise<Asset> {
  const id = newId("ast"), versionId = newId("ver");
  const media = await storeAudioClip(blobs, clip, id, versionId, opts);
  return { id, kind: "audio", name: clip.name || "Audio clip", selectedVersionId: versionId, versions: [{ id: versionId, createdAt: new Date().toISOString(), media, provenance: { source: "import", inputs: [] } }] };
}
