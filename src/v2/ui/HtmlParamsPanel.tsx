import { useEffect, useState } from "react";
import { ParamControls, type ControlSpec } from "./ParamControls";
import { cmd, type Engine } from "../engine";
import { cleanParamDecls, readManifest, resolveHtmlParams, type HtmlClipParam, type Placement, type Project } from "../domain";
import type { BlobStore } from "../ports";
import { Ic } from "./Icon";

/** Manifest param declarations → ParamControls specs (label falls back to the key). */
export function htmlParamSpecs(decls: Record<string, HtmlClipParam> | undefined): ControlSpec[] {
  return Object.entries(cleanParamDecls(decls)).map(([key, p]): ControlSpec => {
    const label = p.label || key, description = p.description;
    if (p.type === "number") return { key, label, description, type: "number", default: Number(p.default), min: p.min, max: p.max, step: p.step };
    if (p.type === "boolean") return { key, label, description, type: "boolean", default: !!p.default };
    if (p.type === "select") return { key, label, description, type: "select", default: String(p.default), options: p.options ?? [] };
    if (p.type === "color") return { key, label, description, type: "color", default: String(p.default) };
    return { key, label, description, type: "text", default: String(p.default) };
  });
}

/**
 * V2-HTML-PARAMS: the per-use values of an HTML clip's exposed params (manifest `params`). Edits are stored on this
 * timeline clip only (`placement.htmlParams`, overrides of the asset's defaults), so one asset (say a title card) can
 * show different words in different places. A drag or a typing session is one undo step.
 */
export function HtmlParamsPanel({ engine, project, placement, blobs, onEditCode }: {
  engine: Engine; project: Project; placement: Placement; blobs: BlobStore; onEditCode?: () => void;
}) {
  const ver = project.assets[placement.source.assetId]?.versions.find((v) => v.id === placement.source.versionId);
  const blobKey = ver?.media.blobKey;
  const [decls, setDecls] = useState<{ key: string; params?: Record<string, HtmlClipParam> }>();
  useEffect(() => {
    if (!blobKey) return;
    let live = true;
    void blobs.get(blobKey).then(async (b) => {
      let params: Record<string, HtmlClipParam> | undefined;
      try { params = b ? readManifest(await b.text()).params : undefined; } catch { params = undefined; }
      if (live) setDecls({ key: blobKey, params });
    });
    return () => { live = false; };
  }, [blobKey, blobs]);
  if (!decls || decls.key !== blobKey) return <p className="v2-hint" role="status">Loading params…</p>;
  const specs = htmlParamSpecs(decls.params);
  const overrides = placement.htmlParams ?? {};
  const changed = Object.keys(overrides).some((k) => specs.some((s) => s.key === k));
  if (!specs.length) return (
    <div className="v2-hp" data-testid="v2-html-params">
      <p className="v2-hint">This HTML clip exposes no params. Declare them in its manifest (<code>params</code>) and read <code>ctx.params</code> in <code>render</code> — then one clip, like a title card, can show different text each time you use it.</p>
      {onEditCode && <div className="v2-hp-actions"><button className="v2-btn" onClick={onEditCode}><Ic g="</>" size={14} /> Edit code</button></div>}
    </div>
  );
  return (
    <div className="v2-hp" data-testid="v2-html-params">
      <p className="v2-hint">Values for this clip only — other uses of the asset keep their own.</p>
      <ParamControls name="Clip" params={specs} values={resolveHtmlParams(decls.params, overrides)}
        onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()}
        onChange={(key, value) => engine.dispatch(cmd.setHtmlParams(placement.id, { [key]: value }, `Clip ${specs.find((s) => s.key === key)?.label ?? key}`))} />
      <div className="v2-hp-actions">
        <button className="v2-btn" disabled={!changed} title="Back to the clip's defaults" onClick={() => engine.dispatch(cmd.setHtmlParams(placement.id, undefined))}><Ic g="↶" size={14} /> Reset to defaults</button>
      </div>
    </div>
  );
}
