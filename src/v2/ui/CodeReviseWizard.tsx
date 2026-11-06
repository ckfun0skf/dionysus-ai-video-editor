// P44: Code Editor → Revise with AI. Same wizard shell as Create code → AI mode. Dionysus does not call an AI:
// the user copies a prompt (and, in Attach mode, the current HTML) and imports the reply.
import { useMemo, useState } from "react";
import {
  BINDING_TYPES, defaultReviseDelivery, codeRevisePrompt, readManifest, reviseIssues, runtimeAiLinks,
  type BindingType, type ReviseDelivery,
} from "../domain";
import { CLIP_LIBRARIES } from "../render";
import { CodeWizardShell } from "./CodeWizardShell";
import { HtmlExportButtons, HtmlImport } from "./HtmlImport";
import { Ic as Icon } from "./Icon";
import { packageBaseName } from "./htmlPackage";
import { CopyButton } from "./storyboard/StoryImport";

const STEPS = [
  { id: "describe", label: "Describe" },
  { id: "mode", label: "Mode" },
  { id: "prompt", label: "Prompt" },
  { id: "import", label: "Import" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

export function CodeReviseWizard({ mobile, html, onImport, onClose }: {
  mobile?: boolean;
  /** The clip open in the Code Editor, including unsaved edits. */
  html: string;
  /** Validated single-file HTML; the editor previews it and Save makes a new version. */
  onImport: (html: string) => void;
  /** Back to the Code Editor, unchanged. */
  onClose: () => void;
}) {
  const manifest = useMemo(() => readManifest(html), [html]);
  const fileName = useMemo(() => `${packageBaseName(html, "clip")}.html`, [html]);
  const suggested = useMemo(() => defaultReviseDelivery(html), [html]);
  const [brief, setBrief] = useState("");
  const [delivery, setDelivery] = useState<ReviseDelivery>(suggested);
  const [step, setStep] = useState<StepId>("describe");
  const issues = useMemo(() => reviseIssues(brief), [brief]);
  const expectParams = manifest.params && Object.keys(manifest.params).length ? manifest.params : undefined;
  const expectBindings = useMemo(() => {
    const out: Record<string, BindingType> = {};
    for (const [k, b] of Object.entries(manifest.bindings ?? {})) if (b && (BINDING_TYPES as readonly string[]).includes(b.type)) out[k] = b.type;
    return Object.keys(out).length ? out : undefined;
  }, [manifest]);
  const prompt = () => codeRevisePrompt({ html, brief, delivery, fileName }, { libs: CLIP_LIBRARIES, specUrl: runtimeAiLinks().htmlClipSpec });
  const kb = Math.max(1, Math.round(html.length / 1024));
  const nextLabel = step === "import" ? undefined : step === "mode" ? "Build prompt" : step === "prompt" ? "I have the reply" : "Next";

  const body = (() => {
    switch (step) {
      case "describe": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">What should change?</h2>
          <p className="v2-muted">Say what to change. Name, role, length, size, parameters and libraries stay as they are on this clip.</p>
          <textarea className="v2-cw-text" aria-label="What should change?" rows={mobile ? 6 : 5} autoFocus={!mobile} value={brief} placeholder="e.g. fade the title out, and keep the logo where it is" onChange={(e) => setBrief(e.target.value)} />
        </div>
      );
      case "mode": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">How should the AI see the current HTML?</h2>
          <p className="v2-muted">{suggested === "embed"
            ? `This package is about ${kb} KB, so Embed starts selected.`
            : `This package is about ${kb} KB, so Attach starts selected. Embedded images and fonts take a lot of space in an AI chat.`}</p>
          <div className="v2-cw-cards" role="radiogroup" aria-label="How the current HTML reaches the AI">
            <button type="button" role="radio" aria-checked={delivery === "embed"} className={`v2-cw-card ${delivery === "embed" ? "is-active" : ""}`} onClick={() => setDelivery("embed")}>
              <span className="v2-cw-cardicon" aria-hidden><Icon g="</>" /></span>
              <b>Embed HTML in prompt</b>
              <span className="v2-muted">The current HTML is inside the prompt. One Copy prompt.</span>
            </button>
            <button type="button" role="radio" aria-checked={delivery === "attach"} className={`v2-cw-card ${delivery === "attach" ? "is-active" : ""}`} onClick={() => setDelivery("attach")}>
              <span className="v2-cw-cardicon" aria-hidden><Icon g="🔗" /></span>
              <b>Attach HTML to AI</b>
              <span className="v2-muted">The prompt names {fileName} and leaves the HTML out. Download or copy it, then attach that file in the chat.</span>
            </button>
          </div>
        </div>
      );
      case "prompt": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Copy the prompt to your AI</h2>
          <p className="v2-muted">{delivery === "embed"
            ? "Paste it into any AI chat. It includes this clip, the package rules and your change."
            : `Paste it into any AI chat and attach ${fileName}. The prompt names that file and does not include the HTML.`}</p>
          <div className="v2-cw-copy">
            <CopyButton text={prompt} label="Copy prompt" primary testId="copy-code-revise-prompt" />
            {delivery === "attach" && <CopyButton text={() => html} label="Copy HTML" testId="copy-code-revise-html" />}
            {delivery === "attach" && <HtmlExportButtons html={() => html} name={manifest.name || "clip"} />}
          </div>
          <pre className="v2-cw-prompt" aria-label="Prompt" tabIndex={0}>{prompt()}</pre>
        </div>
      );
      case "import": return (
        <div className="v2-cw-step">
          <h2 className="v2-cw-q">Import the AI's package</h2>
          <p className="v2-muted">Choose or drop the .zip or .html, or paste the reply. It's checked against the package standard, then opens in the Code Editor. Save there makes a new version.</p>
          <HtmlImport expectParams={expectParams} expectBindings={expectBindings} expectSource="revise" dropHint actionLabel="Open in Code Editor" actionTitle="Preview it in the Code Editor, then save a new version" onAdd={(next) => onImport(next)} />
        </div>
      );
    }
  })();

  return (
    <CodeWizardShell mobile={mobile} ariaLabel="Revise with AI" title="Revise with AI" steps={STEPS} step={step} onStep={(id) => setStep(id as StepId)} issues={issues} quietSteps={["describe"]} onClose={onClose} nextLabel={nextLabel}>
      {body}
    </CodeWizardShell>
  );
}
