import { useEffect, useState } from "react";
import { parseScene, sceneSummary, versionOfPlacement, type Placement, type Project, type SceneDoc, type SceneIssue } from "../domain";
import type { BlobStore } from "../ports";

/**
 * P74: the Scene tab of a 3D scene clip, read-only in step 2.1: the objects with their functions, the events in time
 * order, and any problems the validator found (with JSON paths). Editing comes with the inspector step (2.3).
 */
export function ScenePanel({ project, placement, blobs }: { project: Project; placement: Placement; blobs: BlobStore }) {
  const blobKey = versionOfPlacement(project, placement)?.media.blobKey;
  const [read, setRead] = useState<{ key: string; doc?: SceneDoc; issues: SceneIssue[] }>();
  useEffect(() => {
    if (!blobKey) return;
    let live = true;
    void blobs.get(blobKey).then(async (b) => {
      const r = b ? parseScene(await b.text()) : { issues: [{ level: "error" as const, path: "", message: "The scene file is missing." }] };
      if (live) setRead({ key: blobKey, ...r });
    }, () => { if (live) setRead({ key: blobKey, issues: [{ level: "error", path: "", message: "The scene file could not be loaded." }] }); });
    return () => { live = false; };
  }, [blobKey, blobs]);
  if (!read || read.key !== blobKey) return <div className="v2-psettings"><p className="v2-abnote">Loading scene…</p></div>;
  const sum = read.doc ? sceneSummary(read.doc) : undefined;
  const errors = read.issues.filter((i) => i.level === "error"), warnings = read.issues.filter((i) => i.level === "warning");
  return <div className="v2-psettings v2-scene-panel" data-testid="scene-panel">
    {sum && <section aria-label="Scene objects"><h4>Objects <small>{sum.objects.length}</small></h4>
      <ul className="v2-scene-list">{sum.objects.map((o) => <li key={o.id}><code>{o.id}</code> <span>{o.shape}</span>{o.functions.length > 0 && <small> · {o.functions.join(", ")}</small>}</li>)}</ul></section>}
    {sum && <section aria-label="Scene events"><h4>Events <small>{sum.events.length}</small></h4>
      {sum.events.length ? <ol className="v2-scene-list">{sum.events.map((e) => <li key={e.i}><span className="v2-scene-at">{e.at.toFixed(2)}s</span> <code>{e.obj}.{e.call}</code>{e.dur ? <small> · {e.dur}s</small> : null}</li>)}</ol>
        : <p className="v2-abnote">No events: the scene holds still.</p>}</section>}
    {(errors.length > 0 || warnings.length > 0) && <section aria-label="Scene problems"><h4>Problems</h4>
      <ul className="v2-scene-list v2-scene-issues">{[...errors, ...warnings].map((i, n) => <li key={n} className={`is-${i.level}`}>{i.path && <code>{i.path}</code>} {i.message}</li>)}</ul></section>}
    <p className="v2-abnote">Every frame is computed from the scene&apos;s JSON and the time alone, so preview and export match. This tab is read-only for now.</p>
  </div>;
}
