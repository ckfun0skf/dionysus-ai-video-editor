import { useEffect, useState } from "react";
import type { Project } from "../domain";
import type { BlobStore } from "../ports";

/** First-frame thumbnail (data URL) per asset for filmstrips; images use the image itself. */
export function useThumbs(project: Project, blobs: BlobStore): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    for (const a of Object.values(project.assets)) {
      if (a.kind === "audio" || thumbs[a.id]) continue;
      const v = a.versions.find((x) => x.id === a.selectedVersionId) ?? a.versions[0];
      if (!v) continue;
      void blobs.get(v.media.blobKey).then((b) => b && grab(a.kind, b)).then((url) => {
        if (alive && url) setThumbs((t) => ({ ...t, [a.id]: url }));
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [project.assets, blobs]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}

async function grab(kind: string, blob: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  try {
    const el = kind === "image" ? new Image() : document.createElement("video");
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("thumb timeout")), 5000);
      const done = () => { clearTimeout(t); res(); };
      if (el instanceof HTMLVideoElement) {
        el.muted = true; el.preload = "auto";
        el.onloadeddata = () => { el.currentTime = Math.min(0.1, (el.duration || 1) / 2); };
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
    c.getContext("2d")?.drawImage(el, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
