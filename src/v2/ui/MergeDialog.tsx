import { useEffect, useState } from "react";
import { TICKS_PER_SECOND, mergeLayer, type Composition, type Placement } from "../domain";

type MergePlan = mergeLayer.MergePlan; type MergeResolve = mergeLayer.MergeResolve;
const { MERGE_RESOLVE_LABEL, MERGE_RESOLVES } = mergeLayer;
import { Ic } from "./Icon";

const HINT: Record<MergeResolve, string> = {
  shift: "Move the incoming clip later, to the first gap that fits it",
  trimExisting: "Cut the existing clip away under the incoming one",
  trimIncoming: "Keep only the parts of the incoming clip that fall in gaps",
  pushLater: "Push the existing clips later to make room",
};
const sec = (t: number) => `${(t / TICKS_PER_SECOND).toFixed(1)}s`;
const nameOf = (_comp: Composition, p: Placement | undefined) => !p ? "Clip" : p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : `${p.clipType[0].toUpperCase()}${p.clipType.slice(1)} clip`;

/**
 * P32: "Merge up" conflict dialog. One row per incoming clip that overlaps a clip on the target layer, each with its
 * own choice (an "All" row sets every one). ✕ cancels, ✓ applies the merge as one undo step.
 */
export function MergeDialog({ comp, plan, onApply, onCancel }: { comp: Composition; plan: MergePlan; onApply: (r: Record<string, MergeResolve>) => void; onCancel: () => void }) {
  const [res, setRes] = useState<Record<string, MergeResolve>>(() => Object.fromEntries(plan.conflicts.map((c) => [c.incomingId, "shift" as MergeResolve])));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onCancel]);
  const all = (r: MergeResolve) => setRes(Object.fromEntries(plan.conflicts.map((c) => [c.incomingId, r])));
  const same = new Set(Object.values(res)).size === 1 ? Object.values(res)[0] : undefined;
  const find = (id: string) => plan.source.placements.find((p) => p.id === id) ?? plan.target.placements.find((p) => p.id === id);
  const seg = (value: MergeResolve | undefined, set: (r: MergeResolve) => void, label: string) => (
    <div className="v2-merge-seg" role="radiogroup" aria-label={label}>
      {MERGE_RESOLVES.map((r) => <button key={r} role="radio" aria-checked={value === r} className={`v2-merge-opt ${value === r ? "is-active" : ""}`} title={HINT[r]} onClick={() => set(r)}>{MERGE_RESOLVE_LABEL[r]}</button>)}
    </div>
  );
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div className="v2-confirm v2-merge" role="dialog" aria-modal="true" aria-label="Merge layer up" onPointerDown={(e) => e.stopPropagation()}>
        <div className="v2-merge-head">
          <button className="v2-icon" aria-label="Cancel merge" title="Cancel" onClick={onCancel}><Ic g="✕" /></button>
          <h4><Ic g="merge" size={18} /> Merge into {plan.target.name}</h4>
          <button className="v2-icon v2-merge-ok" aria-label="Apply merge" title="Merge (one undo step)" onClick={() => onApply(res)}><Ic g="✓" /></button>
        </div>
        <p>{plan.conflicts.length} clip{plan.conflicts.length === 1 ? "" : "s"} from {plan.source.name} overlap{plan.conflicts.length === 1 ? "s" : ""} clips on {plan.target.name}. Choose what happens to each.</p>
        {plan.conflicts.length > 1 && <section className="v2-merge-row v2-merge-all"><div className="v2-merge-what">All clips</div>{seg(same, all, "All clips")}</section>}
        <div className="v2-merge-list">
          {plan.conflicts.map((c) => (
            <section key={c.incomingId} className="v2-merge-row" data-incoming={c.incomingId}>
              <div className="v2-merge-what"><b>{nameOf(comp, find(c.incomingId))}</b> overlaps {c.existingIds.map((id) => nameOf(comp, find(id))).join(", ")} · {sec(c.startTicks)}–{sec(c.endTicks)}</div>
              {seg(res[c.incomingId], (r) => setRes((s) => ({ ...s, [c.incomingId]: r })), `Overlap of ${nameOf(comp, find(c.incomingId))}`)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
