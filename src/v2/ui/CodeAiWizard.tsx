// P4B: Create code → AI mode. A step-by-step wizard that asks what to make, builds a prompt for any external AI (from the
// same source as HTML_CLIP_PACKAGE.md), and imports the AI's .zip / .html reply into the Code Editor.
import { useMemo, useState } from "react";
import {
  CODE_ROLES, CODE_ROLE_GUIDE, CODE_ROLE_LABEL, HTML_CLIP_ASPECTS, MAX_CLIP_SEC, PARAM_TYPES, codeWizardPrompt, nearestAspect,
  newWizardAnswers, runtimeAiLinks, wizardIssues, wizardParams, type CodeRole, type CodeWizardAnswers, type ParamType, type WizardParam, type WizardRef,
} from "../domain";
import { CLIP_LIBRARIES } from "../render";
import { HtmlImport } from "./HtmlImport";
import { Ic as Icon } from "./Icon";
import { CopyButton } from "./storyboard/StoryImport";

const STEPS = [
  { id: "describe", label: "Describe" },
  { id: "role", label: "Role" },
  { id: "params", label: "Parameters" },
  { id: "size", label: "Size & duration" },
  { id: "libs", label: "three.js" },
  { id: "refs", label: "Reference media" },
  { id: "prompt", label: "Prompt" },
  { id: "import", label: "Import" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
const ROLE_ICON: Record<CodeRole, string> = { scene: "▣", overlay: "◫", title: "T", dataviz: "▤" };
const EXAMPLES = [
  "A TensorFlow-style object-detection HUD that boxes every person in my drone footage, with a label and confidence score",
  "A neon lower third with a name and a role that slides in and out",
  "A slow 3D starfield flying towards the camera",
  "An animated bar chart of monthly sales that grows from zero",
];

/** Read a reference's size and length in the browser (best effort; absent in jsdom). */
function probe(file: File): Promise<Partial<WizardRef>> {
  const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
  const done = (r: Partial<WizardRef>) => { if (url) URL.revokeObjectURL(url); return r; };
  if (!url) return Promise.resolve({});
  return new Promise((res) => {
    const t = setTimeout(() => res(done({})), 4000);
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => { clearTimeout(t); res(done({ width: img.naturalWidth, height: img.naturalHeight })); };
      img.onerror = () => { clearTimeout(t); res(done({})); };
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = () => { clearTimeout(t); res(done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, durationSec: Number.isFinite(v.duration) ? v.duration : undefined })); };
      v.onerror = () => { clearTimeout(t); res(done({})); };
      v.src = url;
    }
  });
}

