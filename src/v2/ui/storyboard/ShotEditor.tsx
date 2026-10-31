/**
 * Shot and connection editors (V2-CUT-02). Phones: a bottom sheet with Cancel and ✓ (saves), like CapCut.
 * Desktop: the side panel with Cancel / Save (⌘/Ctrl+Enter). A save is one undo step.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { board, clipSource, storyEdit, storyRefs, story, type AssetSlot, type Project, type QaCheck, type Shot } from "../../domain";
type StoryAssetType = AssetSlot["type"];
import { getPreset, listPresets, parsePresetRef } from "../../registry";
import { Ic } from "../Icon";
import { Sheet } from "../Sheet";
import { Thumb, TYPE_ICON } from "./BoardView";
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

export function ShotEditor({ project, shot, number, isNew, mobile, onSave, onCancel, onDelete, thumbs = {}, initialReuse }: {
  project: Project; shot: Shot; number: number; isNew?: boolean; mobile: boolean;
  /** P17: version thumbnails for the clip picker. */ thumbs?: Record<string, string>;
  /** P17: open with "Reuse clip" picked and this clip chosen (`slot:<id>` or `shot:<id>`), e.g. from "New shot using this clip". */ initialReuse?: string;
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
  /** P17: Clip source. "New clip" makes the shot's own clip from its prompt; "Reuse clip" plays an existing clip. */
  const clipList = useMemo(() => clipSource.clipChoices(project, shot.id), [project, shot.id]);
  const startKey = initialReuse ?? (sharedClip ? `slot:${sharedClip.id}` : "");
  const [source, setSource] = useState<"own" | "reuse">(startKey ? "reuse" : "own");
  const [pick, setPick] = useState(startKey);
  const [confirmReuse, setConfirmReuse] = useState(false);
  const [makeShared, setMakeShared] = useState(false);
  const [lenAuto, setLenAuto] = useState(false);
  const ownHasClip = !isNew && !shot.render && !shot.clipSlot && (!!shot.prompt.trim() || board.versionsOf(project, shot).length > 0);
  const shareWhy = !isNew ? clipSource.shareBlock(b, shot) : "Save the shot first.";
  const picked = clipList.find((c) => c.key === pick);
  const [prompt, setPrompt] = useState(shot.prompt);
  const [inSec, setInSec] = useState(sec(shot.clipInSec ?? 0));
  const [camera, setCamera] = useState(shot.camera ?? "");
  const [dialogue, setDialogue] = useState(shot.dialogue ?? "");
  const [captions, setCaptions] = useState(!!shot.captions);
  const [qa, setQa] = useState<QaCheck[]>(shot.qa);
  const [render, setRender] = useState<Render>(shot.render ?? "ai");
  const reusing = render === "ai" && source === "reuse";
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
  const genOk = render !== "ai" || reusing || !gen.trim() || (Number.isFinite(g) && g <= storyEdit.MAX_SHOT_SEC && (!durOk || g >= n));
  const pickOk = !reusing || (!!picked && !picked.blocked);
  const inN = Number(inSec.replace(",", "."));
  const inOk = !reusing || (Number.isFinite(inN) && inN >= 0);
  const ok = durOk && slotOk && genOk && pickOk && inOk;

  const patch = (): storyEdit.ShotPatch => ({
    title: title.trim() || (isNew ? "New shot" : shot.title), description, durationSec: n, ...(reusing ? { clipInSec: inN || 0, ...(picked && picked.key === `slot:${sharedClip?.id}` ? {} : { clipSource: { reuse: pick, inSec: inN || 0 } }) }
      : render === "ai" && sharedClip ? { clipSource: { own: true as const }, prompt } : render === "ai" && makeShared ? { clipPrompt: prompt, clipSource: { share: true as const } } : { prompt }), camera, dialogue, captions: captions && !!dialogue.trim(),
    ...(render === "ai" && !reusing ? { genDurationSec: gen.trim() ? g : null } : {}),
    qa, layers, effects, render, ...(render !== "ai" ? { clipSlot } : {}), ...(render === "still" ? { background: useBg ? bg : null } : {}),
    slotIds: refs, ...(pending.length ? { newSlots: pending.filter((x) => refs.includes(x.id)) } : {}),
  });
  const save = () => {
    if (!ok) return;
    if (reusing && ownHasClip && !confirmReuse) { setConfirmReuse(true); return; }
    onSave(patch());
  };
  const choose = (key: string) => {
    setPick(key);
    const c = clipList.find((x) => x.key === key);
    if (c?.durationSec && (isNew || lenAuto) && c.durationSec >= storyEdit.MIN_SHOT_SEC) { setDur(sec(Math.min(c.durationSec, storyEdit.MAX_SHOT_SEC))); setLenAuto(true); }
    setInSec("0");
  };
  /** Moving the in point keeps an automatic length inside the clip. */
  const moveIn = (d: number) => {
    const v = Math.max(0, Math.round(((Number(inSec.replace(",", ".")) || 0) + d) * 100) / 100);
    setInSec(sec(v));
    if (lenAuto && picked?.durationSec && picked.durationSec - v >= storyEdit.MIN_SHOT_SEC) setDur(sec(Math.min(picked.durationSec - v, storyEdit.MAX_SHOT_SEC)));
  };
  const step = (set: (v: string) => void, v: string, d: number, min: number) => set(sec(Math.max(min, Math.round(((Number(v.replace(",", ".")) || 0) + d) * 100) / 100)));
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
          {render === "ai" && !reusing && <label className="v2-sb-field len" title="For video models that only make fixed lengths (e.g. 8 s for a 5 s shot). Uploads are trimmed to the shot length.">Generate (s)<input value={gen} onChange={(e) => setGen(e.target.value)} inputMode="decimal" placeholder="same" aria-invalid={!genOk} aria-describedby="v2-sb-gen-hint" /></label>}
        </div>
        {!genOk && <p className="v2-sb-err" id="v2-sb-gen-hint" role="alert"><Ic g="alert" size={14} /> Generate length must be at least the shot length and at most {storyEdit.MAX_SHOT_SEC} seconds, or empty.</p>}
        {!durOk && <p className="v2-sb-err" id="v2-sb-dur-hint" role="alert"><Ic g="alert" size={14} /> Length must be {storyEdit.MIN_SHOT_SEC}–{storyEdit.MAX_SHOT_SEC} seconds.</p>}
        {past > 0 && <p className="v2-hint" role="note"><Ic g="⚠" size={12} /> {past} layer{past > 1 ? "s or effects run" : " or effect runs"} past {sec(n)} s; {past > 1 ? "they" : "it"} will be shortened to fit.</p>}

        <fieldset className="v2-sb-field">
          <legend>Clip made as</legend>
          <div className="v2-sb-seg" role="radiogroup" aria-label="Clip made as">
            {RENDERS.map((r) => <button type="button" key={r.id} role="radio" aria-checked={render === r.id} className={render === r.id ? "on" : ""} onClick={() => pickRender(r.id)}><Ic g={r.icon} size={15} /> {r.label}</button>)}
          </div>
          <p className="v2-hint">{reusing ? "Plays part of an existing AI video clip." : RENDERS.find((r) => r.id === render)!.hint}</p>
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

        {render === "ai" && (
          <fieldset className="v2-sb-field" data-testid="clip-source">
            <legend>Clip source</legend>
            <div className="v2-sb-seg v2-sb-clipsrc" role="radiogroup" aria-label="Clip source">
              <button type="button" role="radio" aria-checked={source === "own"} className={source === "own" ? "on" : ""} onClick={() => { setSource("own"); setConfirmReuse(false); }}><Ic g="✎" size={15} /> New clip</button>
              <button type="button" role="radio" aria-checked={source === "reuse"} className={source === "reuse" ? "on" : ""} onClick={() => setSource("reuse")}><Ic g="⧉" size={15} /> Reuse clip</button>
            </div>
            <p className="v2-hint">{source === "own" ? "This shot gets its own clip, generated from the clip prompt below." : isNew ? "Use from another shot: this shot plays part of an existing clip, so nothing new is generated." : "This shot plays part of an existing clip, so nothing new is generated."}</p>
            {source === "own" && sharedClip && clipInfo && <p className="v2-hint" role="note" data-testid="clip-unlink-note">Saving gives this shot its own clip again; {clipInfo.label} stays for the shots that still use it.</p>}
            {source === "reuse" && (clipList.length
              ? <ul className="v2-sb-clippick" role="listbox" aria-label="Clips to reuse" data-testid="clip-picker">
                  {clipList.map((c) => {
                    const src = thumbs[board.selectedOf(project, c.owner) ?? ""];
                    return (
                      <li key={c.key} role="option" aria-selected={pick === c.key} aria-disabled={!!c.blocked}>
                        <button type="button" className={pick === c.key ? "on" : ""} disabled={!!c.blocked} onClick={() => choose(c.key)} title={c.blocked}>
                          <Thumb src={src} icon="▭" count={1} />
                          <span className="v2-sb-clippick-txt">
                            <b>{c.label}</b> <span>{c.name}</span>
                            <small>{c.firstShotNo ? `First used in Shot ${c.firstShotNo}` : "Not used by a shot yet"} · <span className={`v2-sb-clipstate ${c.generated ? "done" : "waiting"}`}>{c.generated ? "Generated" : "Not generated"}</span>{c.durationSec ? ` · ${sec(c.durationSec)} s` : ""}</small>
                            {c.blocked && <small className="v2-sb-err">{c.blocked}</small>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              : <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> There is no clip to reuse yet. Make a new clip first.</p>)}
            {reusing && clipList.length > 0 && !picked && <p className="v2-hint" role="note">Pick the clip this shot plays.</p>}
            {reusing && picked && (
              <div className="v2-sb-row v2-sb-cliptrim" data-testid="clip-trim">
                <div className="v2-sb-field"><span>In point in {picked.label} (s)</span>
                  <div className="v2-sb-stepper">
                    <button type="button" className="v2-btn v2-sb-btn" aria-label="In point earlier" onClick={() => moveIn(-0.5)}>−</button>
                    <input type="text" inputMode="decimal" value={inSec} onChange={(e) => setInSec(e.target.value)} aria-label={`In point in ${picked.label} (seconds)`} aria-invalid={!inOk} />
                    <button type="button" className="v2-btn v2-sb-btn" aria-label="In point later" onClick={() => moveIn(0.5)}>+</button>
                  </div>
                </div>
                <div className="v2-sb-field"><span>Duration (s)</span>
                  <div className="v2-sb-stepper">
                    <button type="button" className="v2-btn v2-sb-btn" aria-label="Shorter" onClick={() => { setLenAuto(false); step(setDur, dur, -0.5, storyEdit.MIN_SHOT_SEC); }}>−</button>
                    <input type="text" inputMode="decimal" value={dur} onChange={(e) => { setLenAuto(false); setDur(e.target.value); }} aria-label="Shot duration (seconds)" aria-invalid={!durOk} />
                    <button type="button" className="v2-btn v2-sb-btn" aria-label="Longer" onClick={() => { setLenAuto(false); step(setDur, dur, 0.5, storyEdit.MIN_SHOT_SEC); }}>+</button>
                  </div>
                </div>
                {picked.durationSec !== undefined && inOk && durOk && inN + n > picked.durationSec + 0.05 && <p className="v2-hint" role="note"><Ic g="⚠" size={12} /> Plays past the end of {picked.label} ({sec(picked.durationSec)} s).</p>}
              </div>
            )}
            {confirmReuse && (
              <div className="v2-sb-warnbox" role="alertdialog" aria-label="Replace this shot's clip" data-testid="reuse-confirm">
                <p><Ic g="⚠" size={14} /> This shot's own clip prompt is removed and the shot plays {picked?.label ?? "the chosen clip"} instead. Its clip versions stay in the media library; Undo brings everything back.</p>
                <div className="v2-sb-row"><button type="button" className="v2-btn v2-sb-btn" onClick={() => setConfirmReuse(false)}>Keep own clip</button><button type="button" className="v2-btn v2-sb-btn primary" onClick={() => onSave(patch())}>Reuse clip</button></div>
              </div>
            )}
            {source === "own" && !sharedClip && !isNew && (
              <label className="v2-sb-check" title={shareWhy}><input type="checkbox" checked={makeShared} disabled={!!shareWhy} onChange={(e) => setMakeShared(e.target.checked)} data-testid="make-shareable" /> Make this shot's clip shareable{shareWhy ? ` (${shareWhy})` : " so other shots can reuse it"}</label>
            )}
          </fieldset>
        )}
        {!reusing && <label className="v2-sb-field">{render === "ai" ? "Clip prompt" : "Clip prompt (optional)"}<textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={render === "ai" ? "What the AI video should show" : "Notes for making the clip"} /></label>}
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
