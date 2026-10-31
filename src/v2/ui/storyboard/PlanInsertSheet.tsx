/**
 * P21 "Insert shot after" → "Plan with AI": describe the last shot, copy a planning prompt for any AI chat, paste its
 * {"schema":"3.1-insert"} answer, review what will be inserted (new clips vs reused ones), then insert in one undo step.
 * Phones: a bottom sheet; desktop: the side panel.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { roundtrip, storyInsert, type Project, type StoryIssue } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { SeriesLike } from "../../domain";
import { Ic } from "../Icon";
import { Panel } from "./ShotEditor";

type Step = "describe" | "prompt" | "paste" | "preview";
const STEPS: { id: Step; label: string }[] = [
  { id: "describe", label: "Describe" }, { id: "prompt", label: "Prompt" }, { id: "paste", label: "Paste" }, { id: "preview", label: "Preview" },
];

function Issues({ list, kind }: { list: StoryIssue[]; kind: "error" | "warning" }) {
  if (!list.length) return null;
  return (
    <div className={`v2-pi-issues ${kind}`} role={kind === "error" ? "alert" : "note"} aria-label={kind === "error" ? "Errors" : "Warnings"}>
      <p><Ic g={kind === "error" ? "alert" : "⚠"} size={14} /> {list.length} {kind}{list.length === 1 ? "" : "s"}</p>
      <ul>{list.slice(0, 30).map((i, n) => <li key={n}>{i.path && <code>{i.path}</code>} {i.message}</li>)}</ul>
    </div>
  );
}

export function PlanInsertSheet({ engine, project, shotId, mobile, series, onDone }: {
  engine: Engine; project: Project; shotId: string; mobile: boolean; series?: SeriesLike;
  /** Closed; with a message (and the inserted shot ids) after an insert. */ onDone: (msg?: string, inserted?: string[]) => void;
}) {
  const sb = project.storyboard!;
  const shot = sb.shots[shotId];
  const number = sb.order.indexOf(shotId) + 1;
  const [step, setStep] = useState<Step>("describe");
  const [desc, setDesc] = useState(shot?.description ?? "");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState<storyInsert.InsertResult>();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !mobile) onDone(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onDone, mobile]);
  const base = useMemo(() => roundtrip.storyboardToDoc(sb), [sb]);
  const generated = useMemo(() => storyInsert.generatedIds(project), [project]);
  const prompt = useMemo(() => (step === "prompt" && shot ? storyInsert.buildInsertPrompt(base, shotId, desc.trim(), generated) : ""), [step, base, shotId, desc, generated, shot]);
  if (!shot) return null;
  const label = `Plan shots after shot ${number}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); }
    catch { const t = promptRef.current; if (t) { t.focus(); t.select(); document.execCommand?.("copy"); } }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const check = () => {
    const r = storyInsert.applyInsertJson(base, answer, { series, expectAfter: shotId, generated });
    setChecked(r);
    if (r.ok) setStep("preview");
  };
  const confirm = () => {
    if (!checked?.ok) return;
    const n = checked.preview.shots.length;
    const changed = engine.dispatch(cmd.mergeStoryboardDoc(checked.doc), `Insert ${n} shot${n === 1 ? "" : "s"} after shot ${number}`);
    onDone(changed ? `Inserted ${n} shot${n === 1 ? "" : "s"} after shot ${number}` : "Nothing to insert", changed ? checked.preview.shots.map((s) => s.id) : undefined);
  };
  const at = STEPS.findIndex((s) => s.id === step);
  const back = () => setStep(STEPS[Math.max(0, at - 1)].id);

  const foot = (
    <div className="v2-pi-foot">
      {at > 0 ? <button type="button" className="v2-btn v2-sb-btn" onClick={back}>Back</button> : <button type="button" className="v2-btn v2-sb-btn" onClick={() => onDone()}>Cancel</button>}
      {step === "describe" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!desc.trim()} onClick={() => setStep("prompt")}>Continue</button>}
      {step === "prompt" && <button type="button" className="v2-btn v2-sb-btn primary" onClick={() => setStep("paste")}>Paste answer</button>}
      {step === "paste" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!answer.trim()} onClick={check}>Check</button>}
      {step === "preview" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!checked?.ok} onClick={confirm}>Insert {checked?.ok ? checked.preview.shots.length : ""} shot{checked?.ok && checked.preview.shots.length === 1 ? "" : "s"}</button>}
    </div>
  );

  return (
    <Panel mobile={mobile} label={label} onDone={() => onDone()} className="v2-pi">
      <div className="v2-sb-detail-body v2-sb-form v2-pi-body" aria-label={label}>
        {!mobile && <div className="v2-sb-detail-head"><Ic g="effect" size={18} /><h3>{label}</h3></div>}
        <ol className="v2-pi-steps" aria-label="Steps">
          {STEPS.map((s, i) => <li key={s.id} className={i === at ? "on" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>{i + 1}. {s.label}</li>)}
        </ol>

        {step === "describe" && <>
          <label className="v2-sb-field">Briefly describe the last shot
            <textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} required aria-required="true" aria-invalid={!desc.trim()} placeholder="What happens at the end of the shot, who is in it, where…" />
          </label>
          <p className="v2-hint">Shot {number} · “{shot.title}”. Check the description (prefilled from the shot) or edit it: the AI plans the next shots from it.</p>
          {!desc.trim() && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> A description is required.</p>}
        </>}

        {step === "prompt" && <>
          <p className="v2-hint">Copy this prompt into your AI chat. It lists the neighbouring shots, every asset and clip (to reuse), the guide rules and the exact answer format.</p>
          <div className="v2-pi-copyrow"><button type="button" className="v2-btn v2-sb-btn primary" onClick={copy}><Ic g="⎘" size={16} /> {copied ? "Copied" : "Copy prompt"}</button></div>
          <textarea ref={promptRef} className="v2-pi-prompt" readOnly value={prompt} aria-label="Planning prompt" rows={12} />
        </>}

        {step === "paste" && <>
          <label className="v2-sb-field">Paste the AI's answer (JSON)
            <textarea rows={10} value={answer} onChange={(e) => { setAnswer(e.target.value); setChecked(undefined); }} placeholder={'{"schema":"3.1-insert","insertAfter":"' + shotId + '","shots":[…],"newAssets":[…]}'} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          </label>
          {checked && !checked.ok && <><Issues list={checked.errors} kind="error" /><Issues list={checked.warnings} kind="warning" /></>}
        </>}

        {step === "preview" && checked?.ok && <>
          <h4 className="v2-pi-h">Shots to insert after shot {number}</h4>
          <ul className="v2-pi-shots" aria-label="Shots to insert">
            {checked.preview.shots.map((s, i) => (
              <li key={s.id}>
                <b>Shot {number + i + 1} · {s.title}</b> <span className="v2-pi-id">{s.id}</span>
                <span>Clip {s.clip ?? "—"} <em className={s.clipNew ? "v2-pi-new" : "v2-pi-reused"}>{s.clipNew ? "Needs generation" : "Reused"}</em> · {s.durationSec}s</span>
                {s.layers.length > 0 && <span>Layers: {s.layers.join(", ")}</span>}
                {s.audio.length > 0 && <span>Audio: {s.audio.join(", ")}</span>}
                {s.dialogue && <span>Dialogue: {s.dialogue}</span>}
              </li>
            ))}
          </ul>
          <h4 className="v2-pi-h">Assets and clips</h4>
          <ul className="v2-pi-assets" aria-label="Assets and clips">
            {checked.preview.assets.map((a) => (
              <li key={a.id}><span>{a.name} <span className="v2-pi-id">{a.id} · {a.type}</span></span>
                <em className={a.isNew ? "v2-pi-new" : "v2-pi-reused"}>{a.isNew ? "Needs generation" : a.generated ? "Reused · generated" : "Reused"}</em></li>
            ))}
          </ul>
          {sb.order.length > number && <p className="v2-hint">Shots {number + 1}–{sb.order.length} become {number + 1 + checked.preview.shots.length}–{sb.order.length + checked.preview.shots.length}. One Undo removes the whole insert.</p>}
          <Issues list={checked.warnings} kind="warning" />
        </>}
        {foot}
      </div>
    </Panel>
  );
}
