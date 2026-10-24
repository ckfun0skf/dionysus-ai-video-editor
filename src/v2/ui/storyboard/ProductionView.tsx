import { useState } from "react";
import { board, type Project, type ProductionStep, type StepState } from "../../domain";
import type { Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { type BoardTarget, shotIcon, Thumb, TYPE_ICON } from "./BoardView";
import { StoryDetail } from "./StoryDetail";

const LABEL: Record<StepState, string> = { todo: "To do", blocked: "Waiting", check: "Check it", stale: "May not match", done: "Done", skipped: "Skipped" };
const ICON: Record<StepState, string> = { todo: "⇪", blocked: "link", check: "☑", stale: "alert", done: "ok", skipped: "skip" };
const finished = (s: ProductionStep) => s.state === "done" || s.state === "skipped";

/** Production to-do list (V2-CUT-11): every asset and clip in a workable order, one step at a time. */
export function ProductionView({ project, thumbs, engine, blobs, mobile }: { project: Project; thumbs: Record<string, string>; engine: Engine; blobs: BlobStore; mobile: boolean }) {
  const b = project.storyboard!;
  const steps = board.productionSteps(project);
  const done = steps.filter(finished).length;
  const [cur, setCur] = useState<string | undefined>(() => (mobile ? undefined : (steps.find((s) => !finished(s)) ?? steps[0])?.key));
  const i = steps.findIndex((s) => s.key === cur);
  const step = steps[i];
  const name = (s: ProductionStep) => ("slot" in s.target ? b.slots[s.target.slot].name : `Shot ${b.order.indexOf(s.target.shot) + 1} · ${b.shots[s.target.shot].title}`);
  const status = board.storyStatus(project);
  const what = (s: ProductionStep) => {
    if (s.state === "stale") { // V2-SB-R08: say what to redo and why, not the original instruction
      const isSlot = "slot" in s.target;
      const reason = (isSlot ? status.slots[(s.target as { slot: string }).slot] : status.shots[(s.target as { shot: string }).shot])?.reasons[0];
      const sl = isSlot ? b.slots[(s.target as { slot: string }).slot] : undefined;
      const verb = !sl ? "Regenerate" : sl.source.type === "lastFrame" ? "Take the frame again" : sl.source.type === "upload" ? "Upload it again" : "Regenerate";
      return reason ? `${verb} — ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : verb;
    }
    if (s.state === "blocked" && s.blockedBy) return `After shot ${b.order.indexOf(s.blockedBy) + 1} has a clip`;
    if (s.state === "blocked" && s.waitsFor) return `After “${b.slots[s.waitsFor]?.name ?? s.waitsFor}” is added`;
    if (s.state === "check") return `Checks ${s.qaDone}/${s.qaTotal}`;
    if ("slot" in s.target) { const sl = b.slots[s.target.slot]; return sl.source.type === "lastFrame" ? `Last frame of shot ${b.order.indexOf(sl.source.shotId) + 1}` : sl.source.type === "upload" ? "Upload your file" : sl.type === "html" ? "Make the HTML and upload it" : `Generate ${sl.type}`; }
    const sh = b.shots[s.target.shot];
    if (sh.render === "html") return "Check the HTML clip";
    if (sh.render === "still") return "Check the still";
    return "Generate the clip";
  };
  const open = (t: BoardTarget) => setCur("slot" in t ? `slot:${t.slot}` : `shot:${t.shot}`);
  const nextOpen = steps.find((s, j) => j > i && !finished(s)) ?? steps.find((s) => !finished(s) && s.key !== cur);
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const list = (
    <nav className="v2-prod-list" aria-label="Production steps">
      <div className="v2-prod-progress">
        <b>{done === steps.length ? "All done — ready for the timeline" : `${done} of ${steps.length} done`}</b>
        <div className="v2-prod-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Production progress"><span style={{ width: `${pct}%` }} /></div>
      </div>
      <ol>
        {steps.map((s, j) => {
          const owner = "slot" in s.target ? b.slots[s.target.slot] : b.shots[s.target.shot];
          const v = board.selectedOf(project, owner);
          return (
            <li key={s.key}>
              <button className={`v2-prod-step ${s.state} ${s.key === cur ? "open" : ""}`} aria-current={s.key === cur ? "step" : undefined} onClick={() => setCur(s.key)} title={LABEL[s.state]}>
                <span className="v2-prod-n">{j + 1}</span>
                <Thumb src={v && thumbs[v]} icon={"slot" in s.target ? TYPE_ICON[b.slots[s.target.slot].type] ?? "image" : shotIcon(b.shots[s.target.shot])} count={0} />
                <span className="v2-prod-text"><b>{name(s)}</b><em>{what(s)}</em>{mobile && <span className={`v2-prod-state-m ${s.state}`}><Ic g={ICON[s.state]} size={12} />{LABEL[s.state]}</span>}</span>
                {!mobile && <span className={`v2-prod-state ${s.state}`}><Ic g={ICON[s.state]} size={14} /><span>{LABEL[s.state]}</span></span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
  const nav = step && (
    <div className="v2-prod-nav">
      {mobile && <button className="v2-btn v2-sb-btn" onClick={() => setCur(undefined)}><Ic g="todo" size={16} /> All steps</button>}
      <span className="v2-prod-count">{mobile ? `${i + 1}/${steps.length} · ${LABEL[step.state]}` : `Step ${i + 1} of ${steps.length} · ${LABEL[step.state]}`}</span>
      <span className="v2-spacer" />
      <button className="v2-icon v2-sb-icon" aria-label="Previous step" title="Previous step" disabled={i <= 0} onClick={() => setCur(steps[i - 1].key)}><Ic g="anim-in" size={18} /></button>
      <button className="v2-btn primary v2-sb-btn" disabled={!nextOpen} onClick={() => nextOpen && setCur(nextOpen.key)} aria-label={nextOpen ? "Next to do" : "All done"} title={nextOpen ? `Go to step ${steps.indexOf(nextOpen) + 1}: ${name(nextOpen)}` : "Nothing left to do"}>
        {nextOpen ? (mobile ? "Next" : "Next to do") : "All done"} <Ic g="anim-out" size={16} />
      </button>
    </div>
  );
  return (
    <div className={`v2-prod ${step ? "has-step" : ""}`}>
      {(!mobile || !step) && list}
      {step && <StoryDetail key={step.key} inline head={nav} project={project} target={step.target} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} onClose={() => setCur(undefined)} onOpen={open} />}
    </div>
  );
}
