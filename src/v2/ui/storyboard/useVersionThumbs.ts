import { useEffect, useRef, useState } from "react";
import type { Project } from "../../domain";
import type { BlobStore } from "../../ports";
import { grab } from "../useThumbs";
import { grabHtml } from "../htmlThumb";
import { ticksToSeconds } from "../../domain";

/** Thumbnail key for an html version shown with a shot's own param values (V2-HTML-PARAMS: a title card's text). */
export const paramThumbKey = (versionId: string, params: Record<string, unknown> | undefined) => (params && Object.keys(params).length ? `${versionId}?${JSON.stringify(params)}` : versionId);

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
      // V2-HTML-PARAMS: an html shot with its own param values also gets thumbnails drawn with them.
      const params = a.kind === "html" && "params" in o && o.params && Object.keys(o.params).length ? o.params : undefined;
      for (const v of a.versions) {
        const key = paramThumbKey(v.id, params);
        if (started.current.has(key)) continue;
        started.current.add(key);
        // HTML versions (V2-SB-130): a real frame from the clip runtime, not a black placeholder.
        void blobs.get(v.media.blobKey).then((blob) => blob && (a.kind === "html" ? grabHtml(blob, project, blobs, v.media.durationTicks ? ticksToSeconds(v.media.durationTicks) : undefined, params) : grab(a.kind, blob)))
          .then((url) => { if (mounted.current && url) setThumbs((t) => ({ ...t, [key]: url })); })
          .catch(() => started.current.delete(key));
      }
    }
  }, [project.storyboard, project.assets, blobs]);
  return thumbs;
}