export function CodeAiWizard({ mobile, initialRole = "scene", onImport, onClose }: {
  mobile?: boolean; initialRole?: CodeRole;
  /** The validated single-file HTML; the caller opens it in the Code Editor (which saves it as a code asset). */
  onImport: (html: string) => void;
  /** Back to the Code Editor. */
  onClose: () => void;
}) {
  const [a, setA] = useState<CodeWizardAnswers>(() => newWizardAnswers(initialRole));
  const [step, setStep] = useState<StepId>("describe");
  const [probing, setProbing] = useState(false);
  const set = (p: Partial<CodeWizardAnswers>) => setA((x) => ({ ...x, ...p }));
  const idx = STEPS.findIndex((s) => s.id === step);
  const issues = useMemo(() => wizardIssues(a), [a]);
  const stepIssues = issues.filter((i) => i.step === step);
  const blockedFrom = (i: number) => issues.some((x) => STEPS.findIndex((s) => s.id === x.step) < i);
  const prompt = () => codeWizardPrompt(a, { libs: CLIP_LIBRARIES, specUrl: runtimeAiLinks().htmlClipSpec });
  const go = (i: number) => { if (i >= 0 && i < STEPS.length && !blockedFrom(i)) setStep(STEPS[i].id); };
  const expectParams = useMemo(() => wizardParams(a), [a]);

  const setParam = (i: number, p: Partial<WizardParam>) => set({ params: a.params.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const addRef = async (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
    if (!list.length) return;
    setProbing(true);
    const refs: WizardRef[] = [];
    for (const f of list) refs.push({ name: f.name, kind: f.type.startsWith("image/") ? "image" : "video", ...(await probe(f)) });
    setProbing(false);
    setA((x) => {
      const next = { ...x, refs: [...x.refs, ...refs] };
      const v = refs.find((r) => r.kind === "video");
      if (v && x.refs.every((r) => r.kind !== "video")) {
        if (x.role === "scene") next.role = "overlay";
        if (v.width && v.height) next.aspect = nearestAspect(v.width, v.height);
        if (v.durationSec) next.durationSec = Math.min(MAX_CLIP_SEC, Math.round(v.durationSec * 100) / 100);
      }
      return next;
    });
  };

  const body = (() => {
    switch (step) {
      case "describe": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">What should the clip show?</h2>
          <p className="v2-muted">Describe it like you would to a motion designer: what moves, the look, the feel.</p>
          <textarea className="v2-cw-text" aria-label="Describe the clip" rows={mobile ? 6 : 5} autoFocus={!mobile} value={a.description} placeholder="e.g. a HUD that boxes people in my drone clip…" onChange={(e) => set({ description: e.target.value })} />
          <span className="v2-ce-label">Ideas</span>
          <div className="v2-cw-ideas">{EXAMPLES.map((x) => <button key={x} type="button" className="v2-btn v2-cw-idea" onClick={() => set({ description: x })}>{x}</button>)}</div>
        </div>
      );
      case "role": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">What is its role in the video?</h2>
          <div className="v2-cw-cards" role="radiogroup" aria-label="Role">
            {CODE_ROLES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={a.role === r} className={`v2-cw-card ${a.role === r ? "is-active" : ""}`} onClick={() => set({ role: r })}>
                <span className="v2-cw-cardicon" aria-hidden>{ROLE_ICON[r]}</span>
                <b>{CODE_ROLE_LABEL[r]}</b>
                <span className="v2-muted">{CODE_ROLE_GUIDE[r].split(": ")[1]?.split(". ")[0]}.</span>
              </button>
            ))}
          </div>
        </div>
      );
      case "params": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">What do you want to tweak later?</h2>
          <p className="v2-muted">Each becomes a parameter with a type and default, editable on the timeline without asking the AI again. Optional.</p>
          {a.params.map((p, i) => (
            <div key={i} className="v2-cw-param" role="group" aria-label={`Parameter ${i + 1}`}>
              <input aria-label="Parameter name" placeholder="name, e.g. boxColor" value={p.key} spellCheck={false} autoCapitalize="off" onChange={(e) => setParam(i, { key: e.target.value })} />
              <select aria-label="Parameter type" value={p.type} onChange={(e) => setParam(i, { type: e.target.value as ParamType })}>{PARAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              <input aria-label="Parameter label" placeholder="Label" value={p.label ?? ""} onChange={(e) => setParam(i, { label: e.target.value })} />
              {p.type === "color"
                ? <input type="color" aria-label="Default colour" value={/^#[0-9a-f]{6}$/i.test(p.default ?? "") ? p.default : "#ffffff"} onChange={(e) => setParam(i, { default: e.target.value })} />
                : p.type === "boolean"
                  ? <select aria-label="Default" value={p.default === "true" ? "true" : "false"} onChange={(e) => setParam(i, { default: e.target.value })}><option value="false">off</option><option value="true">on</option></select>
                  : <input aria-label="Default" placeholder="Default" inputMode={p.type === "number" ? "decimal" : undefined} value={p.default ?? ""} onChange={(e) => setParam(i, { default: e.target.value })} />}
              {p.type === "select" && <input aria-label="Options" placeholder="Options: a, b, c" value={p.options ?? ""} onChange={(e) => setParam(i, { options: e.target.value })} />}
              <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove parameter ${p.key || i + 1}`} onClick={() => set({ params: a.params.filter((_, j) => j !== i) })}><Icon g="✕" /></button>
            </div>
          ))}
          <button type="button" className="v2-btn v2-cw-add" onClick={() => set({ params: [...a.params, { key: "", type: "number" }] })}><Icon g="＋" /> Add parameter</button>
          {a.refs.some((r) => r.kind === "video") && <p className="v2-muted">A <code>videoOffset</code> parameter is added automatically to line the overlay up with your video.</p>}
        </div>
      );
      case "size": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Frame size and duration</h2>
          <span className="v2-ce-label">Aspect</span>
          <div className="v2-tp-chips v2-cw-chips" role="radiogroup" aria-label="Aspect">
            {HTML_CLIP_ASPECTS.map((x) => <button key={x} type="button" role="radio" aria-checked={a.aspect === x} className={`v2-chip ${a.aspect === x ? "is-active" : ""}`} onClick={() => set({ aspect: x })}>{x}</button>)}
          </div>
          <label className="v2-cw-field"><span className="v2-ce-label">Duration (seconds)</span>
            <input type="number" inputMode="decimal" min={0.1} max={MAX_CLIP_SEC} step={0.1} aria-label="Duration in seconds" value={a.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} />
          </label>
          <div className="v2-tp-chips v2-cw-chips" aria-label="Quick durations">{[3, 5, 10, 15, 30].map((d) => <button key={d} type="button" className={`v2-chip ${a.durationSec === d ? "is-active" : ""}`} onClick={() => set({ durationSec: d })}>{d} s</button>)}</div>
          <p className="v2-muted">The timeline can still trim or stretch the clip; the AI designs the motion over its length.</p>
        </div>
      );
      case "libs": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Does it need 3D?</h2>
          <div className="v2-cw-cards" role="radiogroup" aria-label="Library">
            <button type="button" role="radio" aria-checked={!a.three} className={`v2-cw-card ${!a.three ? "is-active" : ""}`} onClick={() => set({ three: false })}><span className="v2-cw-cardicon" aria-hidden>2D</span><b>No, 2D canvas</b><span className="v2-muted">Lighter and simpler: shapes, text, charts, HUDs.</span></button>
            <button type="button" role="radio" aria-checked={a.three} className={`v2-cw-card ${a.three ? "is-active" : ""}`} onClick={() => set({ three: true })}><span className="v2-cw-cardicon" aria-hidden>3D</span><b>Yes, use three.js</b><span className="v2-muted">WebGL scenes, cameras and lights. three.js is the only library a clip can load.</span></button>
          </div>
        </div>
      );
      case "refs": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Reference media (optional)</h2>
          <p className="v2-muted">Attach the same files to your AI chat. For a video the prompt explains how the overlay is timed against it, and asks the AI to embed its analysis (e.g. per-frame boxes) as data in the package.</p>
          <ul className="v2-cw-refs">
            {a.refs.map((r, i) => (
              <li key={i} className="v2-cw-ref">
                <Icon g={r.kind === "video" ? "▶" : "▣"} />
                <span><b>{r.name}</b><span className="v2-muted">{[r.kind, r.width && r.height ? `${r.width}×${r.height}` : "", r.durationSec ? `${r.durationSec.toFixed(1)} s` : ""].filter(Boolean).join(" · ")}</span></span>
                <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove ${r.name}`} onClick={() => set({ refs: a.refs.filter((_, j) => j !== i) })}><Icon g="✕" /></button>
              </li>
            ))}
          </ul>
          <label className="v2-btn v2-cw-add">{probing ? "Reading…" : <><Icon g="＋" /> Add video or image</>}
            <input type="file" hidden multiple accept="video/*,image/*" aria-label="Add reference media" onChange={(e) => { void addRef(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      );
      case "prompt": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Copy the prompt to your AI</h2>
          <p className="v2-muted">Paste it into any AI chat{a.refs.length ? ", attach your reference files," : ""} and ask for the package. It explains the {"dionysus.htmlclip/1"} format, the rules and your answers.</p>
          <div className="v2-cw-copy"><CopyButton text={prompt} label="Copy prompt" primary testId="copy-code-ai-prompt" /></div>
          <pre className="v2-cw-prompt" aria-label="Prompt" tabIndex={0}>{prompt()}</pre>
        </div>
      );
      case "import": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Import the AI's package</h2>
          <p className="v2-muted">Choose or drop the .zip or .html, or paste the reply. It's checked against the package standard, then opens in the Code Editor to preview and save.</p>
          <HtmlImport expectParams={expectParams} dropHint actionLabel="Open in Code Editor" actionTitle="Preview it in the Code Editor, then add it to the timeline" onAdd={(html) => onImport(html)} />
        </div>
      );
    }
  })();

  const last = idx === STEPS.length - 1;
  const nextBlocked = stepIssues.length > 0 || (!last && blockedFrom(idx + 1));
  return (
    <div className={`v2-code-editor v2-ce v2-cw ${mobile ? "is-mobile" : ""}`} role="dialog" aria-modal="true" aria-label="Code AI mode">
      <header className="v2-ce-bar">
        <button type="button" className="v2-btn v2-ce-icon" aria-label="Back to the Code Editor" title="Back to the Code Editor" onClick={onClose}><Icon g="✕" /></button>
        <span className="v2-ce-title">
          <b>AI mode</b>
          <span className="v2-muted">Step {idx + 1} of {STEPS.length} · {STEPS[idx].label}</span>
        </span>
      </header>
      {mobile && <div className="v2-cw-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={idx + 1}><span style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }} /></div>}
      <div className="v2-cw-main">
        {!mobile && (
          <nav className="v2-cw-nav" aria-label="Steps">
            <ol>
              {STEPS.map((s, i) => (
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
          {body}
          {stepIssues.length > 0 && step !== "describe" && <ul className="v2-cw-issues" role="alert">{stepIssues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
        </section>
      </div>
      <footer className="v2-cw-foot">
        <button type="button" className="v2-btn" disabled={idx === 0} onClick={() => go(idx - 1)}>Back</button>
        <span className="v2-ae-spacer" />
        {(step === "params" || step === "refs") && <button type="button" className="v2-btn" onClick={() => go(idx + 1)} disabled={nextBlocked}>Skip</button>}
        {!last && <button type="button" className="v2-btn primary" disabled={nextBlocked} onClick={() => go(idx + 1)}>{step === "refs" ? "Build prompt" : step === "prompt" ? "I have the reply" : "Next"}</button>}
      </footer>
    </div>
  );
}
