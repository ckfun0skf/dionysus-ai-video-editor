/**
 * P36 "Revise with AI" (whole storyboard) / "Edit with AI" (one shot): describe the problem, copy a prompt for any AI
 * chat, paste its {"schema":"3.1-revise"} / {"schema":"3.1-shot-revise"} answer, review what changes, apply in one undo
 * step. Same steps and look as Plan with AI (PlanInsertSheet).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { roundtrip, storyInsert, storyRevise, type Project, type SeriesLike } from "../../domain";
import { cmd, type Engine } from "../../engine";
import { Ic } from "../Icon";
import { Existing, Issues } from "./PlanInsertSheet";
import { Panel } from "./ShotEditor";

type Step = "describe" | "prompt" | "paste" | "preview";
const STEPS: { id: Step; label: string }[] = [
  { id: "describe", label: "Describe" }, { id: "prompt", label: "Prompt" }, { id: "paste", label: "Paste" }, { id: "preview", label: "Preview" },
];

export function ReviseSheet({ engine, project, shotId, mobile, series, onDone }: {
  engine: Engine; project: Project; /** Edit with AI on this shot; absent = the whole storyboard. */ shotId?: string; mobile: boolean; series?: SeriesLike;
  onDone: (msg?: string, changed?: boolean) => void;
}) {
  const sb = project.storyboard!;
  const number = shotId ? sb.order.indexOf(shotId) + 1 : 0;
  const [step, setStep] = useState<Step>("describe");
  const [brief, setBrief] = useState("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState<storyRevise.ReviseResult>();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !mobile) onDone(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onDone, mobile]);
  const base = useMemo(() => roundtrip.storyboardToDoc(sb), [sb]);
  const generated = useMemo(() => storyInsert.generatedIds(project), [project]);
  const prompt = useMemo(() => (step === "prompt" ? storyRevise.buildRevisePrompt(base, brief.trim(), generated, shotId) : ""), [step, base, brief, generated, shotId]);
  if (shotId && !sb.shots[shotId]) return null;
  const label = shotId ? `Edit shot ${number} with AI` : "Revise storyboard with AI";
  const schema = shotId ? storyRevise.SHOT_REVISE_SCHEMA : storyRevise.REVISE_SCHEMA;
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); }
    catch { const t = promptRef.current; if (t) { t.focus(); t.select(); document.execCommand?.("copy"); } }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const check = () => { const r = storyRevise.applyReviseJson(base, answer, { series, shotId, generated }); setChecked(r); if (r.ok) setStep("preview"); };
  const confirm = () => {
    if (!checked?.ok) return;
    const changed = engine.dispatch(cmd.mergeStoryboardDoc(checked.doc), shotId ? `Edit shot ${number} with AI` : "Revise storyboard with AI");
    onDone(changed ? (shotId ? `Shot ${number} revised` : "Storyboard revised") : "Nothing changed", changed);
  };
  const at = STEPS.findIndex((s) => s.id === step);
  const back = () => setStep(STEPS[Math.max(0, at - 1)].id);
  const title = (id: string) => { const i = sb.order.indexOf(id); return i >= 0 ? `Shot ${i + 1} · ${sb.shots[id].title}` : id; };
  const p = checked?.ok ? checked.preview : undefined;
  const group = (h: string, ids: string[], fmt: (id: string) => string, tag?: string) => ids.length > 0 && <>
    <h4 className="v2-pi-h">{h}</h4>
    <ul className="v2-pi-assets" aria-label={h}>{ids.map((id) => <li key={id}><span>{fmt(id)}</span>{tag && <em className="v2-pi-new">{tag}</em>}</li>)}</ul>
  </>;
  return (
    <Panel mobile={mobile} label={label} onDone={() => onDone()} className="v2-pi">
      <div className="v2-sb-detail-body v2-sb-form v2-pi-body" aria-label={label}>
        {!mobile && <div className="v2-sb-detail-head"><Ic g="effect" size={18} /><h3>{label}</h3></div>}
        <ol className="v2-pi-steps" aria-label="Steps">
          {STEPS.map((s, i) => <li key={s.id} className={i === at ? "on" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>{i + 1}. {s.label}</li>)}
        </ol>
        {step === "describe" && <>
          <label className="v2-sb-field">{shotId ? "What's wrong with this shot?" : "What should change?"}
            <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} required aria-required="true" maxLength={1500}
              placeholder={shotId ? "e.g. The action is unclear and the dialogue is too long" : "e.g. The middle drags: tighten shots 4–7 and add a reveal before the ending"} />
          </label>
          <p className="v2-hint">{shotId ? `Shot ${number} · “${sb.shots[shotId].title}”. Only this shot (and the clips you allow) changes.` : "Briefly describe the problem. The AI keeps what works and lists only what changes."} Generated clips are kept unless their prompt changes.</p>
        </>}
        {step === "prompt" && <>
          <p className="v2-hint">Copy this prompt into your AI chat. It includes {shotId ? "the shot, its clip and neighbours" : "the whole storyboard"}, the guide rules and the exact answer format.</p>
          <div className="v2-pi-copyrow"><button type="button" className="v2-btn v2-sb-btn primary" onClick={copy}><Ic g="⎘" size={16} /> {copied ? "Copied" : "Copy prompt"}</button></div>
          <textarea ref={promptRef} className="v2-pi-prompt" readOnly value={prompt} aria-label="Revise prompt" rows={12} />
        </>}
        {step === "paste" && <>
          <label className="v2-sb-field">Paste the AI's answer (JSON)
            <textarea rows={10} value={answer} onChange={(e) => { setAnswer(e.target.value); setChecked(undefined); }} placeholder={`{"schema":"${schema}",…}`} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          </label>
          {checked && !checked.ok && <><Issues list={checked.errors} kind="error" /><Issues list={checked.warnings} kind="warning" /><Existing list={checked.existing} /></>}
        </>}
        {step === "preview" && p && checked?.ok && <>
          <Issues list={checked.warnings} kind="warning" />
          <Existing list={checked.existing} />
          {group("Changed shots", p.changed, title)}
          {group("New shots", p.added, (id) => checked.doc.shots.find((s) => s.id === id)?.title ?? id, "New")}
          {group("Removed from the board", p.removed, title)}
          {p.removed.length > 0 && <p className="v2-hint">Their clips stay on the timeline; Update never deletes them.</p>}
          {group("Changed assets and clips", p.assetsChanged, (id) => id, undefined)}
          {group("New assets and clips", p.assetsNew, (id) => id, "Needs generation")}
          {p.regenerate.length > 0 && <p className="v2-hint"><Ic g="⚠" size={14} /> New prompt for {p.regenerate.join(", ")}: regenerate when ready; the current versions are kept.</p>}
          <p className="v2-hint">One Undo reverts the whole revision.</p>
        </>}
        <div className="v2-pi-foot">
          {at > 0 ? <button type="button" className="v2-btn v2-sb-btn" onClick={back}>Back</button> : <button type="button" className="v2-btn v2-sb-btn" onClick={() => onDone()}>Cancel</button>}
          {step === "describe" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!brief.trim()} onClick={() => setStep("prompt")}>Continue</button>}
          {step === "prompt" && <button type="button" className="v2-btn v2-sb-btn primary" onClick={() => setStep("paste")}>Paste answer</button>}
          {step === "paste" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!answer.trim()} onClick={check}>Check</button>}
          {step === "preview" && <button type="button" className="v2-btn v2-sb-btn primary" disabled={!checked?.ok} onClick={confirm}><Ic g="✓" size={16} /> Apply</button>}
        </div>
      </div>
    </Panel>
  );
}
