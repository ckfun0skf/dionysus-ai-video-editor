import { useCallback, useEffect, useState } from "react";
import type { StoryDoc } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { useEngineState } from "../useEditor";
import { BoardView, type BoardTarget } from "./BoardView";
import { ImportPanel, PromptPanel } from "./StoryImport";
import { useVersionThumbs } from "./useVersionThumbs";
import "./storyboard.css";

type Step = "prompt" | "import";

/** Storyboard workspace (V2-M4). Full-screen over the editor so the timeline keeps its state. */
export function StoryboardView({ engine, blobs, onClose, onOpenItem }: { engine: Engine; blobs: BlobStore; onClose: () => void; onOpenItem?: (t: BoardTarget) => void }) {
  const { project, canUndo, canRedo } = useEngineState(engine);
  const thumbs = useVersionThumbs(project, blobs);
  const has = !!project.storyboard;
  const [step, setStep] = useState<Step | undefined>();
  const [note, setNote] = useState<string>();
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(undefined), 3500); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLTextAreaElement)) (step ? setStep(undefined) : onClose()); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [step, onClose]);
  const create = useCallback((doc: StoryDoc) => {
    engine.dispatch(cmd.createStoryboard(doc));
    setStep(undefined);
    setNote(has ? "Storyboard replaced — Undo to get the old one back" : `“${doc.meta.title}” is ready`);
  }, [engine, has]);
  const title = step === "prompt" ? (has ? "AI prompt" : "1 · AI prompt") : step === "import" ? (has ? "Replace storyboard" : "2 · Import JSON") : "Storyboard";
  return (
    <div className="v2-board" role="region" aria-label="Storyboard">
      <header className="v2-board-head">
        <button className="v2-btn v2-sb-btn" aria-label={step ? "Back to storyboard" : "Back to editor"} title={step ? "Back (Esc)" : "Back to the timeline editor (Esc)"} onClick={() => (step ? setStep(undefined) : onClose())}><Ic g="anim-in" size={18} /> <span className={has && !step ? "v2-sb-hide-narrow" : ""}>{step ? "Back" : "Editor"}</span></button>
        <h2><Ic g="board" size={18} /> <span>{title}</span></h2>
        <span className="v2-spacer" />
        {has && !step && <>
          <button className="v2-icon v2-sb-icon" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" size={18} /></button>
          <button className="v2-icon v2-sb-icon" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
          <button className="v2-icon v2-sb-icon" aria-label="AI prompt" title="Copy the AI prompt again" onClick={() => setStep("prompt")}><Ic g="⎘" size={18} /></button>
          <button className="v2-icon v2-sb-icon" aria-label="Replace storyboard" title="Import a new storyboard JSON (replaces this one; Undo restores it)" onClick={() => setStep("import")}><Ic g="json" size={18} /></button>
        </>}
      </header>
      <div className="v2-board-body">
        {step === "prompt" ? <PromptPanel /> : step === "import" ? <ImportPanel onCreate={create} replacing={has} /> : has ? (
          <BoardView project={project} thumbs={thumbs} onOpen={(t) => (onOpenItem ? onOpenItem(t) : setNote("Uploading versions and picking one per shot arrives in the next update."))} />
        ) : (
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
      {note && <div className="v2-sb-note" role="status">{note}</div>}
    </div>
  );
}
