import { drawVideoFrame } from "../frameGrab";
import { board, type Project } from "../../domain";
import type { BlobStore } from "../../ports";

/** P15: frames per second the picker steps by (most generated clips are 24-30 fps; one step never skips a frame). */
export const FRAME_STEP_SEC = 1 / 30;

/** Seek `el` to `sec` and resolve once the frame is decoded. */
export function seekTo(el: HTMLVideoElement, sec: number, timeoutMs = 8000): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error("Timed out seeking the clip")); }, timeoutMs);
    const done = () => { cleanup(); res(); };
    const fail = () => { cleanup(); rej(new Error("This clip can't be decoded in this browser")); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener("seeked", done); el.removeEventListener("error", fail); };
    el.addEventListener("seeked", done, { once: true });
    el.addEventListener("error", fail, { once: true });
    el.currentTime = Math.max(0, sec);
  });
}

/** Draw the frame `el` currently shows into a PNG. Throws when the browser only yields an empty frame. */
export async function grabCurrentFrame(el: HTMLVideoElement, maxWidth?: number): Promise<{ blob: Blob; width: number; height: number }> {
  const vw = el.videoWidth, vh = el.videoHeight;
  if (!vw || !vh) throw new Error("This clip has no picture");
  const k = maxWidth && vw > maxWidth ? maxWidth / vw : 1;
  const w = Math.round(vw * k), h = Math.round(vh * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); if (!g) throw new Error("Canvas is not available");
  if (!(await drawVideoFrame(g, el, w, h))) throw new Error("Couldn't read this frame in this browser — download the clip and upload a still instead");
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't save the frame");
  return { blob, width: w, height: h };
}

/** Open a video blob in a hidden element, wait for its data, run `fn`, then release it. */
export async function withVideo<T>(video: Blob, fn: (el: HTMLVideoElement) => Promise<T>, timeoutMs = 8000): Promise<T> {
  const url = URL.createObjectURL(video);
  const el = document.createElement("video");
  el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("Timed out reading the clip")), timeoutMs);
      el.addEventListener("loadeddata", () => { clearTimeout(t); res(); }, { once: true });
      el.addEventListener("error", () => { clearTimeout(t); rej(new Error("This clip can't be decoded in this browser")); }, { once: true });
    });
    return await fn(el);
  } finally {
    el.removeAttribute("src"); el.load(); URL.revokeObjectURL(url);
  }
}

/** Grab one frame of a video blob at `sec` (clamped into the clip) as a PNG. */
export function captureFrameAt(video: Blob, sec: number): Promise<{ blob: Blob; width: number; height: number; atSec: number }> {
  return withVideo(video, async (el) => {
    const d = Number.isFinite(el.duration) ? el.duration : 0;
    const at = Math.min(Math.max(0, sec), Math.max(0, d - 0.04));
    await seekTo(el, at);
    return { ...(await grabCurrentFrame(el)), atSec: Math.round(at * 1000) / 1000 };
  });
}

/** The source clip of a frameOf slot: the source shot's selected version and its file. */
export async function frameSource(p: Project, slotId: string, blobs: BlobStore) {
  const st = board.frameRefState(p, slotId);
  const src = p.storyboard?.shots[st.sourceShot];
  const v = src && st.currentVersionId ? board.versionsOf(p, src).find((x) => x.id === st.currentVersionId) : undefined;
  if (!v) return undefined;
  const blob = await blobs.get(v.media.blobKey);
  return blob ? { version: v, blob } : undefined;
}

/** P15: store a picked frame as a new version of the frameOf slot, with { frameOf, atSec, sourceVersionId }. */
export async function storePickedFrame(blobs: BlobStore, slotId: string, frameOf: string, sourceVersionId: string, fr: { blob: Blob; width: number; height: number }, atSec: number) {
  const key = `frameof/${slotId}/${sourceVersionId}/${Date.now()}`;
  await blobs.put(key, fr.blob);
  return { media: { blobKey: key, mime: "image/png", width: fr.width, height: fr.height }, frameRef: { frameOf, atSec: Math.round(atSec * 1000) / 1000, sourceVersionId } };
}
