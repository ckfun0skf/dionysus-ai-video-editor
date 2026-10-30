import { useCallback, useEffect, useRef, useState } from "react";
import { board, ops, pendingAudio, storyEdit, storyRefs, type AssetSlot, type Shot, type StoryDoc } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { ConfirmDialog } from "../Timeline";
import { ContextMenu } from "../desktop/ContextMenu";
import { useEngineState, useIsMobile } from "../useEditor";
import { haptic } from "../gestures";
import { BoardView, type BoardEdit, type BoardTarget } from "./BoardView";
import { ActionSheet, ConnectionEditor, ShotEditor } from "./ShotEditor";
import { SlotEditor } from "./SlotEditor";
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
  // V2-CUT-02: shot editing. `editing.after` set = a new shot not yet added (Save adds it, one undo step).
  const [editing, setEditing] = useState<{ shot: string; after?: string | null }>();
  const [conn, setConn] = useState<{ from: string; to: string }>();
  const [shotMenu, setShotMenu] = useState<{ shot: string; at?: { x: number; y: number } }>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  // V2-CUT-05: asset slot editing. `slot` absent = a new asset (Save adds it).
  const [editingSlot, setEditingSlot] = useState<{ slot?: string }>();
  const [confirmSlotDelete, setConfirmSlotDelete] = useState<string>();
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNoteState(undefined), note.action ? NOTE_ACTION_MS : NOTE_MS); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { // The mobile Sheet closes itself on Escape; skip it here so one press doesn't also close the board.
      if (e.key !== "Escape" || e.defaultPrevented || e.target instanceof HTMLTextAreaElement || (e.target instanceof Element && e.target.closest(".v2-sheet-backdrop, .v2-cmenu, .v2-sb-actsheet-backdrop")) || confirmReplace || confirmDelete || confirmSlotDelete || shotMenu) return;
      (editing ? setEditing(undefined) : editingSlot ? setEditingSlot(undefined) : conn ? setConn(undefined) : open ? setOpen(undefined) : step ? setStep(undefined) : onClose()); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, step, onClose, confirmReplace, confirmDelete, confirmSlotDelete, shotMenu, editing, editingSlot, conn]);
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
    const cuesWaiting = pendingAudio(project).length;
    if (!ready && !cuesWaiting) { setNote(!placed ? "No clips to send yet — upload a clip for a shot first" : `Already on the timeline — versions you pick here update it${need ? ` · ${need}` : ""}`); return; }
    const ids = (q = engine.getState().project) => ops.mainTrack(q.compositions[q.rootCompositionId])?.placements ?? [];
    const audioIds = (q = engine.getState().project) => q.compositions[q.rootCompositionId].tracks.flatMap((t) => (t.kind === "audio" ? t.placements.map((x) => x.id) : []));
    const before = new Set(ids().map((x) => x.id)), audioBefore = new Set(audioIds());
    engine.dispatch(cmd.sendStoryToTimeline());
    const added = ids().filter((x) => !before.has(x.id));
    const first = [...added].sort((a, b) => a.startTicks - b.startTicks)[0];
    // v1.1: text/media layers, captions and effects sent with the shots (linked to their clip).
    const anchors = new Set(added.map((x) => x.id)), after = engine.getState().project;
    const linked = after.compositions[after.rootCompositionId].tracks.flatMap((t) => t.placements).filter((x) => x.storyLink && anchors.has(x.storyLink.anchor) && x.clipType !== "audio").length;
    // V2-SB-125: audio cues (some span shots, so they are not linked).
    const audio = audioIds(after).filter((x) => !audioBefore.has(x)).length;
    const parts = [ready && `${ready} clip${ready > 1 ? "s" : ""}`, linked && `${linked} layer${linked > 1 ? "s" : ""}`, audio && `${audio} audio cue${audio > 1 ? "s" : ""}`].filter(Boolean);
    const what = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    setNote(`Added ${what} to the end of the timeline${need ? ` · ${need}` : ""}`, first && onView ? { label: "View", run: () => onView(first.id) } : undefined);
  }, [engine, project, onView, setNote]);
  const askReplace = () => setConfirmReplace(true);

  /* V2-CUT-02: board editing. Every change is one undo step; notes say what else changed. */
  const sb = project.storyboard;
  const no = (id: string) => (sb ? sb.order.indexOf(id) + 1 : 0);
  const undoAction = { label: "Undo", run: () => engine.undo() };
  const moveTo = (id: string, to: number) => {
    if (!sb) return;
    const from = sb.order.indexOf(id);
    if (from < 0 || to === from) return;
    const lost = storyEdit.connectionsLostByMove(sb, storyEdit.orderAfterMove(sb, id, to));
    engine.dispatch(cmd.moveShot(id, to));
    haptic(8);
    const what = lost.map((c) => (c.transition ? "transition" : c.kind === "continuity" ? "continuity link" : c.kind === "match" ? "match cut" : "note")).filter((x, i, a) => a.indexOf(x) === i).join(" and ");
    setNote(`Moved “${sb.shots[id].title}” to shot ${to + 1}${lost.length ? ` · its ${what} with the old neighbour is off until they’re next to each other again` : ""} · Clips already on the timeline keep their place`, undoAction);
  };
  const newShot = (after?: string) => { setOpen(undefined); setConn(undefined); setEditingSlot(undefined); setEditing({ shot: storyEdit.nextShotId(sb!), after: after ?? (sb!.order.at(-1) ?? null) }); };
  const duplicate = (id: string) => {
    const copy = storyEdit.nextShotId(sb!);
    engine.dispatch(cmd.duplicateShot(id, copy));
    setNote(`Duplicated as shot ${no(id) + 1} (no clip versions${sb!.shots[id].clipSlot ? "; it shares the same HTML/still" : ""})`, { label: "Open", run: () => setOpen({ shot: copy }) });
  };
  const remove = (id: string) => {
    engine.dispatch(cmd.deleteShot(id));
    if (open && "shot" in open && open.shot === id) setOpen(undefined);
    setEditing(undefined); setConn(undefined);
    setNote("Shot deleted · Its clips stay in the media library and on the timeline", undoAction);
  };
  const boardEdit: BoardEdit = {
    move: moveTo,
    menu: (id, at) => setShotMenu({ shot: id, at: mobile ? undefined : at }),
    remove: (id) => setConfirmDelete(id),
    add: () => newShot(),
    addAsset: () => { setOpen(undefined); setConn(undefined); setEditing(undefined); setEditingSlot({}); },
    connection: (from, to) => { setOpen(undefined); setEditing(undefined); setEditingSlot(undefined); setConn({ from, to }); },
  };
  const shotActions = (id: string) => {
    const i = no(id) - 1, last = (sb?.order.length ?? 0) - 1;
    return [
      { label: "Edit shot", icon: "✎", shortcut: undefined as string | undefined, onSelect: () => { setOpen(undefined); setConn(undefined); setEditingSlot(undefined); setEditing({ shot: id }); } },
      { label: "Duplicate", icon: "⧉", onSelect: () => duplicate(id) },
      { label: "Insert shot after", icon: "+", onSelect: () => newShot(id) },
      { label: "Move up", icon: "↑", shortcut: mobile ? undefined : "Alt+↑", disabled: i <= 0, onSelect: () => moveTo(id, i - 1) },
      { label: "Move down", icon: "↓", shortcut: mobile ? undefined : "Alt+↓", disabled: i >= last, onSelect: () => moveTo(id, i + 1) },
      { label: "Delete shot…", icon: "🗑", shortcut: mobile ? undefined : "Del", danger: true, onSelect: () => setConfirmDelete(id) },
    ];
  };
  const deleteMessage = (id: string) => {
    if (!sb?.shots[id]) return "";
    const fx = storyEdit.deleteShotEffects(sb, id);
    const parts = ["Its clip versions stay in the media library, and clips already on the timeline stay where they are."];
    if (fx.frames.length) parts.push(`${fx.frames.map((f) => `“${f.name}”`).join(", ")} ${fx.frames.length > 1 ? "were" : "was"} taken from its last frame and will become ${fx.frames.length > 1 ? "uploads" : "an upload"} (versions kept).`);
    parts.push("Undo brings the shot back.");
    return parts.join(" ");
  };
  const editShot: Shot | undefined = editing && sb ? sb.shots[editing.shot] ?? (editing.after !== undefined ? { id: editing.shot, title: "New shot", description: "", durationSec: storyEdit.DEFAULT_SHOT_SEC, prompt: "", slotIds: [], qa: [] } : undefined) : undefined;
  const isNew = !!editing && !!sb && !sb.shots[editing.shot];
  const saveShot = (patch: storyEdit.ShotPatch) => {
    if (!editing) return;
    if (isNew) {
      engine.dispatch(cmd.addShot(editing.shot, patch, editing.after));
      setNote(`Added shot ${no(editing.after ?? "") + 1}`, { label: "Open", run: () => setOpen({ shot: editing.shot }) });
    } else engine.dispatch(cmd.updateShot(editing.shot, patch));
    setEditing(undefined);
    if (!isNew && !mobile) setOpen({ shot: editing.shot });
  };
  const blankSlot: AssetSlot | undefined = sb ? { id: "new-asset", name: "", type: "image", aspect: sb.meta.aspect || "16:9", prompt: "", references: [], source: { type: "generate" }, qa: [] } : undefined;
  const editSlot = editingSlot && sb ? (editingSlot.slot ? sb.slots[editingSlot.slot] : blankSlot) : undefined;
  const saveSlot = (patch: storyRefs.SlotPatch) => {
    if (!editingSlot || !sb) return;
    if (!editingSlot.slot) {
      const id = storyRefs.nextSlotId(sb, patch.name ?? "asset");
      engine.dispatch(cmd.addSlot(id, { ...patch, qa: patch.qa?.map((q, i) => ({ ...q, id: `${id}.qa${i + 1}` })) }));
      setNote(`Added “${patch.name?.trim()}” · Add it to shots from Edit shot`, { label: "Open", run: () => setOpen({ slot: id }) });
      setEditingSlot(undefined);
      if (!mobile) setOpen({ slot: id });
      return;
    }
    engine.dispatch(cmd.updateSlot(editingSlot.slot, patch));
    setEditingSlot(undefined);
    if (!mobile) setOpen({ slot: editingSlot.slot });
  };
  const removeSlot = (id: string) => {
    const name = sb?.slots[id]?.name;
    engine.dispatch(cmd.deleteSlot(id));
    if (open && "slot" in open && open.slot === id) setOpen(undefined);
    setEditingSlot(undefined);
    setNote(`Deleted “${name}” · Its versions stay in the media library`, undoAction);
  };
  const slotDeleteMessage = (id: string) => {
    const u = sb && storyRefs.slotUse(sb, id);
    if (!u) return "";
    const parts: string[] = [];
    if (u.shots.length) parts.push(`It is removed from shot ${u.shots.map(no).join(", ")}${u.pinnedBy.length ? " (and their pins)" : ""}.`);
    if (u.refOf.length) parts.push(`${u.refOf.map((s) => `“${sb!.slots[s].name}”`).join(", ")} will no longer list it as made from.`);
    parts.push("Its versions stay in the media library. Undo brings it back.");
    return parts.join(" ");
  };
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
        {step === "production" && has ? <ProductionView project={project} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} onNote={setNote} /> : step === "prompt" ? <PromptPanel /> : step === "import" ? <ImportPanel onCreate={create} replacing={has} /> : has ? (
          <BoardView project={project} thumbs={thumbs} onOpen={(t) => { setEditing(undefined); setEditingSlot(undefined); setConn(undefined); setOpen(t); }} openKey={editing?.shot ?? editingSlot?.slot ?? (open && ("slot" in open ? open.slot : open.shot))} edit={boardEdit} mobile={mobile} />
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
      {has && open && !step && !editing && !editingSlot && !conn && <StoryDetail project={project} target={open} thumbs={thumbs} engine={engine} blobs={blobs} mobile={mobile} onClose={() => setOpen(undefined)} onOpen={setOpen}
        onEdit={"shot" in open ? () => setEditing({ shot: open.shot }) : () => setEditingSlot({ slot: open.slot })} />}
      {has && editSlot && !step && !editing && <SlotEditor key={editingSlot!.slot ?? "new"} project={project} slot={editSlot} isNew={!editingSlot!.slot} mobile={mobile}
        onSave={saveSlot} onCancel={() => setEditingSlot(undefined)} onDelete={() => setConfirmSlotDelete(editSlot.id)} />}
      {confirmSlotDelete && sb?.slots[confirmSlotDelete] && <ConfirmDialog title={`Delete asset “${sb.slots[confirmSlotDelete].name}”?`} message={slotDeleteMessage(confirmSlotDelete)} confirm="Delete"
        onCancel={() => setConfirmSlotDelete(undefined)} onConfirm={() => { const id = confirmSlotDelete; setConfirmSlotDelete(undefined); removeSlot(id); }} />}
      {has && editShot && !step && <ShotEditor key={editing!.shot} project={project} shot={editShot} number={isNew ? no(editing!.after ?? "") + 1 : no(editShot.id)} isNew={isNew} mobile={mobile}
        onSave={saveShot} onCancel={() => setEditing(undefined)} onDelete={() => setConfirmDelete(editShot.id)} />}
      {has && conn && !step && sb && storyEdit.adjacent(sb, conn.from, conn.to) && <ConnectionEditor project={project} from={conn.from} to={conn.to} mobile={mobile}
        onChange={(patch) => engine.dispatch(cmd.setConnection(conn.from, conn.to, patch))} onClose={() => setConn(undefined)} />}
      {shotMenu && sb?.shots[shotMenu.shot] && (shotMenu.at
        ? <ContextMenu x={shotMenu.at.x} y={shotMenu.at.y} label={`Shot ${no(shotMenu.shot)} actions`} onClose={() => setShotMenu(undefined)} items={shotActions(shotMenu.shot).flatMap((a, i) => (i === 5 || i === 3 ? ["sep" as const, a] : [a]))} />
        : <ActionSheet title={`Shot ${no(shotMenu.shot)} · ${sb.shots[shotMenu.shot].title}`} actions={shotActions(shotMenu.shot)} onClose={() => setShotMenu(undefined)} />)}
      {confirmDelete && sb?.shots[confirmDelete] && <ConfirmDialog title={`Delete shot ${no(confirmDelete)} “${sb.shots[confirmDelete].title}”?`} message={deleteMessage(confirmDelete)} confirm="Delete"
        onCancel={() => setConfirmDelete(undefined)} onConfirm={() => { const id = confirmDelete; setConfirmDelete(undefined); remove(id); }} />}
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
