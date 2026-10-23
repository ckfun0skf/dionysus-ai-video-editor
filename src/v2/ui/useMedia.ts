import { useEffect, useRef, useState } from "react";
import type { Project } from "../domain";
import type { BlobStore } from "../ports";
import { decodePeaks, extractFilmstrip, type Filmstrip, type Peaks } from "./media";

/** Key for per-asset-version previews. */
export const mediaKey = (assetId: string, versionId: string) => `${assetId}:${versionId}`;

/** Lazily computed waveforms (audio + video) and filmstrips (video), once per asset version. Failures fall back to plain fills. */
export function useMediaPreviews(project: Project, blobs: BlobStore) {
  const [peaks, setPeaks] = useState<Record<string, Peaks>>({});
  const [strips, setStrips] = useState<Record<string, Filmstrip>>({});
  const started = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    mounted.current = true;
    for (const a of Object.values(project.assets)) {
      if (a.kind === "image" || a.kind === "html") continue;
      for (const v of a.versions) {
        const key = mediaKey(a.id, v.id);
        if (started.current.has(key)) continue;
        started.current.add(key);
        const blob = blobs.get(v.media.blobKey);
        void blob.then((b) => (b ? decodePeaks(b) : undefined)).catch(() => undefined)
          .then((r) => { if (mounted.current && r) setPeaks((p) => ({ ...p, [key]: r })); });
        if (a.kind === "video") void blob.then((b) => (b ? extractFilmstrip(b) : undefined)).catch(() => undefined)
          .then((r) => { if (mounted.current && r) setStrips((s) => ({ ...s, [key]: r })); });
      }
    }
  }, [project.assets, blobs]);
  return { peaks, strips };
}
