import { useCallback, useEffect, useRef, useState } from "react";
import { board, ops, type StoryDoc } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { ConfirmDialog } from "../Timeline";
import { ContextMenu } from "../desktop/ContextMenu";
import { useEngineState, useIsMobile } from "../useEditor";
import { BoardView, type BoardTarget } from "./BoardView";
import { StoryDetail } from "./StoryDetail";
import { ProductionView } from "./ProductionView";
import { ImportPanel, PromptPanel } from "./StoryImport";
import { useVersionThumbs } from "./useVersionThumbs";
import "./storyboard.css";

type Step = "prompt" | "import" | "production";
/** A short status note; with an action it stays longer so there is time to tap it (V2-SB-R13). */
type Note = { text: string; action?: { label: string; run: () => void } };
const NOTE_MS = 3500, NOTE_ACTION_MS = 8000;

/** Storyboard workspace (V2-M4). Full-screen over the editor so the timeline keeps its state. */
/** `initialOpen` opens that shot or slot right away (timeline "Open in storyboard"). */
/** `onView` closes the board and selects that timeline clip (the "View" action after Send). */
export function StoryboardView({ engine, blobs, onClose, initialOpen, onView }: { engine: Engine; blobs: BlobStore; onClose: () => void; initialOpen?: BoardTarget; onView?: (placementId: string) => void }) {
  const { project, canUndo, canRedo } = useEngineState(engine);
  const thumbs = useVersionThumbs(project, blobs);
  const has = !!project.storyboard;
  const [step, setStep] = useState<Step | undefined>();
  const [note, setNoteState] = useState<Note>();
  const setNote = useCallback((text: string, action?: Note["action"]) => setNoteState({ text, action }), []);
  const [more, setMore] = useState<{ x: number; y: number }>();
  const [confirmReplace, setConfirmReplace] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<BoardTarget | undefined>(initialOpen);
  const mobile = useIsMobile();
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNoteState(undefined), note.action ? NOTE_ACTION_MS : NOTE_MS); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { // The mobile Sheet closes itself on Escape; skip it here so one press doesn't also close the board.
      if (e.key !== "Escape" || e.target instanceof HTMLTextAreaElement || (e.target instanceof Element && e.target.closest(".v2-sheet-backdrop, .v2-cmenu")) || confirmReplace) return;
      (open ? setOpen(undefined) : step ? setStep(undefined) : onClose()); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, step, onClose, confirmReplace]);
  const create = useCallback((doc: StoryDoc) => {
    setOpen(undefined);
    engine.dispatch(cmd.createStoryboard(doc));
    setStep(undefined);
    setNote(has ? "Storyboard replaced — Undo to get the old one back" : `“${doc.meta.title}” is ready`);
  }, [engine, has, setNote]);
  const send = useCallback(() => {
    const plan = board.sendPlan(project), count = (st: string) => plan.filter((x) => x.state === st).length;
    const ready = count("ready"), missing = count("missing");
    const placed = count("placed"), need = missing ? `${missing} shot${missing > 1 ? "s" : ""} still need${missing > 1 ? "" : "s"} a clip` : "";
    if (!ready) { setNote(!placed ? "No clips to send yet — upload a clip for a shot first" : `Already on the timeline — versions you pick here update it${need ? ` · ${need}` : ""}`); return; }
    const ids = (q = engine.getState().project) => ops.mainTrack(q.compositions[q.rootCompositionId])?.placements ?? [];
    const before = new Set(ids().map((x) => x.id));
    engine.dispatch(cmd.sendStoryToTimeline());
    const added = ids().filter((x) => !before.has(x.id));
    const first = [...added].sort((a, b) => a.startTicks - b.startTicks)[0];
    // v1.1: text/media layers, captions and effects sent with the shots (linked to their clip).
    const anchors = new Set(added.map((x) => x.id)), after = engine.getState().project;
    const linked = after.compositions[after.rootCompositionId].tracks.flatMap((t) => t.placements).filter((x) => x.storyLink && anchors.has(x.storyLink.anchor)).length;
    setNote(`Added ${ready} clip${ready > 1 ? "s" : ""}${linked ? ` and ${linked} layer${linked > 1 ? "s" : ""}` : ""} to the end of the timeline${need ? ` · ${need}` : ""}`, first && onView ? { label: "View", run: () => onView(first.id) } : undefined);
  }, [engine, project, onView, setNote]);
  const askReplace = () => setConfirmReplace(true);
  const title = step === "prompt" ? (has ? "AI prompt" : "1 · AI prompt") : step === "import" ? (has ? "Replace storyboard" : "2 · Import JSON") : step === "production" ? "Production" : "Storyboard";
  return (
    <div className="v2-board" role="region" aria-label="Storyboard">
      <header className="v2-board-head">
        <button className="v2-btn v2-sb-btn" aria-label={step ? "Back to storyboard" : "Back to editor"} title={step ? "Back (Esc)" : "Back to the timeline editor (Esc)"} onClick={() => (step ? setStep(undefined) : onClose())}><Ic g="anim-in" size={18} /> <span className={has && !step ? "v2-sb-hide-narrow" : ""}>{step ? "Back" : "Editor"}</span></button>
        <h2>{!(mobile && has && !step) && <Ic g="board" size={18} />} <span className={has && !step ? "v2-sb-hide-narrow" : ""}>{title}</span></h2>
        <span className="v2-spacer" />
        {has && (!step || step === "production") && <>
          <button className="v2-icon v2-sb-icon" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" size={18} /></button>
          <button className="v2-icon v2-sb-icon" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
          {!step && <button className={`v2-btn v2-sb-btn ${mobile ? "v2-sb-prod-icon" : "primary"}`} aria-label="Production steps" title="Step-by-step list: generate, upload, pick and check every asset and clip" onClick={() => { setOpen(undefined); setStep("production"); }}><Ic g="todo" size={18} /> <span className="v2-sb-hide-narrow">Production</span></button>}
          {/* V2-SB-R11: on phones Send is the one labelled primary action; on desktop Production stays primary. */}
          <button className={`v2-btn v2-sb-btn ${mobile ? "primary" : ""}`} aria-label="Send to timeline" title="Add every shot that has a clip to the end of the timeline, in story order. Timeline clips follow the version you pick here." onClick={send}><Ic g="to-timeline" size={18} /> <span>{mobile ? "Send" : "Send to timeline"}</span></button>
          {!step && (mobile ? (
            <button ref={moreBtn} className="v2-icon v2-sb-icon" aria-label="More storyboard actions" aria-haspopup="menu" aria-expanded={!!more} title="AI prompt, Replace storyboard"
              onClick={() => { const r = moreBtn.current!.getBoundingClientRect(); setMore(more ? undefined : { x: r.right - 220, y: r.bottom + 4 }); }}><Ic g="⋯" size={18} /></button>
          ) : <>
            {/* V2-SB-R12: labelled, and Replace is marked destructive and confirmed. */}
            <button className="v2-btn v2-sb-btn" aria-label="AI prompt" title="Copy the AI prompt again" onClick={() => setStep("prompt")}><Ic g="⎘" size={18} /> <span>AI prompt</span></button>
            <button className="v2-btn v2-sb-btn v2-sb-danger" aria-label="Replace storyboard" title="Import a new storyboard JSON (replaces this one; Undo restores it)" onClick={askReplace}><Ic g="json" size={18} /> <span>Replace…</span></button>
          </>)}
        </>}
      </header>
      <div className="v2-board-body">
        {step === "production" && has ? <ProductionView project={project} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} /> : step === "prompt" ? <PromptPanel /> : step === "import" ? <ImportPanel onCreate={create} replacing={has} /> : has ? (
          <BoardView project={project} thumbs={thumbs} onOpen={setOpen} openKey={open && ("slot" in open ? open.slot : open.shot)} />
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
      {has && open && !step && <StoryDetail project={project} target={open} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} onClose={() => setOpen(undefined)} onOpen={setOpen} />}
      {note && <div className="v2-sb-note" role="status"><span>{note.text}</span>{note.action && <button className="v2-sb-note-act" onClick={() => { setNoteState(undefined); note.action!.run(); }}>{note.action.label}</button>}</div>}
      {more && <ContextMenu x={more.x} y={more.y} label="More storyboard actions" onClose={() => setMore(undefined)} items={[
        { label: "AI prompt", icon: "⎘", onSelect: () => setStep("prompt") },
        { label: "Replace storyboard…", icon: "json", danger: true, onSelect: askReplace },
      ]} />}
      {confirmReplace && <ConfirmDialog title="Replace this storyboard?" message="You'll import a new storyboard JSON. It replaces every shot, asset, version pick and check here. Undo brings the current one back." confirm="Continue"
        onCancel={() => setConfirmReplace(false)} onConfirm={() => { setConfirmReplace(false); setOpen(undefined); setStep("import"); }} />}
    </div>
  );
}
