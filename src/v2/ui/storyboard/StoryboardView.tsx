import { useEffect, useState } from "react";
import type { StoryDoc } from "../../domain";
import { Ic } from "../Icon";
import { ImportPanel, PromptPanel } from "./StoryImport";
import "./storyboard.css";

type Step = "prompt" | "import";

/** Storyboard workspace (V2-M4). Full-screen over the editor so the timeline keeps its state. */
export function StoryboardView({ onClose, onCreate }: { onClose: () => void; onCreate?: (doc: StoryDoc) => void }) {
  const [step, setStep] = useState<Step | undefined>();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) (step ? setStep(undefined) : onClose()); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [step, onClose]);
  return (
    <div className="v2-board" role="region" aria-label="Storyboard">
      <header className="v2-board-head">
        <button className="v2-btn v2-sb-btn" aria-label={step ? "Back to storyboard" : "Back to editor"} title={step ? "Back (Esc)" : "Back to the timeline editor (Esc)"} onClick={() => (step ? setStep(undefined) : onClose())}><Ic g="anim-in" size={18} /> {step ? "Back" : "Editor"}</button>
        <h2><Ic g="board" size={18} /> {step === "prompt" ? "1 · AI prompt" : step === "import" ? "2 · Import JSON" : "Storyboard"}</h2>
        <span className="v2-spacer" />
      </header>
      <div className="v2-board-body">
        {step === "prompt" ? <PromptPanel /> : step === "import" ? <ImportPanel onCreate={onCreate} /> : (
          <div className="v2-sb-empty">
            <div className="v2-sb-hero"><Ic g="board" size={36} /><h3>Plan your video with your own AI</h3><p>Agree the story with your AI, have it write a storyboard JSON, then import it here. Dionysus turns it into shots, the assets each needs, and a step-by-step production list.</p></div>
            <button className="v2-sb-step" onClick={() => setStep("prompt")} data-testid="step-prompt">
              <span className="v2-sb-num">1</span><span><b>Copy the AI prompt</b><em>Makes your AI reply in the storyboard format, with an example.</em></span><Ic g="anim-out" size={18} />
            </button>
            <button className="v2-sb-step" onClick={() => setStep("import")} data-testid="step-import">
              <span className="v2-sb-num">2</span><span><b>Import the storyboard JSON</b><em>Paste the reply or choose a .json file. Problems are listed clearly.</em></span><Ic g="anim-out" size={18} />
            </button>
            <p className="v2-hint">Dionysus never calls an AI itself. You generate assets and clips in your own tools and upload them here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
