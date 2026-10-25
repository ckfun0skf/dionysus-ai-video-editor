/**
 * Asset slot editor (V2-CUT-05): name, type, aspect, how it is made, prompt, what it is made from, checks, notes.
 * Phones: a bottom sheet (✓ saves); desktop: the side panel with Cancel / Save (⌘/Ctrl+Enter). A save is one undo step.
 */
import { useEffect, useRef, useState } from "react";
import { board, story, storyEdit, storyRefs, type AssetSlot, type Project, type QaCheck } from "../../domain";
import { Ic } from "../Icon";
import { Panel } from "./ShotEditor";

const ASPECT = /^\d+(\.\d+)?:\d+(\.\d+)?$/;

export function SlotEditor({ project, slot, isNew, mobile, onSave, onCancel, onDelete }: {
  project: Project; slot: AssetSlot; isNew?: boolean; mobile: boolean;
  onSave: (patch: storyRefs.SlotPatch) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const b = project.storyboard!;
  const [name, setName] = useState(slot.name);
  const [type, setType] = useState(slot.type);
  const [aspect, setAspect] = useState(slot.aspect);
  const [source, setSource] = useState<"generate" | "upload">(slot.source.type === "upload" ? "upload" : "generate");
  const [prompt, setPrompt] = useState(slot.prompt);
  const [references, setReferences] = useState(slot.references);
  const [refRoles, setRefRoles] = useState(slot.refRoles ?? {});
  const [qa, setQa] = useState<QaCheck[]>(slot.qa);
  const [notes, setNotes] = useState(slot.notes ?? "");
  const [gen, setGen] = useState(slot.genDurationSec ? String(slot.genDurationSec) : "");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isNew && !mobile) nameRef.current?.focus(); }, [isNew, mobile]);

  const hasVersions = !isNew && board.versionsOf(project, slot).length > 0;
  const use = isNew ? undefined : storyRefs.slotUse(b, slot.id);
  // V2-SB-136: a state keeps its base's type and aspect; an asset with states stays image-like.
  const stateBase = slot.stateOf ? b.slots[slot.stateOf] : undefined;
  const hasStates = !isNew && storyRefs.statesOf(b, slot.id).length > 0;
  const typeLocked = !!use?.clipOf.length || !!stateBase;
  const types = storyRefs.SLOT_TYPES.filter((t) => (!hasVersions || board.kindForSlot(t.id) === board.kindForSlot(slot.type)) && (!hasStates || story.STATEFUL_ASSET_TYPES.includes(t.id)));
  const choices = storyRefs.referenceChoices(b, slot.id);
  const lastFrame = slot.source.type === "lastFrame" ? slot.source.shotId : undefined;
  const nameOk = !!name.trim();
  const aspectOk = ASPECT.test(aspect.trim());
  // V2-SB-133: a video asset's generate length (empty = not set).
  const genN = Number(gen.trim().replace(",", "."));
  const genOk = type !== "video" || !gen.trim() || (Number.isFinite(genN) && genN >= 0.5 && genN <= 120);
  const layerSec = isNew ? undefined : board.slotLayerSec(b, slot.id);
  const ok = nameOk && aspectOk && genOk;
  const block = isNew ? undefined : storyRefs.slotDeleteBlock(b, slot.id);

  const save = () => {
    if (!ok) return;
    onSave({ name, type, aspect: aspect.trim(), prompt, notes, references, refRoles, qa: qa.filter((q) => q.text.trim()), ...(lastFrame ? {} : { source }), ...(type === "video" ? { genDurationSec: gen.trim() ? genN : null } : {}) });
  };
  const label = isNew ? "New asset" : `Edit “${slot.name}”`;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    else if (e.key === "Escape" && !mobile) { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };
  const toggleRef = (id: string) => setReferences(references.includes(id) ? references.filter((x) => x !== id) : [...references, id]);
  const usedIn = use ? [...new Set([...use.shots, ...use.clipOf, ...use.layerOf])] : [];

  return (
    <Panel mobile={mobile} label={label} onDone={() => (ok ? save() : onCancel())} className="v2-sb-editor v2-sb-slot-editor"
      extra={<button type="button" className="v2-btn v2-sb-btn" onClick={onCancel}>Cancel</button>}>
      <form className="v2-sb-detail-body v2-sb-form" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={onKey} aria-label={label}>
        {!mobile && (
          <div className="v2-sb-detail-head"><Ic g="✎" size={18} /><h3>{label}</h3>
            <button type="button" className="v2-btn v2-sb-btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="v2-btn v2-sb-btn primary" disabled={!ok} title="Save (⌘/Ctrl+Enter)">Save</button>
          </div>
        )}
        <label className="v2-sb-field">Name<input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The keeper" maxLength={80} aria-invalid={!nameOk} /></label>
        {!nameOk && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> Give the asset a name.</p>}
        <div className="v2-sb-row">
          <label className="v2-sb-field grow">Type
            <select value={type} disabled={typeLocked} onChange={(e) => setType(e.target.value as AssetSlot["type"])}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          </label>
          <label className="v2-sb-field len">Aspect<input value={aspect} onChange={(e) => setAspect(e.target.value)} placeholder="16:9" aria-invalid={!aspectOk} inputMode="text" disabled={!!stateBase} /></label>
        </div>
        {stateBase ? <p className="v2-hint" data-testid="state-editor-note">A state of “{stateBase.name}”: its type and aspect follow that asset, and it is always made from it (Image 1).</p>
          : typeLocked ? <p className="v2-hint">It is the clip of shot {use!.clipOf.map((s) => b.order.indexOf(s) + 1).join(", ")}, so its type stays.</p>
          : hasVersions && <p className="v2-hint">It has versions, so it can only change to a type of the same media.</p>}
        {!aspectOk && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> Aspect looks like 16:9, 9:16 or 2.39:1.</p>}
        {type === "video" && (
          <>
            <label className="v2-sb-field len" title="The length to ask the video model for, when its layers use less (e.g. 6 s for a 2 s overlay). Longer uploads are offered a trim.">Generate (s)
              <input value={gen} onChange={(e) => setGen(e.target.value)} inputMode="decimal" placeholder="any" aria-invalid={!genOk} aria-describedby="v2-sb-slotgen-hint" />
            </label>
            {genOk
              ? <p className="v2-hint" id="v2-sb-slotgen-hint">{layerSec ? `Its layers use ${Math.round(layerSec * 100) / 100} s; pick that part when you upload, or set each layer's in point.` : "The length to generate. A longer upload is offered a trim to the length its layers use."}</p>
              : <p className="v2-sb-err" id="v2-sb-slotgen-hint" role="alert"><Ic g="alert" size={14} /> Generate length must be 0.5–120 seconds, or empty.</p>}
          </>
        )}

        {lastFrame
          ? <p className="v2-hint" role="note"><Ic g="link" size={12} /> Taken from the last frame of shot {b.order.indexOf(lastFrame) + 1}.</p>
          : (
            <fieldset className="v2-sb-field">
              <legend>Made by</legend>
              <div className="v2-sb-seg" role="radiogroup" aria-label="Made by">
                <button type="button" role="radio" aria-checked={source === "generate"} className={source === "generate" ? "on" : ""} onClick={() => setSource("generate")}><Ic g="anim" size={15} /> Generate</button>
                <button type="button" role="radio" aria-checked={source === "upload"} className={source === "upload" ? "on" : ""} onClick={() => setSource("upload")}><Ic g="⇪" size={15} /> Upload</button>
              </div>
            </fieldset>
          )}
        <label className="v2-sb-field">{source === "generate" && !lastFrame ? "Prompt" : "Prompt (optional)"}<textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What your AI tool should make" /></label>

        {choices.length > 0 && (
          <fieldset className="v2-sb-field">
            <legend>Made from</legend>
            <div className="v2-sb-chips" role="group" aria-label="Made from">
              {choices.map((c) => <button type="button" key={c.id} aria-pressed={references.includes(c.id)} className={references.includes(c.id) ? "on" : ""} disabled={c.id === stateBase?.id} title={c.id === stateBase?.id ? "A state is always made from its base" : undefined} onClick={() => toggleRef(c.id)}>{c.name}</button>)}
            </div>
            {references.some((id) => b.slots[id]) && (
              <ol className="v2-sb-editlist v2-sb-refroles" aria-label="How to use each image">
                {references.filter((id) => b.slots[id]).map((id, i) => {
                  const r = b.slots[id];
                  const auto = storyRefs.ASSET_ROLE_LABEL[storyRefs.inferredAssetRole(r)];
                  return (
                    <li key={id}>
                      <label className="v2-sb-field grow">Image {i + 1} · {r.name}
                        <select value={refRoles[id]?.role ?? ""} onChange={(e) => {
                          const role = e.target.value as story.ReferenceRole | "";
                          const { role: _old, ...rest } = refRoles[id] ?? {};
                          setRefRoles({ ...refRoles, [id]: role ? { ...rest, role } : rest });
                        }}>
                          <option value="">Auto ({auto})</option>
                          {story.ASSET_REFERENCE_ROLES.map((x) => <option key={x} value={x}>{storyRefs.ASSET_ROLE_LABEL[x]}</option>)}
                        </select>
                      </label>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="v2-hint">Give these to your AI tool with the prompt, in this order. When one changes, this asset is flagged.</p>
          </fieldset>
        )}

        <fieldset className="v2-sb-field">
          <legend>Checks</legend>
          <ul className="v2-sb-editlist">
            {qa.map((q, i) => (
              <li key={q.id}>
                <input value={q.text} aria-label={`Check ${i + 1}`} onChange={(e) => setQa(qa.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))} placeholder="e.g. Same coat as shot 1" />
                <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove check ${i + 1}`} onClick={() => setQa(qa.filter((x) => x.id !== q.id))}><Ic g="✕" size={16} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="v2-btn v2-sb-btn" onClick={() => setQa([...qa, { id: storyEdit.newCheckId(slot.id, qa), text: "" }])}><Ic g="+" size={16} /> Add check</button>
        </fieldset>
        <label className="v2-sb-field">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember" /></label>

        {mobile && <button type="submit" className="v2-btn primary v2-sb-btn v2-sb-wide" disabled={!ok}>{isNew ? "Add asset" : "Save"}</button>}
        {onDelete && !isNew && (
          <>
            <button type="button" className="v2-btn v2-sb-btn v2-sb-danger v2-sb-wide" disabled={!!block} aria-describedby={block ? "v2-sb-slot-block" : undefined} onClick={onDelete}><Ic g="🗑" size={16} /> Delete asset</button>
            {block ? <p className="v2-hint" id="v2-sb-slot-block">{block}</p>
              : usedIn.length > 0 && <p className="v2-hint">Used by shot {usedIn.map((s) => b.order.indexOf(s) + 1).join(", ")}.</p>}
          </>
        )}
      </form>
    </Panel>
  );
}
