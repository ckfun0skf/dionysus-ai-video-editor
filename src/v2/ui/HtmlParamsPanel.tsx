import { useEffect, useState } from "react";
import { ParamControls, type ControlSpec } from "./ParamControls";
import { cmd, type Engine } from "../engine";
import { cleanParamDecls, INPUT_TYPES, inputSourceOf, namedTracker, pendingTracker, refType, type RefType, readManifest, resolveHtmlParams, sourceChoices, sourceLabel, type HtmlClipInput, type HtmlClipParam, type Placement, type Project } from "../domain";
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
  const [decls, setDecls] = useState<{ key: string; params?: Record<string, HtmlClipParam>; inputs?: Record<string, HtmlClipInput> }>();
  useEffect(() => {
    if (!blobKey) return;
    let live = true;
    void blobs.get(blobKey).then(async (b) => {
      let params: Record<string, HtmlClipParam> | undefined, inputs: Record<string, HtmlClipInput> | undefined;
      try { const m = b ? readManifest(await b.text()) : undefined; params = m?.params; inputs = m?.inputs; } catch { params = undefined; }
      if (live) setDecls({ key: blobKey, params, inputs });
    });
    return () => { live = false; };
  }, [blobKey, blobs]);
  if (!decls || decls.key !== blobKey) return <p className="v2-hint" role="status">Loading params…</p>;
  const specs = htmlParamSpecs(decls.params);
  const overrides = placement.htmlParams ?? {};
  const changed = Object.keys(overrides).some((k) => specs.some((s) => s.key === k));
  const inputs = Object.entries(decls.inputs ?? {}).filter(([, d]) => d && (INPUT_TYPES as readonly string[]).includes(d.type));
  const inputsEl = inputs.length > 0 && <ClipInputs engine={engine} project={project} placement={placement} inputs={inputs} />;
  if (!specs.length && inputsEl) return <div className="v2-hp" data-testid="v2-html-params">{inputsEl}</div>;
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
      {inputsEl}
      <div className="v2-hp-actions">
        <button className="v2-btn" disabled={!changed} title="Back to the clip's defaults" onClick={() => engine.dispatch(cmd.setHtmlParams(placement.id, undefined))}><Ic g="↶" size={14} /> Reset to defaults</button>
      </div>
    </div>
  );
}

/**
 * P38: the clip's inputs (manifest `inputs`) and where each reads from. A tap on the source opens the Reference list:
 * Mix / Program, each track (renameable here, the binding keeps the track id) and its clips. One undo step per change.
 */
const REF_LABEL: Record<RefType, string> = { graphic: "Graphic reference · luma, colour, motion", audio: "Audio reference · rms, bands, onset", tracker: "Tracker reference · x, y, size, found" };
const REF_ICON: Record<RefType, string> = { graphic: "eye", audio: "♫", tracker: "track" };

function ClipInputs({ engine, project, placement, inputs }: { engine: Engine; project: Project; placement: Placement; inputs: [string, HtmlClipInput][] }) {
  const [open, setOpen] = useState<string>();
  const [rename, setRename] = useState<{ id: string; name: string }>();
  return (
    <section className="v2-inputs" aria-label="Inputs">
      <h4 className="v2-inputs-head">Inputs</h4>
      {inputs.map(([name, d]) => {
        const raw = placement.htmlInputs?.[name], k = refType(d.type);
        // P43: a tracker named by the storyboard but not set yet stays shown as "<clip> · <name> (not set yet)".
        const cur = raw && pendingTracker(raw) && !namedTracker(project, raw) ? raw : inputSourceOf(project, placement, name, d.type);
        const label = d.label || name;
        return (
          <div key={name} className="v2-input">
            <div className="v2-input-row">
              <span className="v2-input-name"><b>{label}</b><small>{REF_LABEL[k]}</small></span>
              <button type="button" className="v2-btn v2-input-src" aria-expanded={open === name} aria-label={`${label} reads from ${sourceLabel(project, cur)}`} onClick={() => { setOpen(open === name ? undefined : name); setRename(undefined); }}>
                <Ic g={REF_ICON[k]} size={16} /> <span>{sourceLabel(project, cur)}</span> <Ic g="▾" size={14} />
              </button>
            </div>
            {open === name && (
              <div className="v2-input-list" role="radiogroup" aria-label={`Reference for ${label}`}>
                {sourceChoices(project, d.type, placement.id).map((c) => rename && c.kind === "track" && rename.id === c.trackId ? (
                  <form key={c.source} className="v2-input-rename" onSubmit={(e) => { e.preventDefault(); if (rename.name.trim()) engine.dispatch(cmd.renameTrack(rename.id, rename.name)); setRename(undefined); }}>
                    <input autoFocus aria-label="Layer name" value={rename.name} maxLength={40} onChange={(e) => setRename({ ...rename, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setRename(undefined); }} />
                    <button type="button" className="v2-icon" aria-label="Cancel rename" onClick={() => setRename(undefined)}><Ic g="✕" size={16} /></button>
                    <button type="submit" className="v2-icon" aria-label="Save name" disabled={!rename.name.trim()}><Ic g="✓" size={16} /></button>
                  </form>
                ) : (
                  <div key={c.source} className={`v2-input-opt kind-${c.kind}`}>
                    <button type="button" role="radio" aria-checked={cur === c.source} className={cur === c.source ? "is-active" : ""}
                      onClick={() => { if (cur !== c.source) engine.dispatch(cmd.setClipInput(placement.id, name, c.kind === "mix" || c.kind === "program" || c.kind === "none" ? undefined : c.source)); setOpen(undefined); }}>
                      <Ic g={cur === c.source ? "✓" : c.kind === "track" ? "layers" : c.kind === "clip" ? "▭" : REF_ICON[k]} size={16} /> <span>{c.label}</span>
                    </button>
                    {c.kind === "track" && <button type="button" className="v2-icon" aria-label={`Rename ${c.label}`} title="Rename layer" onClick={() => setRename({ id: c.trackId!, name: c.label })}><Ic g="✎" size={16} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="v2-hint">The clip gets numbers only (no audio or pixels): graphic = luma, average colour, motion, histogram; audio = rms, peak, 8 bands, onset, envelope; tracker = the box (x, y, size, found).</p>
    </section>
  );
}
