/**
 * Shot and connection editors (V2-CUT-02). Phones: a bottom sheet with Cancel and ✓ (saves), like CapCut.
 * Desktop: the side panel with Cancel / Save (⌘/Ctrl+Enter). A save is one undo step.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { board, storyEdit, storyRefs, story, type AssetSlot, type Project, type QaCheck, type Shot } from "../../domain";
type StoryAssetType = AssetSlot["type"];
import { getPreset, listPresets, parsePresetRef } from "../../registry";
import { Ic } from "../Icon";
import { Sheet } from "../Sheet";
import { TYPE_ICON } from "./BoardView";
import { BackgroundEditor, LayersEditor } from "./ShotLayers";

type Render = "ai" | "html" | "still";
const RENDERS: { id: Render; label: string; icon: string; hint: string }[] = [
  { id: "ai", label: "AI video", icon: "▭", hint: "Generate the clip in your AI tool from the clip prompt." },
  { id: "html", label: "HTML", icon: "</>", hint: "Plays an HTML asset (title cards, charts, UI) for the shot's length." },
  { id: "still", label: "Still", icon: "image", hint: "Shows an image asset, or a colour or gradient, for the shot's length." },
];

/** A side panel on desktop, a bottom sheet on phones. */
export function Panel({ mobile, label, onDone, extra, children, className = "" }: { mobile: boolean; label: string; onDone: () => void; extra?: ReactNode; children: ReactNode; className?: string }) {
  return mobile
    ? <Sheet label={label} onClose={onDone} className={`v2-sb-sheet ${className}`} initial={2} extra={extra}>{children}</Sheet>
    : <aside className={`v2-sb-detail ${className}`} role="dialog" aria-label={label}>{children}</aside>;
}

const sec = (x: number) => `${Math.round(x * 100) / 100}`;
const effectName = (id: string) => { const r = parsePresetRef(id); return (r && getPreset("videoEffect", r.id)?.name) || id; };

