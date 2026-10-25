import { useEffect, useRef, useState } from "react";
import type { Project } from "../../domain";
import type { BlobStore } from "../../ports";
import { grab } from "../useThumbs";
import { grabHtml } from "../htmlThumb";
import { ticksToSeconds } from "../../domain";

/** Small thumbnail (data URL) per asset VERSION id (HTML versions: a frame about 1 s in), for every storyboard slot/shot version. Computed once per version. */
export function useVersionThumbs(project: Project, blobs: BlobStore): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const started = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const b = project.storyboard;
    if (!b) return;
    const owners = [...Object.values(b.slots), ...Object.values(b.shots)];
    for (const o of owners) {
      const a = o.assetId ? project.assets[o.assetId] : undefined;
      if (!a || a.kind === "audio") continue;
      for (const v of a.versions) {
        if (started.current.has(v.id)) continue;
        started.current.add(v.id);
        // HTML versions (V2-SB-130): a real frame from the clip runtime, not a black placeholder.
        void blobs.get(v.media.blobKey).then((blob) => blob && (a.kind === "html" ? grabHtml(blob, project, blobs, v.media.durationTicks ? ticksToSeconds(v.media.durationTicks) : undefined) : grab(a.kind, blob)))
          .then((url) => { if (mounted.current && url) setThumbs((t) => ({ ...t, [v.id]: url })); })
          .catch(() => started.current.delete(v.id));
      }
    }
  }, [project.storyboard, project.assets, blobs]);
  return thumbs;
}
