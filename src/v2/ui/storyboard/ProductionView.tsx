import { useState } from "react";
import { board, storySteps, type Project, type ProductionStep, type StepState } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { ContextMenu } from "../desktop/ContextMenu";
import { haptic } from "../gestures";
import { type BoardTarget, shotIcon, Thumb, TYPE_ICON } from "./BoardView";
import { ActionSheet } from "./ShotEditor";
import { StoryDetail } from "./StoryDetail";
import { useDragReorder } from "./useDragReorder";

const LABEL: Record<StepState, string> = { todo: "To do", blocked: "Waiting", check: "Check it", stale: "May not match", done: "Done", skipped: "Skipped" };
const ICON: Record<StepState, string> = { todo: "⇪", blocked: "link", check: "☑", stale: "alert", done: "ok", skipped: "skip" };
const finished = (s: ProductionStep) => s.state === "done" || s.state === "skipped";

type NoteFn = (text: string, action?: { label: string; run: () => void }) => void;

/**
 * Production to-do list (V2-CUT-11): every asset and clip in a workable order, one step at a time.
 * V2-CUT-07: steps can be reordered (drag, long-press on a phone, Alt+↑/↓, menu), always within dependency order.
 */
export function ProductionView({ project, thumbs, engine, blobs, mobile, onNote }: { project: Project; thumbs: Record<string, string>; engine: Engine; blobs: BlobStore; mobile: boolean; onNote?: NoteFn }) {
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
      const verb = !sl ? "Regenerate" : sl.source.type === "lastFrame" ? "Take the frame again" : sl.source.type === "upload" ? "Upload it again" : sl.source.type === "json" ? "Paste new audio JSON" : "Regenerate";
      return reason ? `${verb} — ${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : verb;
    }
    if (s.state === "blocked" && s.blockedBy) return `After shot ${b.order.indexOf(s.blockedBy) + 1} has a clip`;
    if (s.state === "blocked" && s.waitsFor) return `After “${b.slots[s.waitsFor]?.name ?? s.waitsFor}” is added`;
    if (s.state === "check") return `Checks ${s.qaDone}/${s.qaTotal}`;
    if ("slot" in s.target) { const sl = b.slots[s.target.slot]; return sl.source.type === "lastFrame" ? `Last frame of shot ${b.order.indexOf(sl.source.shotId) + 1}` : sl.source.type === "upload" ? "Upload your file" : sl.source.type === "json" ? "Paste the audio JSON from your AI" : sl.type === "html" ? "Make the HTML and upload it" : `Generate ${sl.type}`; }
    const sh = b.shots[s.target.shot];
    if (sh.render === "html") return "Check the HTML clip";
    if (sh.render === "still") return "Check the still";
    return "Generate the clip";
  };
  const open = (t: BoardTarget) => setCur("slot" in t ? `slot:${t.slot}` : `shot:${t.shot}`);
  const nextOpen = steps.find((s, j) => j > i && !finished(s)) ?? steps.find((s) => !finished(s) && s.key !== cur);
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  /* V2-CUT-07: reorder steps. Each move is one undo step; a move past a dependency stops next to it. */
  const keys = steps.map((s) => s.key);
  const [menu, setMenu] = useState<{ key: string; at?: { x: number; y: number } }>();
  const stepName = (k: string) => { const s = steps.find((x) => x.key === k); return s ? name(s) : k; };
  const short = (k: string) => (k.startsWith("slot:") ? `“${b.slots[k.slice(5)]?.name ?? k}”` : `shot ${b.order.indexOf(k.slice(5)) + 1}`);
  const focusStep = (k: string) => requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-step]")].find((x) => x.dataset.step === k)?.querySelector<HTMLElement>(".v2-prod-step")?.focus());
  const move = (k: string, to: number) => {
    const from = keys.indexOf(k);
    if (from < 0) return;
    const m = storySteps.clampStepMove(b, keys, from, to);
    const why = m.by && (m.why === "needs" ? `it needs ${short(m.by)} first` : `${short(m.by)} is made from it`);
    if (m.to === from) {
      if (why) onNote?.(`“${stepName(k)}” can’t move ${to < from ? "up" : "down"}: ${why}`);
      return;
    }
    engine.dispatch(cmd.moveStep(k, m.to));
    haptic(8);
    onNote?.(`Moved “${stepName(k)}” to step ${m.to + 1}${why ? ` · ${why}, so it stops there` : ""}`, { label: "Undo", run: () => engine.undo() });
  };
  const drag = useDragReorder({
    onMove: (from, _to, wanted) => move(keys[from], wanted),
    onHold: (i) => setMenu({ key: keys[i] }),
    clamp: (from, to) => storySteps.clampStepMove(b, keys, from, to).to,
  });
  const reset = () => { engine.dispatch(cmd.resetStepOrder()); onNote?.("Steps are back in the suggested order", { label: "Undo", run: () => engine.undo() }); };
  const actions = (k: string) => {
    const j = keys.indexOf(k), r = storySteps.stepMoveRange(b, keys, j);
    return [
      { label: "Open step", icon: "anim-out", shortcut: undefined as string | undefined, onSelect: () => setCur(k) },
      { label: "Move up", icon: "↑", shortcut: mobile ? undefined : "Alt+↑", disabled: j <= r.min, onSelect: () => move(k, j - 1) },
      { label: "Move down", icon: "↓", shortcut: mobile ? undefined : "Alt+↓", disabled: j >= r.max, onSelect: () => move(k, j + 1) },
      { label: "Do this as early as possible", icon: "to-top", disabled: j <= r.min, onSelect: () => move(k, r.min) },
      { label: "Do this as late as possible", icon: "to-bottom", disabled: j >= r.max, onSelect: () => move(k, r.max) },
      ...(b.stepOrder ? [{ label: "Reset to suggested order", icon: "↶", onSelect: reset }] : []),
    ];
  };
  const keyDown = (e: React.KeyboardEvent, k: string, j: number) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(k, j + (e.key === "ArrowUp" ? -1 : 1)); focusStep(k); }
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ key: k, at: { x: r.left + 24, y: r.top + 24 } }); }
  };

  const list = (
    <nav className="v2-prod-list" aria-label="Production steps">
      <div className="v2-prod-progress">
        <b>{done === steps.length ? "All done — ready for the timeline" : `${done} of ${steps.length} done`}</b>
        <div className="v2-prod-bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Production progress"><span style={{ width: `${pct}%` }} /></div>
        <div className="v2-prod-order">
          <span>{b.stepOrder ? "Your order" : "Suggested order"} · {mobile ? "long-press a step to move it" : "drag or Alt+↑/↓ to reorder"}</span>
          {b.stepOrder && <button className="v2-linkbtn" onClick={reset} title="Put the steps back in the suggested order (Undo restores yours)">Reset order</button>}
        </div>
      </div>
      <ol>
        {steps.map((s, j) => {
          const owner = "slot" in s.target ? b.slots[s.target.slot] : b.shots[s.target.shot];
          const v = board.selectedOf(project, owner);
          return (
            <li key={s.key} data-reorder="" data-step={s.key} className="v2-prod-item">
              {!mobile && <span className="v2-sb-grip v2-prod-grip" aria-hidden title="Drag to reorder" onPointerDown={(e) => { e.stopPropagation(); drag.start(e, j, true); }}><Ic g="grip-v" size={16} /></span>}
              <button className={`v2-prod-step ${s.state} ${s.key === cur ? "open" : ""}`} aria-current={s.key === cur ? "step" : undefined} onClick={() => setCur(s.key)}
                onPointerDown={(e) => drag.start(e, j)} onKeyDown={(e) => keyDown(e, s.key, j)}
                onContextMenu={mobile ? (e) => e.preventDefault() : (e) => { e.preventDefault(); setMenu({ key: s.key, at: { x: e.clientX, y: e.clientY } }); }}
                title={`${LABEL[s.state]} · ${mobile ? "long-press to move" : "drag to reorder · right-click for more · Alt+↑/↓ moves"}`} aria-keyshortcuts={mobile ? undefined : "Alt+ArrowUp Alt+ArrowDown"}>
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
      {menu && keys.includes(menu.key) && (menu.at
        ? <ContextMenu x={menu.at.x} y={menu.at.y} label={`Step ${keys.indexOf(menu.key) + 1} actions`} onClose={() => setMenu(undefined)} items={actions(menu.key).flatMap((a, n) => (n === 1 || n === 5 ? ["sep" as const, a] : [a]))} />
        : <ActionSheet title={`Step ${keys.indexOf(menu.key) + 1} · ${stepName(menu.key)}`} actions={actions(menu.key)} onClose={() => setMenu(undefined)} />)}
      {step && <StoryDetail key={step.key} inline head={nav} project={project} target={step.target} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} onClose={() => setCur(undefined)} onOpen={open} />}
    </div>
  );
}