export function ShotEditor({ project, shot, number, isNew, mobile, onSave, onCancel, onDelete }: {
  project: Project; shot: Shot; number: number; isNew?: boolean; mobile: boolean;
  onSave: (patch: storyEdit.ShotPatch) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const b = project.storyboard!;
  const [title, setTitle] = useState(isNew ? "" : shot.title);
  const [dur, setDur] = useState(sec(shot.durationSec));
  const [gen, setGen] = useState(shot.genDurationSec ? sec(shot.genDurationSec) : "");
  const [description, setDescription] = useState(shot.description);
  /** P16: a shot playing a shared video clip edits that clip's prompt (schema 3.1: prompts live on clips). */
  const sharedClip = !shot.render && shot.clipSlot ? b.slots[shot.clipSlot] : undefined;
  const clipInfo = board.shotClips(project)[shot.id];
  const affects = board.clipAffects(project, shot.id);
  const [prompt, setPrompt] = useState(sharedClip ? sharedClip.prompt : shot.prompt);
  const [inSec, setInSec] = useState(sec(shot.clipInSec ?? 0));
  const [camera, setCamera] = useState(shot.camera ?? "");
  const [dialogue, setDialogue] = useState(shot.dialogue ?? "");
  const [captions, setCaptions] = useState(!!shot.captions);
  const [qa, setQa] = useState<QaCheck[]>(shot.qa);
  const [render, setRender] = useState<Render>(shot.render ?? "ai");
  const [clipSlot, setClipSlot] = useState(shot.clipSlot && b.slots[shot.clipSlot]?.implicit !== "background" ? shot.clipSlot : "");
  const bgSlot = shot.clipSlot && b.slots[shot.clipSlot]?.implicit === "background" ? b.slots[shot.clipSlot] : undefined;
  // P2B (item 20): a still shot shows an image asset or a colour / gradient.
  const [stillMode, setStillMode] = useState<"image" | "color">(bgSlot ? "color" : "image");
  const [bg, setBg] = useState<story.StoryBackground>(bgSlot?.background ?? "#000000");
  const [layers, setLayers] = useState(shot.layers ?? []);
  const [effects, setEffects] = useState(shot.effects ?? []);
  const [refs, setRefs] = useState(() => shot.slotIds.filter((id) => id !== shot.clipSlot));
  const [pending, setPending] = useState<{ id: string; patch: storyRefs.SlotPatch }[]>([]);
  const [adding, setAdding] = useState<{ name: string; type: StoryAssetType; prompt: string }>();
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isNew && !mobile) titleRef.current?.focus(); }, [isNew, mobile]);
  /** The board plus assets created in this edit, for names and unique ids. */
  const withPending = useMemo(() => ({ ...b, slots: { ...b.slots, ...Object.fromEntries(pending.map((x) => [x.id, { id: x.id, name: x.patch.name ?? x.id, type: x.patch.type ?? "image" } as AssetSlot])) } }), [b, pending]);
  const refName = (id: string) => withPending.slots[id]?.name ?? id;
  const addable = Object.values(b.slots).filter((x) => !refs.includes(x.id) && x.id !== (render === "ai" ? undefined : clipSlot) && x.implicit !== "background");
  const addNew = () => {
    if (!adding?.name.trim()) return;
    const id = storyRefs.nextSlotId(withPending, adding.name);
    setPending([...pending, { id, patch: { name: adding.name.trim(), type: adding.type, prompt: adding.prompt } }]);
    setRefs([...refs, id]);
    setAdding(undefined);
  };

  const choices = useMemo(() => (render === "ai" ? [] : storyEdit.clipSlotsFor(b, render)), [b, render]);
  const useBg = render === "still" && stillMode === "color";
  const slotOk = render === "ai" || useBg || choices.some((s) => s.id === clipSlot);
  const n = Number(dur.replace(",", "."));
  const durOk = Number.isFinite(n) && n >= storyEdit.MIN_SHOT_SEC && n <= storyEdit.MAX_SHOT_SEC;
  const past = durOk ? storyEdit.partsPastEnd({ layers, effects }, n) : 0;
  const g = Number(gen.replace(",", "."));
  // V2-SB-121: optional length to generate (fixed-length models); empty = the shot length.
  const genOk = render !== "ai" || !gen.trim() || (Number.isFinite(g) && g <= storyEdit.MAX_SHOT_SEC && (!durOk || g >= n));
  const ok = durOk && slotOk && genOk;

  const patch = (): storyEdit.ShotPatch => ({
    title: title.trim() || (isNew ? "New shot" : shot.title), description, durationSec: n, ...(sharedClip && render === "ai" ? { clipPrompt: prompt, clipInSec: Number(inSec.replace(",", ".")) || 0 } : { prompt }), camera, dialogue, captions: captions && !!dialogue.trim(),
    ...(render === "ai" ? { genDurationSec: gen.trim() ? g : null } : {}),
    qa, layers, effects, render, ...(render !== "ai" ? { clipSlot } : {}), ...(render === "still" ? { background: useBg ? bg : null } : {}),
    slotIds: refs, ...(pending.length ? { newSlots: pending.filter((x) => refs.includes(x.id)) } : {}),
  });
  const save = () => { if (ok) onSave(patch()); };
  const label = isNew ? `New shot ${number}` : `Edit shot ${number}`;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    else if (e.key === "Escape" && !mobile) { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };
  const pickRender = (r: Render) => {
    setRender(r);
    if (r !== "ai" && !storyEdit.clipSlotsFor(b, r).some((s) => s.id === clipSlot)) setClipSlot(storyEdit.clipSlotsFor(b, r)[0]?.id ?? "");
  };

  return (
    <Panel mobile={mobile} label={label} onDone={() => (ok ? save() : onCancel())} className="v2-sb-editor"
      extra={<button type="button" className="v2-btn v2-sb-btn" onClick={onCancel}>Cancel</button>}>
      <form className="v2-sb-detail-body v2-sb-form" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={onKey} aria-label={label}>
        {!mobile && (
          <div className="v2-sb-detail-head"><Ic g="✎" size={18} /><h3>{label}</h3>
            <button type="button" className="v2-btn v2-sb-btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="v2-btn v2-sb-btn primary" disabled={!ok} title="Save (⌘/Ctrl+Enter)">Save</button>
          </div>
        )}
        <div className="v2-sb-row">
          <label className="v2-sb-field grow">Title<input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isNew ? "New shot" : shot.title} maxLength={80} /></label>
          <label className="v2-sb-field len">Length (s)<input value={dur} onChange={(e) => setDur(e.target.value)} inputMode="decimal" aria-invalid={!durOk} aria-describedby="v2-sb-dur-hint" /></label>
          {render === "ai" && <label className="v2-sb-field len" title="For video models that only make fixed lengths (e.g. 8 s for a 5 s shot). Uploads are trimmed to the shot length.">Generate (s)<input value={gen} onChange={(e) => setGen(e.target.value)} inputMode="decimal" placeholder="same" aria-invalid={!genOk} aria-describedby="v2-sb-gen-hint" /></label>}
        </div>
        {!genOk && <p className="v2-sb-err" id="v2-sb-gen-hint" role="alert"><Ic g="alert" size={14} /> Generate length must be at least the shot length and at most {storyEdit.MAX_SHOT_SEC} seconds, or empty.</p>}
        {!durOk && <p className="v2-sb-err" id="v2-sb-dur-hint" role="alert"><Ic g="alert" size={14} /> Length must be {storyEdit.MIN_SHOT_SEC}–{storyEdit.MAX_SHOT_SEC} seconds.</p>}
        {past > 0 && <p className="v2-hint" role="note"><Ic g="⚠" size={12} /> {past} layer{past > 1 ? "s or effects run" : " or effect runs"} past {sec(n)} s; {past > 1 ? "they" : "it"} will be shortened to fit.</p>}

        <fieldset className="v2-sb-field">
          <legend>Clip made as</legend>
          <div className="v2-sb-seg" role="radiogroup" aria-label="Clip made as">
            {RENDERS.map((r) => <button type="button" key={r.id} role="radio" aria-checked={render === r.id} className={render === r.id ? "on" : ""} onClick={() => pickRender(r.id)}><Ic g={r.icon} size={15} /> {r.label}</button>)}
          </div>
          <p className="v2-hint">{RENDERS.find((r) => r.id === render)!.hint}</p>
          {render === "still" && (
            <div className="v2-sb-seg" role="radiogroup" aria-label="Still picture">
              <button type="button" role="radio" aria-checked={stillMode === "image"} className={stillMode === "image" ? "on" : ""} onClick={() => setStillMode("image")}><Ic g="image" size={15} /> Image asset</button>
              <button type="button" role="radio" aria-checked={stillMode === "color"} className={stillMode === "color" ? "on" : ""} onClick={() => setStillMode("color")}><Ic g="template" size={15} /> Colour / gradient</button>
            </div>
          )}
          {useBg && <BackgroundEditor value={bg} onChange={setBg} />}
          {render !== "ai" && !useBg && (choices.length
            ? <label className="v2-sb-field">{render === "html" ? "HTML asset" : "Image asset"}
                <select value={clipSlot} onChange={(e) => setClipSlot(e.target.value)}>{choices.map((s) => <option key={s.id} value={s.id}>{s.name}{board.versionsOf(project, s).length ? "" : " (no version yet)"}</option>)}</select>
              </label>
            : <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> This storyboard has no {render === "html" ? "HTML" : "image"} asset to use yet.</p>)}
          {render !== "ai" && shot.render === undefined && shot.assetId && <p className="v2-hint">The shot’s AI clip versions are kept; switch back to AI video to use them again.</p>}
        </fieldset>

        {sharedClip && render === "ai" && clipInfo && <label className="v2-sb-field">In point in {clipInfo.label} (s)<input type="text" inputMode="decimal" value={inSec} onChange={(e) => setInSec(e.target.value)} aria-label={`In point in ${clipInfo.label} (seconds)`} /></label>}
        {sharedClip && render === "ai" && affects && prompt !== sharedClip.prompt && <p className="v2-sb-warnbox v2-sb-clipwarn" role="alert" data-testid="clip-affects"><Ic g="⚠" size={14} /> {affects}</p>}
        <label className="v2-sb-field">{render === "ai" ? (sharedClip && clipInfo ? `Clip prompt · ${clipInfo.label}${affects ? ` (${affects})` : ""}` : "Clip prompt") : "Clip prompt (optional)"}<textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={render === "ai" ? "What the AI video should show" : "Notes for making the clip"} /></label>
        <fieldset className="v2-sb-field">
          <legend>Reference assets</legend>
          {refs.length > 0 && (
            <ul className="v2-sb-editlist" aria-label="Reference assets">
              {refs.map((id) => {
                const t = withPending.slots[id]?.type;
                const pin = !pending.some((x) => x.id === id) && storyRefs.pinLabel(project, shot, id);
                return (
                  <li key={id}>
                    <span className="v2-sb-editlist-text"><Ic g={TYPE_ICON[t ?? "image"] ?? "image"} size={14} /> {refName(id)}{pending.some((x) => x.id === id) ? " · new" : ""}{pin ? ` · pinned ${pin}` : ""}</span>
                    <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove reference ${refName(id)}`} onClick={() => setRefs(refs.filter((x) => x !== id))}><Ic g="✕" size={16} /></button>
                  </li>
                );
              })}
            </ul>
          )}
          {adding ? (
            <div className="v2-sb-newref" role="group" aria-label="New asset">
              <div className="v2-sb-row">
                <label className="v2-sb-field grow">Name<input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. Keeper's coat" maxLength={60}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(undefined); } }} /></label>
                <label className="v2-sb-field">Type<select value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value as StoryAssetType })}>{storyRefs.SLOT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              </div>
              <label className="v2-sb-field">Prompt<textarea rows={2} value={adding.prompt} onChange={(e) => setAdding({ ...adding, prompt: e.target.value })} placeholder="How to generate it (optional)" /></label>
              <div className="v2-sb-actions">
                <button type="button" className="v2-btn v2-sb-btn" onClick={() => setAdding(undefined)}>Cancel</button>
                <button type="button" className="v2-btn v2-sb-btn primary" disabled={!adding.name.trim()} onClick={addNew}><Ic g="+" size={16} /> Add asset</button>
              </div>
            </div>
          ) : (
            <select className="v2-sb-addref" aria-label="Add a reference asset" value="" onChange={(e) => {
              const v = e.target.value;
              if (v === "__new") setAdding({ name: "", type: "image", prompt: "" });
              else if (v) setRefs([...refs, v]);
            }}>
              <option value="">+ Add reference…</option>
              {addable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="__new">New asset…</option>
            </select>
          )}
          <p className="v2-hint">The characters, places, props or frames you give the AI tool with this shot. Pin a version for this shot from its details.</p>
        </fieldset>

        <label className="v2-sb-field">Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happens in this shot" /></label>
        <label className="v2-sb-field">Camera<input value={camera} onChange={(e) => setCamera(e.target.value)} placeholder="e.g. slow push-in, low angle" /></label>
        <label className="v2-sb-field">Dialogue<textarea rows={2} value={dialogue} onChange={(e) => setDialogue(e.target.value)} placeholder="Spoken lines. One per line as NAME: words, or NAME (O.S.): words for a voice heard off screen" /></label>
        {story.hasOffscreenMark(dialogue) && <p className="v2-hint" data-testid="dialogue-offscreen-hint">(O.S.) lines are heard, not seen: the clip prompt tells the model nobody in frame says them (no lip-sync).</p>}
        <label className="v2-sb-check"><input type="checkbox" checked={captions && !!dialogue.trim()} disabled={!dialogue.trim()} onChange={(e) => setCaptions(e.target.checked)} /> Add the dialogue as captions when sent to the timeline</label>

        <fieldset className="v2-sb-field">
          <legend>Checks</legend>
          <ul className="v2-sb-editlist">
            {qa.map((q, i) => (
              <li key={q.id}>
                <input value={q.text} aria-label={`Check ${i + 1}`} onChange={(e) => setQa(qa.map((x) => (x.id === q.id ? { ...x, text: e.target.value } : x)))} placeholder="e.g. The lantern is lit" />
                <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove check ${i + 1}`} onClick={() => setQa(qa.filter((x) => x.id !== q.id))}><Ic g="✕" size={16} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="v2-btn v2-sb-btn" onClick={() => setQa([...qa, { id: storyEdit.newCheckId(shot.id, qa), text: "" }])}><Ic g="+" size={16} /> Add check</button>
        </fieldset>

        <LayersEditor b={b} layers={layers} effects={effects} dur={n} onLayers={setLayers} onEffects={setEffects} effectName={effectName} />
        {mobile && <button type="submit" className="v2-btn primary v2-sb-btn v2-sb-wide" disabled={!ok}>{isNew ? "Add shot" : "Save"}</button>}
        {onDelete && !isNew && <button type="button" className="v2-btn v2-sb-btn v2-sb-danger v2-sb-wide" onClick={onDelete}><Ic g="🗑" size={16} /> Delete shot</button>}
      </form>
    </Panel>
  );
}

const KINDS: { id: story.ConnectionKind; label: string; hint: string }[] = [
  { id: "cut", label: "Cut", hint: "A plain cut to the next shot." },
  { id: "continuity", label: "Continuity", hint: "The next shot continues this one (often from its last frame)." },
  { id: "match", label: "Match cut", hint: "Cut on a matching shape, motion or framing." },
];
const DURATIONS = [0.3, 0.5, 0.8, 1, 1.5, 2];

/** How shot `from` leads into the next shot: kind, transition and a note. Each change is applied (and undoable) right away. */
export function ConnectionEditor({ project, from, to, mobile, onChange, onClose }: {
  project: Project; from: string; to: string; mobile: boolean; onChange: (patch: storyEdit.ConnectionPatch) => void; onClose: () => void;
}) {
  const b = project.storyboard!;
  const c = storyEdit.connectionBetween(b, from, to);
  const [note, setNote] = useState(c?.note ?? "");
  useEffect(() => setNote(c?.note ?? ""), [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const no = (id: string) => b.order.indexOf(id) + 1;
  const kind = c?.kind ?? "cut";
  const tr = c?.transition;
  const trId = tr ? parsePresetRef(tr.preset)?.id ?? tr.preset : "";
  const durSec = typeof tr?.params?.durationSec === "number" ? tr.params.durationSec : story.DEFAULT_TRANSITION_SEC;
  const presets = listPresets("transition");
  const label = `Shot ${no(from)} → shot ${no(to)}`;
  const commitNote = () => { if (note.trim() !== (c?.note ?? "")) onChange({ note }); };
  return (
    <Panel mobile={mobile} label={label} onDone={() => { commitNote(); onClose(); }} className="v2-sb-conn-editor">
      <div className="v2-sb-detail-body v2-sb-form">
        {!mobile && <div className="v2-sb-detail-head"><Ic g="link" size={18} /><h3>{label}</h3><button className="v2-icon v2-sb-icon" aria-label="Close" title="Close (Esc)" onClick={() => { commitNote(); onClose(); }}><Ic g="✕" size={18} /></button></div>}
        <fieldset className="v2-sb-field">
          <legend>Connection</legend>
          <div className="v2-sb-seg" role="radiogroup" aria-label="Connection">
            {KINDS.map((k) => <button type="button" key={k.id} role="radio" aria-checked={kind === k.id} className={kind === k.id ? "on" : ""} onClick={() => onChange({ kind: k.id })}>{k.label}</button>)}
          </div>
          <p className="v2-hint">{KINDS.find((k) => k.id === kind)!.hint}</p>
        </fieldset>
        <fieldset className="v2-sb-field">
          <legend>Transition</legend>
          <div className="v2-sb-chips" role="radiogroup" aria-label="Transition">
            <button type="button" role="radio" aria-checked={!tr} className={!tr ? "on" : ""} onClick={() => onChange({ transition: null })}>None</button>
            {presets.map((d) => <button type="button" key={d.id} role="radio" aria-checked={trId === d.id} className={trId === d.id ? "on" : ""} title={d.description} onClick={() => onChange({ transition: { preset: d.id, params: { ...(tr?.params ?? {}), durationSec: durSec } } })}>{d.preview?.icon ? `${d.preview.icon} ` : ""}{d.name}</button>)}
          </div>
          {tr && (
            <>
              <div className="v2-sb-chips" role="radiogroup" aria-label="Transition length">
                {DURATIONS.map((d) => <button type="button" key={d} role="radio" aria-checked={durSec === d} className={durSec === d ? "on" : ""} onClick={() => onChange({ transition: { ...tr, params: { ...(tr.params ?? {}), durationSec: d } } })}>{d} s</button>)}
              </div>
              <p className="v2-hint">Added on the timeline by Send when both clips sit next to each other; it is capped at half the shorter clip.</p>
            </>
          )}
        </fieldset>
        <label className="v2-sb-field">Note<input value={note} onChange={(e) => setNote(e.target.value)} onBlur={commitNote} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitNote(); } }} placeholder="e.g. Same light, keeper turns left" maxLength={200} /></label>
      </div>
    </Panel>
  );
}

export interface SheetAction { label: string; icon: string; onSelect: () => void; danger?: boolean; disabled?: boolean }

/** Phone action sheet (long-press or ⋯ on a shot): big rows, Cancel at the bottom. */
export function ActionSheet({ title, actions, onClose }: { title: string; actions: SheetAction[]; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="v2-sb-actsheet-backdrop" onClick={onClose}>
      <div className="v2-sb-actsheet" role="menu" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <p className="v2-sb-actsheet-title">{title}</p>
        {actions.map((a, i) => (
          <button key={a.label} ref={i === 0 ? first : undefined} role="menuitem" className={a.danger ? "danger" : ""} disabled={a.disabled} onClick={() => { onClose(); a.onSelect(); }}><Ic g={a.icon} size={20} /> {a.label}</button>
        ))}
        <button className="v2-sb-actsheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
