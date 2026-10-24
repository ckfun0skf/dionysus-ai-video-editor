/** Helpers for drawing a seeked <video> into a canvas reliably (V2-SB-R03). */

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/**
 * Wait until the frame at the new `currentTime` is ready to paint. After `seeked`, iOS Safari often
 * still holds the previous (or no) frame, so give it a video frame callback or two animation frames.
 * Never waits longer than `maxMs` (rAF does not fire in background tabs).
 */
export function settleFrame(el: HTMLVideoElement, maxMs = 120): Promise<void> {
  return new Promise<void>((res) => {
    const t = setTimeout(res, maxMs);
    const done = () => { clearTimeout(t); res(); };
    const v = el as FrameVideo;
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(done);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(done));
    } else if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

/** True when every sampled pixel is fully transparent: the browser drew nothing. A black frame is not blank. */
export function isBlankCanvas(g: CanvasRenderingContext2D, w: number, h: number): boolean {
  let data: Uint8ClampedArray;
  try { data = g.getImageData(0, 0, w, h).data; } catch { return false; }
  const step = Math.max(1, Math.floor(data.length / 4 / 4096)) * 4;
  for (let i = 3; i < data.length; i += step) if (data[i] !== 0) return false;
  return true;
}

/**
 * Draw the video's current frame into `g`, retrying once after a short wait if the browser
 * produced an empty frame. Returns false when the frame is still empty.
 */
export async function drawVideoFrame(g: CanvasRenderingContext2D, el: HTMLVideoElement, w: number, h: number): Promise<boolean> {
  await settleFrame(el);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    g.clearRect(0, 0, w, h);
    g.drawImage(el, 0, 0, w, h);
    if (!isBlankCanvas(g, w, h)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
