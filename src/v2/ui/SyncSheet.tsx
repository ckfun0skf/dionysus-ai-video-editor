/** P10-SYNC: review sheet for Sync to Storyboard: lists what the timeline would write back; Confirm applies it (one undo). */
import { useEffect } from "react";
import { cmd, type Engine } from "../engine";
import { syncPlan, type Project } from "../domain";

export function SyncSheet({ engine, project, onDone }: { engine: Engine; project: Project; onDone: (msg?: string) => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onDone]);
  const { changes } = syncPlan(project);
  const flagged = changes.filter((c) => c.needsPrompt).length;
  const apply = () => {
    engine.dispatch(cmd.syncToStoryboard());
    onDone(`Synced ${changes.length} change${changes.length === 1 ? "" : "s"} to the storyboard${flagged ? ` · ${flagged} need a description / prompt` : ""}`);
  };
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={() => onDone()}>
      <div className="v2-confirm v2-sync-sheet" role="dialog" aria-modal="true" aria-label="Sync to storyboard" onPointerDown={(e) => e.stopPropagation()}>
        <h4>Sync to storyboard</h4>
        {!project.storyboard ? <p>There is no storyboard in this project yet.</p> : !changes.length ? <p>The storyboard already matches the timeline.</p> : <>
          <p>These timeline edits will be written to the storyboard. Shots and layers removed from the timeline are kept and flagged. Undo reverts it.</p>
          <ul className="v2-sync-list" data-testid="sync-changes">
            {changes.map((c) => <li key={`${c.kind}:${c.id}`} className={`v2-sync-${c.kind}`}>{c.label}{c.needsPrompt && <span className="v2-needs-prompt">⚠ Needs description / prompt</span>}</li>)}
          </ul>
        </>}
        <div className="v2-confirm-actions">
          <button className="v2-btn" onClick={() => onDone()}>Cancel</button>
          {!!changes.length && <button className="v2-btn primary" data-testid="sync-confirm" autoFocus onClick={apply}>Sync {changes.length} change{changes.length === 1 ? "" : "s"}</button>}
        </div>
      </div>
    </div>
  );
}
