/** Import a user file as an Asset: store blob, probe duration/dimensions. */
import { newId, type Asset, type MediaKind } from "../domain/model";
import { secondsToTicks } from "../domain/time";
import type { BlobStore } from "../ports/storage";

export function mediaKindOf(file: { type: string; name: string }): MediaKind | undefined {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "text/html") return "html";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (["html", "htm"].includes(ext)) return "html";
  return undefined;
}

export async function probeMedia(kind: MediaKind, url: string): Promise<{ durationTicks?: number; width?: number; height?: number }> {
  if (kind === "html") return { width: 1920, height: 1080 }; // renders at the output size; length is set on the timeline
  if (kind === "image") {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => undefined);
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  const el = document.createElement(kind === "video" ? "video" : "audio");
  el.preload = "metadata";
  el.src = url;
  await withTimeout(new Promise<void>((res, rej) => { el.onloadedmetadata = () => res(); el.onerror = () => rej(new Error("Unsupported or corrupt media")); }), 8000);
  // Some recordings (e.g. MediaRecorder WebM) report Infinity until seeked to the end.
  if (!Number.isFinite(el.duration)) {
    el.currentTime = 1e9;
    await withTimeout(new Promise<void>((res) => { el.ondurationchange = () => { if (Number.isFinite(el.duration)) res(); }; }), 3000).catch(() => undefined);
  }
  if (!Number.isFinite(el.duration) || el.duration <= 0) throw new Error("Could not determine media duration");
  const d = el.duration;
  const v = el as HTMLVideoElement;
  return { durationTicks: secondsToTicks(d), width: v.videoWidth || undefined, height: v.videoHeight || undefined };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("Timed out reading media")), ms); })]).finally(() => clearTimeout(t));
}

export async function importFile(file: File, blobs: BlobStore, probe = probeMedia): Promise<Asset | undefined> {
  const kind = mediaKindOf(file);
  if (!kind) return undefined;
  const id = newId("ast");
  const versionId = newId("ver");
  const blobKey = `${id}/${versionId}`;
  const url = URL.createObjectURL(file);
  try {
    const info = await probe(kind, url); // throws on unreadable media: nothing is stored
    await blobs.put(blobKey, file);
    return {
      id, kind, name: file.name, selectedVersionId: versionId,
      versions: [{ id: versionId, createdAt: new Date().toISOString(), media: { blobKey, mime: file.type, ...info }, provenance: { source: "import", inputs: [] } }],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
