// Shared chrome for Code AI mode (P4B) and Revise with AI (P44): the same step nav, progress and footer.
import type { ReactNode } from "react";
import { Ic as Icon } from "./Icon";

export interface WizardStep { id: string; label: string }

export function CodeWizardShell({ mobile, ariaLabel, title, steps, step, onStep, issues, quietSteps, onClose, nextLabel, showSkip, children }: {
  mobile?: boolean;
  ariaLabel: string;
  title: string;
  steps: readonly WizardStep[];
  step: string;
  onStep: (id: string) => void;
  issues: readonly { step: string; message: string }[];
  /** Steps that block Next without listing the message (Describe: an empty box is the signal). */
  quietSteps?: readonly string[];
  onClose: () => void;
  /** Absent on the last step, which has no Next. */
  nextLabel?: string;
  showSkip?: boolean;
  children: ReactNode;
}) {
  const idx = Math.max(0, steps.findIndex((s) => s.id === step));
  const stepIssues = issues.filter((i) => i.step === step);
  const blockedFrom = (i: number) => issues.some((x) => steps.findIndex((s) => s.id === x.step) < i);
  const go = (i: number) => { if (i >= 0 && i < steps.length && !blockedFrom(i)) onStep(steps[i].id); };
  const last = idx === steps.length - 1;
  const nextBlocked = stepIssues.length > 0 || (!last && blockedFrom(idx + 1));
  const quiet = quietSteps?.includes(step);
  return (
    <div className={`v2-code-editor v2-ce v2-cw ${mobile ? "is-mobile" : ""}`} role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <header className="v2-ce-bar">
        <button type="button" className="v2-btn v2-ce-icon" aria-label="Back to the Code Editor" title="Back to the Code Editor" onClick={onClose}><Icon g="✕" /></button>
        <span className="v2-ce-title">
          <b>{title}</b>
          <span className="v2-muted">Step {idx + 1} of {steps.length} · {steps[idx]?.label}</span>
        </span>
      </header>
      {mobile && <div className="v2-cw-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={idx + 1}><span style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></div>}
      <div className="v2-cw-main">
        {!mobile && (
          <nav className="v2-cw-nav" aria-label="Steps">
            <ol>
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button type="button" className={`v2-cw-navbtn ${s.id === step ? "is-active" : ""} ${i < idx ? "is-done" : ""}`} aria-current={s.id === step ? "step" : undefined} disabled={blockedFrom(i)} onClick={() => go(i)}>
                    <span className="v2-cw-num" aria-hidden>{i < idx ? "✓" : i + 1}</span>{s.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <section className="v2-cw-body">
          {children}
          {!quiet && stepIssues.length > 0 && <ul className="v2-cw-issues" role="alert">{stepIssues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
        </section>
      </div>
      <footer className="v2-cw-foot">
        <button type="button" className="v2-btn" disabled={idx === 0} onClick={() => go(idx - 1)}>Back</button>
        <span className="v2-ae-spacer" />
        {showSkip && <button type="button" className="v2-btn" onClick={() => go(idx + 1)} disabled={nextBlocked}>Skip</button>}
        {nextLabel && <button type="button" className="v2-btn primary" disabled={nextBlocked} onClick={() => go(idx + 1)}>{nextLabel}</button>}
      </footer>
    </div>
  );
}
