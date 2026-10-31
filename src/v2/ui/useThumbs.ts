import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Project } from "../domain";
import type { BlobStore } from "../ports";
import { drawVideoFrame } from "./frameGrab";
import { grabHtml } from "./htmlThumb";
import { ticksToSeconds } from "../domain";

const selected = (a: Asset) => a.versions.find((x) => x.id === a.selectedVersionId) ?? a.versions[0];

/**
 * First-frame thumbnail (data URL) per asset for filmstrips and the Media panel; images use the image
 * itself, HTML clips a frame about 1 s in (V2-SB-130). Cached per version, so a tile follows the asset's selected version (V2-SB-R04).
 */
export function useThumbs(project: Project, blobs: BlobStore): Record<string, string> {
  const [cache, setCache] = useState<Record<string, string>>({});
  const started = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    for (const a of Object.values(project.assets)) {
      if (a.kind === "audio") continue;
      const v = selected(a);
      const key = v && `${a.id}:${v.id}`;
      if (!v || started.current.has(key)) continue;
      started.current.add(key);
      const html = (b: Blob) => grabHtml(b, project, blobs, v.media.durationTicks ? ticksToSeconds(v.media.durationTicks) : undefined);
      void blobs.get(v.media.blobKey).then((b) => b && (a.kind === "html" ? html(b) : grab(a.kind, b))).then((url) => {
        if (alive.current && url) setCache((t) => ({ ...t, [key]: url }));
      }).catch(() => started.current.delete(key));
    }
  }, [project.assets, blobs]);
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const a of Object.values(project.assets)) { const v = selected(a); const url = v && cache[`${a.id}:${v.id}`]; if (url) out[a.id] = url; }
    return out;
  }, [project.assets, cache]);
}

/** A small JPEG of an image, or of a video frame at `atSec` (default: about 0.1 s in). */
export async function grab(kind: string, blob: Blob, atSec?: number): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  try {
    const el = kind === "image" ? new Image() : document.createElement("video");
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("thumb timeout")), 5000);
      const done = () => { clearTimeout(t); res(); };
      if (el instanceof HTMLVideoElement) {
        el.muted = true; el.preload = "auto";
        el.onloadeddata = () => { const d = Number.isFinite(el.duration) ? el.duration : 0; el.currentTime = atSec !== undefined && atSec > 0 ? Math.min(atSec, Math.max(0, d - 0.04)) : Math.min(0.1, (d || 1) / 2); };
        el.onseeked = done;
      } else el.onload = done;
      el.onerror = () => { clearTimeout(t); rej(new Error("thumb error")); };
      el.src = url;
    });
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return undefined;
    const c = document.createElement("canvas");
    c.height = 96; c.width = Math.round((96 * w) / h);
    const g = c.getContext("2d");
    if (!g) return undefined;
    if (el instanceof HTMLVideoElement) { if (!(await drawVideoFrame(g, el, c.width, c.height))) return undefined; } // empty frame: keep the placeholder
    else g.drawImage(el, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
