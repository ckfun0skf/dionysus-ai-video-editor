/**
 * P59: fullscreen preview orientation — lock when the browser allows it (typically after
 * requestFullscreen), otherwise CSS-rotate the stage so touch coordinates via getBoundingClientRect
 * stay aligned with what the user sees.
 */
export type PreviewOrient = "landscape" | "portrait";

export function preferredPreviewOrient(width: number, height: number): PreviewOrient {
  return width >= height ? "landscape" : "portrait";
}

export function canLockOrientation(): boolean {
  try {
    return typeof screen !== "undefined" && typeof (screen.orientation as ScreenOrientation & { lock?: unknown } | undefined)?.lock === "function";
  } catch {
    return false;
  }
}

/** How the orientation toggle should work on this device. */
export function previewOrientFallback(opts: { canLock?: boolean } = {}): "lock" | "css-rotate" {
  return (opts.canLock ?? canLockOrientation()) ? "lock" : "css-rotate";
}

export function toggleOrient(cur: PreviewOrient): PreviewOrient {
  return cur === "landscape" ? "portrait" : "landscape";
}

/**
 * Whether the fullscreen stage should apply a 90° CSS rotate so `want` matches the visual
 * orientation when the OS cannot lock (layout size is the viewport).
 */
export function needsCssRotate(want: PreviewOrient, viewportW: number, viewportH: number): boolean {
  const now: PreviewOrient = viewportW >= viewportH ? "landscape" : "portrait";
  return now !== want;
}
