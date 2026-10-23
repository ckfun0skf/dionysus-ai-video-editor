/** Import a user file as an Asset: store blob, probe duration/dimensions. */
import { newId, type Asset, type MediaKind } from "../domain/model";
import { secondsToTicks } from "../domain/time";
import type { BlobStore } from "../ports/storage";

export function mediaKindOf(file: { type: string; name: string }): MediaKind | undefined {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  return undefined;
}

export async function probeMedia(kind: MediaKind, url: string): Promise<{ durationTicks?: number; width?: number; height?: number }> {
  if (kind === "image") {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  const el = document.createElement(kind === "video" ? "video" : "audio");
  el.preload = "metadata";
  el.src = url;
  await new Promise<void>((res) => { el.onloadedmetadata = () => res(); el.onerror = () => res(); setTimeout(res, 8000); });
  const d = Number.isFinite(el.duration) ? el.duration : 5;
  const v = el as HTMLVideoElement;
  return { durationTicks: secondsToTicks(d), width: v.videoWidth || undefined, height: v.videoHeight || undefined };
}

export async function importFile(file: File, blobs: BlobStore, probe = probeMedia): Promise<Asset | undefined> {
  const kind = mediaKindOf(file);
  if (!kind) return undefined;
  const id = newId("ast");
  const versionId = newId("ver");
  const blobKey = `${id}/${versionId}`;
  await blobs.put(blobKey, file);
  const url = URL.createObjectURL(file);
  try {
    const info = await probe(kind, url);
    return {
      id, kind, name: file.name, selectedVersionId: versionId,
      versions: [{ id: versionId, createdAt: new Date().toISOString(), media: { blobKey, mime: file.type, ...info }, provenance: { source: "import", inputs: [] } }],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
