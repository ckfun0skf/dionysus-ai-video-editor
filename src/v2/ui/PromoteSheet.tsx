import { useEffect, useState } from "react";
import { promote, type Project } from "../domain";
import { cmd, type Engine } from "../engine";

const S = 120000;
const fmt = (t: number) => `${Math.round((t / S) * 10) / 10}s`;

/** P20: before / after mini-timeline of the main track (promoted clip highlighted). */
function MiniTrack({ label, segs, total, name }: { label: string; segs: promote.PromoteSeg[]; total: number; name: (id: string) => string }) {
  return (
    <div className="v2-promote-row">
      <span className="v2-promote-lbl">{label}</span>
      <div className="v2-promote-track" role="img" aria-label={`${label}: ${segs.map((s) => `${name(s.id)} ${fmt(s.startTicks)}–${fmt(s.startTicks + s.durationTicks)}`).join(", ")}`}>
        {segs.map((s, i) => (
          <span key={`${s.id}-${i}`} className={`v2-promote-seg ${s.promoted ? "is-promoted" : ""}`} data-testid={s.promoted ? "promote-seg-new" : "promote-seg"}
            style={{ left: `${(s.startTicks / total) * 100}%`, width: `${(s.durationTicks / total) * 100}%` }} title={`${name(s.id)} ${fmt(s.startTicks)}–${fmt(s.startTicks + s.durationTicks)}`}>
            <i>{name(s.id)}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

/** P20 "Promote to main track": pick replace / insert (and before / after), preview the change, then apply in one undo step. */
export function PromoteSheet({ engine, project, clipId, onDone }: { engine: Engine; project: Project; clipId: string; onDone: (msg?: string) => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onDone]);
  const [mode, setMode] = useState<promote.PromoteMode>("replace");
  const [position, setPosition] = useState<promote.InsertPosition | undefined>();
  const [keepTransform, setKeep] = useState(true);
  const comp = project.compositions[project.rootCompositionId];
  const all = comp.tracks.flatMap((t) => t.placements);
  const name = (id: string) => { const p = all.find((x) => x.id === id); return (p && project.assets[p.source.assetId]?.name) || (p ? p.clipType : "part"); };
  const opts = { mode, position, keepTransform };
  let plan: promote.PromotePlan | undefined, error: string | undefined;
  try { plan = promote.promoteOverlay(comp, clipId, opts).plan; } catch (e) { error = (e as Error).message; }
  const segName = (id: string) => {
    if (all.some((x) => x.id === id) || !plan) return name(id);
    const seg = plan.after.find((x) => x.id === id)!, from = plan.before.find((b) => b.startTicks <= seg.startTicks && b.startTicks + b.durationTicks > seg.startTicks);
    return from ? `${name(from.id)} (cont.)` : name(id);
  };
  const needPos = !!plan?.inside && !position;
  const total = plan ? Math.max(plan.durationBefore, plan.durationAfter, 1) : 1;
  const ovl = all.find((x) => x.id === clipId);
  const dropped = ovl ? promote.droppedProps(ovl, keepTransform) : [];
  const hasTransform = !!ovl?.transform;
  const readable = (s: string) => s.replace(/\b(main clip) ([\w-]+)/g, (_m, a, id) => `${a} “${name(id)}”`);
  const apply = () => {
    if (!plan || needPos) return;
    const ok = engine.dispatch(cmd.promoteOverlay(clipId, opts));
    onDone(ok ? `Promoted to the main track${plan.durationAfter !== plan.durationBefore ? ` · length ${fmt(plan.durationBefore)} → ${fmt(plan.durationAfter)}` : ""}` : "Could not promote this clip");
  };
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={() => onDone()}>
      <div className="v2-confirm v2-sync-sheet v2-promote" role="dialog" aria-modal="true" aria-label="Promote to main track" onPointerDown={(e) => e.stopPropagation()}>
        <h4>Promote to main track</h4>
        {error || !plan ? <p>{error ?? "This clip cannot be promoted."}</p> : <>
          <div className="v2-seg" role="radiogroup" aria-label="Mode">
            {(["replace", "insert"] as const).map((m) => <button key={m} role="radio" aria-checked={mode === m} className={`v2-seg-btn ${mode === m ? "is-active" : ""}`} onClick={() => { setMode(m); setPosition(undefined); }}>{m === "replace" ? "Replace" : "Insert"}</button>)}
          </div>
          <p className="v2-promote-help">{mode === "replace" ? "Keeps its time and replaces what the main track shows there. The video length does not change unless the clip runs past the end." : `Puts it in at a cut and moves every later main clip (and its linked layers) ${fmt(ovl?.durationTicks ?? 0)} later. The video gets longer.`}</p>
          {plan.inside && <div className="v2-promote-pos">
            <p>It starts inside “{name(plan.inside.id)}” ({fmt(plan.inside.startTicks)}–{fmt(plan.inside.endTicks)}). Insert it:</p>
            <div className="v2-seg" role="radiogroup" aria-label="Insert position">
              {(["before", "after"] as const).map((x) => <button key={x} role="radio" aria-checked={position === x} data-testid={`promote-${x}`} className={`v2-seg-btn ${position === x ? "is-active" : ""}`} onClick={() => setPosition(x)}>{x === "before" ? `Before it (${fmt(plan!.inside!.startTicks)})` : `After it (${fmt(plan!.inside!.endTicks)})`}</button>)}
            </div>
          </div>}
          <MiniTrack label="Before" segs={plan.before} total={total} name={segName} />
          {!needPos && <MiniTrack label="After" segs={plan.after} total={total} name={segName} />}
          {!needPos && <ul className="v2-sync-list" data-testid="promote-notes">{plan.notes.map((n) => <li key={n}>{readable(n)}</li>)}</ul>}
          {hasTransform && <label className="v2-promote-keep"><input type="checkbox" checked={keepTransform} onChange={(e) => setKeep(e.target.checked)} /> Keep position, scale and crop</label>}
          {dropped.length > 0 && <p className="v2-promote-warn" role="note">⚠ The main track does not use: {dropped.join(", ")}. {dropped.length === 1 ? "It is" : "They are"} removed from this clip.</p>}
        </>}
        <div className="v2-confirm-actions">
          <button className="v2-btn" onClick={() => onDone()}>Cancel</button>
          {plan && <button className="v2-btn primary" data-testid="promote-confirm" disabled={needPos} autoFocus onClick={apply}>{needPos ? "Choose before or after" : mode === "replace" ? "Replace" : "Insert"}</button>}
        </div>
      </div>
    </div>
  );
}
