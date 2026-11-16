/** Import a user file as an Asset: store blob, probe duration/dimensions. */
import { newId, type Asset, type MediaKind } from "../domain/model";
import { secondsToTicks } from "../domain/time";
import { readManifest } from "../domain/htmlClipPackage";
import { kindForFile, mimeForFile } from "../clipTypes";

/** P38: an html package's role for MediaRef.role ("clip" = none). */
export function htmlRoleOf(html: string): "effect" | "transition" | undefined {
  const r = readManifest(html).role;
  return r === "effect" || r === "transition" ? r : undefined;
}
import type { BlobStore } from "../ports/storage";

/** The asset kind of an imported file (P71: the clip type cores' `accepts`: MIME type first, then extension). */
export function mediaKindOf(file: { type: string; name: string }): MediaKind | undefined {
  return kindForFile(file);
}

/** The file's MIME type, or one guessed from the extension (iOS picker files sometimes arrive with an empty type). */
export function mimeOf(file: { type: string; name: string }): string {
  return mimeForFile(file);
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
    const mime = mimeOf(file);
    // Storage chunks the bytes itself (V2-108); retyping only matters when the picker gave no type.
    await blobs.put(blobKey, mime === file.type ? file : new Blob([file], { type: mime }));
    const role = kind === "html" ? htmlRoleOf(await file.text()) : undefined;
    return {
      id, kind, name: file.name, selectedVersionId: versionId,
      versions: [{ id: versionId, createdAt: new Date().toISOString(), media: { blobKey, mime, ...info, ...(role ? { role } : {}) }, provenance: { source: "import", inputs: [] } }],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
