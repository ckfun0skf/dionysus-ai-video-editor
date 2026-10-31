import { board, type Project } from "../../domain";
import { Ic } from "../Icon";
import type { BoardTarget } from "./BoardView";

/** P15: "Prepare references": frameOf picks still to do (or to re-check), in generation order. Hidden when none. */
export function PrepareReferences({ project, onOpen }: { project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const items = board.pendingFrameRefs(project);
  if (!items.length) return null;
  const no = (id: string) => b.order.indexOf(id) + 1;
  return (
    <section className="v2-sb-prepare" aria-label="Prepare references" data-testid="prepare-references">
      <h4><Ic g="⚠" size={14} /> Prepare references ({items.length})</h4>
      <ol>
        {items.map(({ slotId, targetShot, st }) => (
          <li key={slotId}>
            <button className="v2-sb-prepare-item" onClick={() => onOpen({ slot: slotId })}>
              <b>Shot {no(targetShot)}: {st.state === "no-source" ? `Generate Shot ${no(st.sourceShot)} first` : st.state === "changed" ? board.FRAME_CHANGED : `Pick frame from Shot ${no(st.sourceShot)}`}</b>
              <em>{st.frameDesc}</em>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
