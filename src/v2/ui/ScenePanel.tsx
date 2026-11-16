import { useEffect, useRef, useState } from "react";
import { addSceneModel, parseScene, sceneSummary, versionOfPlacement, type Placement, type Project, type SceneDoc, type SceneIssue } from "../domain";
import { cmd, type Engine } from "../engine";
import type { BlobStore } from "../ports";
import { readAttachedFiles } from "./CodeEditor";
import { Ic } from "./Icon";
import { sceneVersion } from "./sceneAsset";

/**
 * The Scene tab of a 3D scene clip (P74; a sheet from the phone clip toolbar since P75): the objects with their
 * functions (and, for GLB models, their animation clips), the events in time order, and any problems the validator
 * found (with JSON paths). P75: "Add GLB model" embeds a .glb in the scene (a new version of the scene asset, one undo
 * step) and adds an object that plays its first animation. P76: "Edit scene" opens the scene editor (ui/SceneEditor.tsx).
 */
export function ScenePanel({ project, placement, blobs, engine, onEdit }: { project: Project; placement: Placement; blobs: BlobStore; engine?: Engine; onEdit?: () => void }) {
  const blobKey = versionOfPlacement(project, placement)?.media.blobKey;
  const [read, setRead] = useState<{ key: string; doc?: SceneDoc; issues: SceneIssue[] }>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!blobKey) return;
    let live = true;
    void blobs.get(blobKey).then(async (b) => {
      const r = b ? parseScene(await blobText(b)) : { issues: [{ level: "error" as const, path: "", message: "The scene file is missing." }] };
      if (live) setRead({ key: blobKey, ...r });
    }, () => { if (live) setRead({ key: blobKey, issues: [{ level: "error", path: "", message: "The scene file could not be loaded." }] }); });
    return () => { live = false; };
  }, [blobKey, blobs]);
  if (!read || read.key !== blobKey) return <div className="v2-psettings"><p className="v2-abnote">Loading scene…</p></div>;
  const sum = read.doc ? sceneSummary(read.doc) : undefined;
  const errors = read.issues.filter((i) => i.level === "error"), warnings = read.issues.filter((i) => i.level === "warning");
  const asset = project.assets[placement.source.assetId];
  const addModel = async (files: FileList | null) => {
    if (!files?.length || !engine || !asset || !read.doc) return;
    setBusy(true); setNote(undefined);
    try {
      const { next, notes } = await readAttachedFiles(files, {}, ".glb");
      const [name, data] = Object.entries(next)[0] ?? [];
      if (!name || !data) { setNote(notes.join(" ") || "No model was added."); return; }
      const { doc, id } = addSceneModel(read.doc, name, data);
      const version = await sceneVersion(blobs, asset, doc);
      engine.dispatch(cmd.addAssetVersion(asset.id, version, placement.id, { label: "Add 3D model" }));
      setNote([`Added “${id}” (${name}).`, ...notes].join(" "));
    } catch { setNote("Couldn't add the model."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <div className="v2-psettings v2-scene-panel" data-testid="scene-panel">
    {onEdit && <button type="button" className="v2-btn primary v2-scene-add v2-scene-edit" title="Open this scene's own timeline: one track per object, events as blocks, forms for every value (each edit is one undo step)" onClick={onEdit}><Ic g="✎" size={16} /> Edit scene</button>}
    {sum && <section aria-label="Scene objects"><h4>Objects <small>{sum.objects.length}</small></h4>
      <ul className="v2-scene-list">{sum.objects.map((o) => <li key={o.id}><code>{o.id}</code> <span>{o.shape}</span>{o.functions.length > 0 && <small> · {o.functions.join(", ")}</small>}
        {o.animations && <small className="v2-scene-anims"> · {o.animations.length ? `animations: ${o.animations.join(", ")}` : "no animations"}</small>}</li>)}</ul>
      {engine && read.doc && <>
        <button type="button" className="v2-btn v2-scene-add" disabled={busy} title="Embed a .glb model in this scene (a new version; Undo removes it). It stands in front of the camera and plays its first animation." onClick={() => input.current?.click()}><Ic g="scene" size={16} /> {busy ? "Adding…" : "Add GLB model"}</button>
        <input ref={input} type="file" accept=".glb,model/gltf-binary" hidden data-testid="scene-model-input" onChange={(e) => void addModel(e.currentTarget.files)} />
        {note && <p className="v2-abnote" role="status">{note}</p>}
      </>}
    </section>}
    {sum && <section aria-label="Scene events"><h4>Events <small>{sum.events.length}</small></h4>
      {sum.events.length ? <ol className="v2-scene-list">{sum.events.map((e) => <li key={e.i}><span className="v2-scene-at">{e.at.toFixed(2)}s</span> <code>{e.obj}.{e.call}</code>{e.dur ? <small> · {e.dur}s</small> : null}</li>)}</ol>
        : <p className="v2-abnote">No events: the scene holds still.</p>}</section>}
    {(errors.length > 0 || warnings.length > 0) && <section aria-label="Scene problems"><h4>Problems</h4>
      <ul className="v2-scene-list v2-scene-issues">{[...errors, ...warnings].map((i, n) => <li key={n} className={`is-${i.level}`}>{i.path && <code>{i.path}</code>} {i.message}</li>)}</ul></section>}
    <p className="v2-abnote">Every frame is computed from the scene&apos;s JSON and the time alone (models and their animations too), so preview and export match. Edit scene opens its own timeline with a track per object.</p>
  </div>;
}

/** Blob text (FileReader where `Blob.text` is missing, as in jsdom). */
function blobText(b: Blob): Promise<string> {
  if (typeof b.text === "function") return b.text();
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsText(b); });
}
