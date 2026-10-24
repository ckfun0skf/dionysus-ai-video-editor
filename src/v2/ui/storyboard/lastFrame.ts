import { drawVideoFrame } from "../frameGrab";

export const BLANK_FRAME = "Couldn’t read the last frame in this browser — upload it instead";

/**
 * Grab (nearly) the last frame of a video blob as a PNG. Throws when the browser only yields an empty frame. Seeks a little before the end: some browsers return a black frame at exactly `duration`.
 * `endSec` (V2-SB-121): the end of a trimmed clip, used instead of the file's end.
 */
export async function extractLastFrame(video: Blob, timeoutMs = 8000, endSec?: number): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(video);
  const el = document.createElement("video");
  el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
  const wait = (ev: string) => new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("Timed out reading the clip")), timeoutMs);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    el.addEventListener("error", () => { clearTimeout(t); rej(new Error("This clip can't be decoded in this browser")); }, { once: true });
  });
  try {
    await wait("loadeddata");
    const full = Number.isFinite(el.duration) ? el.duration : 0;
    const d = endSec !== undefined && endSec > 0 && (!full || endSec < full) ? endSec : full;
    el.currentTime = Math.max(0, d - Math.min(0.05, d / 10));
    await wait("seeked");
    const w = el.videoWidth, h = el.videoHeight;
    if (!w || !h) throw new Error("This clip has no picture");
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); if (!g) throw new Error("Canvas is not available");
    if (!(await drawVideoFrame(g, el, w, h))) throw new Error(BLANK_FRAME);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) throw new Error("Couldn't save the frame");
    return { blob, width: w, height: h };
  } finally {
    el.removeAttribute("src"); el.load(); URL.revokeObjectURL(url);
  }
}
