const MAX_THUMBNAIL_EDGE = 320;
const VIDEO_THUMBNAIL_TIMEOUT_MS = 3000;

function captureThumbnail(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): string | undefined {
  if (typeof document === "undefined" || sourceWidth <= 0 || sourceHeight <= 0) return undefined;
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  try {
    context.drawImage(source, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.76);
  } catch {
    return undefined;
  }
}

/** Create a small, browser-local thumbnail for an imported image without retaining a second full-size copy. */
export async function createImageThumbnail(blob: Blob): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(blob);
    const image = new Image();
    const loaded = await new Promise<boolean>(resolve => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url!;
    });
    return loaded ? captureThumbnail(image, image.naturalWidth, image.naturalHeight) : undefined;
  } catch {
    return undefined;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Capture one representative frame from a local video File/Blob. Failure is
 * intentionally non-fatal: unsupported codecs keep the normal placeholder.
 */
export async function createVideoThumbnail(blob: Blob): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  let url: string | undefined;
  let video: HTMLVideoElement | undefined;
  try {
    url = URL.createObjectURL(blob);
    video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const frame = await new Promise<string | undefined>(resolve => {
      let settled = false;
      let seekRequested = false;
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        video!.removeEventListener("loadedmetadata", onMetadata);
        video!.removeEventListener("loadeddata", onLoadedData);
        video!.removeEventListener("seeked", onSeeked);
        video!.removeEventListener("error", onError);
        resolve(value);
      };
      const capture = () => finish(captureThumbnail(video!, video!.videoWidth, video!.videoHeight));
      const onMetadata = () => {
        if (!Number.isFinite(video!.duration) || video!.videoWidth <= 0 || video!.videoHeight <= 0) {
          finish();
          return;
        }
        const target = video!.duration > 0.25 ? Math.min(1, video!.duration * 0.1) : 0;
        if (target > 0) {
          seekRequested = true;
          try { video!.currentTime = target; } catch { if (video!.readyState >= 2) capture(); }
        } else if (video!.readyState >= 2) {
          capture();
        }
      };
      const onLoadedData = () => { if (!seekRequested) capture(); };
      const onSeeked = () => { if (seekRequested) capture(); };
      const onError = () => finish();
      const timeout = setTimeout(() => finish(), VIDEO_THUMBNAIL_TIMEOUT_MS);
      video!.addEventListener("loadedmetadata", onMetadata);
      video!.addEventListener("loadeddata", onLoadedData);
      video!.addEventListener("seeked", onSeeked);
      video!.addEventListener("error", onError);
      video!.src = url!;
      try { video!.load(); } catch { finish(); }
    });
    return frame;
  } catch {
    return undefined;
  } finally {
    if (video) {
      try { video.pause(); } catch { /* Some browsers reject cleanup on a failed decoder. */ }
      video.removeAttribute("src");
      try { video.load(); } catch { /* Cleanup must not turn a missing thumbnail into an import failure. */ }
    }
    if (url) URL.revokeObjectURL(url);
  }
}

/** Return the best saved thumbnail/source preview for a reusable asset. */
export function getAssetThumbnail(asset: { kind: string; path?: string; thumbnailPath?: string } | undefined): string | undefined {
  if (!asset) return undefined;
  if (asset.thumbnailPath) return asset.thumbnailPath;
  return asset.kind === "image" ? asset.path : undefined;
}
