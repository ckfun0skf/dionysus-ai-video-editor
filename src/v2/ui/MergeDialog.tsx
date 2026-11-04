import { useEffect, useMemo, useRef, useState } from "react";
import { TICKS_PER_SECOND, mergeLayer, type Placement } from "../domain";
import { Ic } from "./Icon";

type MergePlan = mergeLayer.MergePlan; type MergeLayout = mergeLayer.MergeLayout;
const { initialLayout, layoutOverlaps, moveInLayout, keepPrimary } = mergeLayer;

const T = TICKS_PER_SECOND;
const end = (p: Placement) => p.startTicks + p.durationTicks;
const sec = (t: number) => `${(t / T).toFixed(1)}s`;
const SNAP_PX = 10;
const ZOOMS = [24, 40, 64, 100, 160, 240]; // px per second
const nameOf = (p: Placement | undefined) => !p ? "Clip" : p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : `${p.clipType[0].toUpperCase()}${p.clipType.slice(1)}`;

/** Snap a dragged clip's start so its start or end meets another clip edge (or 0) within SNAP_PX. */
export function snapStart(start: number, dur: number, edges: number[], pps: number): number {
  const tol = (SNAP_PX / pps) * T;
  let best = start, gap = tol;
  for (const e of [0, ...edges]) for (const s of [e, e - dur]) { const d = Math.abs(s - start); if (d < gap && s >= 0) { gap = d; best = s; } }
  return Math.max(0, Math.round(best));
}

/**
 * P33 "Merge up" conflict dialog: two mini timelines — the upper layer (the one directly above on screen, the merge
 * target) and the incoming layer. Overlaps are hatched red on both lanes. Drag clips left/right on either lane (touch
 * or mouse, snapping to clip edges) or tap "Keep" on a conflict to keep one clip whole and trim the other. Nothing
 * changes until ✓, which is disabled while any overlap remains and applies everything as one undo step.
 */
export function MergeDialog({ plan, onApply, onCancel }: { plan: MergePlan; onApply: (layout: MergeLayout) => void; onCancel: () => void }) {
  const start = useMemo(() => initialLayout(plan), [plan]);
  const [lay, setLay] = useState<MergeLayout>(start);
  const [sel, setSel] = useState<string>();
  const n = useRef(0);
  const ids = () => `${plan.source.id}-k${++n.current}-${Math.random().toString(36).slice(2, 6)}`;
  const span = Math.max(...[...lay.upper, ...lay.incoming].map(end), 1);
  const [zi, setZi] = useState(() => { const fit = 340 / (span / T); return Math.max(0, ZOOMS.filter((z) => z <= fit).length - 1); });
  const pps = ZOOMS[zi];
  const x = (t: number) => (t / T) * pps;
  const width = Math.max(x(span) + 120, 320);
  const overlaps = layoutOverlaps(lay);
  const all = [...lay.upper, ...lay.incoming];
  const find = (id: string) => all.find((p) => p.id === id);
  const drag = useRef<{ id: string; x0: number; s0: number; moved: boolean; pointer: number }>();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onCancel]);

  const onDown = (e: React.PointerEvent, p: Placement) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id: p.id, x0: e.clientX, s0: p.startTicks, moved: false, pointer: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const p = find(d.id)!;
    const edges = all.filter((q) => q.id !== d.id).flatMap((q) => [q.startTicks, end(q)]);
    setLay((l) => moveInLayout(l, d.id, snapStart(d.s0 + (dx / pps) * T, p.durationTicks, edges, pps)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    drag.current = undefined;
    if (!d.moved) setSel((s) => (s === d.id ? undefined : d.id));
  };
  const nudge = (p: Placement, dir: -1 | 1) => setLay((l) => moveInLayout(l, p.id, p.startTicks + dir * T / 10));

  const lane = (label: string, who: "upper" | "incoming", ps: Placement[]) => (
    <div className="v2-merge-lane" data-lane={who} role="group" aria-label={label}>
      {ps.map((p) => {
        const hit = overlaps.some((o) => o.a === p.id || o.b === p.id);
        return (
          <button key={p.id} type="button" className={`v2-merge-clip ${sel === p.id ? "is-active" : ""} ${hit ? "is-hit" : ""}`} data-clip={p.id}
            style={{ left: x(p.startTicks), width: Math.max(x(p.durationTicks), 12) }}
            aria-label={`${nameOf(p)}, ${sec(p.startTicks)}–${sec(end(p))}. Drag to move, arrow keys nudge`}
            onPointerDown={(e) => onDown(e, p)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); nudge(p, -1); } if (e.key === "ArrowRight") { e.preventDefault(); nudge(p, 1); } }}>
            <span>{nameOf(p)}</span>
          </button>
        );
      })}
      {overlaps.map((o, i) => <i key={i} className="v2-merge-hatch" aria-hidden style={{ left: x(o.startTicks), width: Math.max(x(o.endTicks - o.startTicks), 2) }} />)}
    </div>
  );

  const ok = overlaps.length === 0;
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div className="v2-confirm v2-merge" role="dialog" aria-modal="true" aria-label="Merge layer up" onPointerDown={(e) => e.stopPropagation()}>
        <div className="v2-merge-head">
          <button className="v2-icon" aria-label="Cancel merge" title="Cancel" onClick={onCancel}><Ic g="✕" /></button>
          <h4><Ic g="merge" size={18} /> Merge into {plan.target.name}</h4>
          <button className="v2-icon v2-merge-ok" aria-label="Apply merge" title={ok ? "Merge (one undo step)" : "Clear every red overlap first"} disabled={!ok} onClick={() => ok && onApply(lay)}><Ic g="✓" /></button>
        </div>
        <p className="v2-merge-status" role="status">{ok ? "No overlaps left. ✓ merges as one undo step." : `${overlaps.length} overlap${overlaps.length === 1 ? "" : "s"} (red). Drag clips apart or keep one clip.`}</p>
        <div className="v2-merge-tools">
          <button className="v2-icon" aria-label="Zoom out" disabled={zi === 0} onClick={() => setZi((z) => Math.max(0, z - 1))}><Ic g="－" /></button>
          <button className="v2-icon" aria-label="Zoom in" disabled={zi === ZOOMS.length - 1} onClick={() => setZi((z) => Math.min(ZOOMS.length - 1, z + 1))}><Ic g="+" /></button>
          <button className="v2-icon" aria-label="Reset" title="Undo my changes here" disabled={lay === start} onClick={() => { setLay(start); setSel(undefined); }}><Ic g="↶" /></button>
        </div>
        <div className="v2-merge-names"><span>Upper · {plan.target.name}</span><span>Incoming · {plan.source.name}</span></div>
        <div className="v2-merge-scroll">
          <div className="v2-merge-lanes" style={{ width }}>
            {lane(`Upper layer ${plan.target.name}`, "upper", lay.upper)}
            {lane(`Incoming layer ${plan.source.name}`, "incoming", lay.incoming)}
          </div>
        </div>
        {!ok && (
          <ul className="v2-merge-list" aria-label="Overlaps">
            {overlaps.map((o) => (
              <li key={`${o.a}-${o.b}`} className={`v2-merge-row ${sel === o.a || sel === o.b ? "is-active" : ""}`}>
                <span className="v2-merge-what">{sec(o.startTicks)}–{sec(o.endTicks)}</span>
                {[o.a, o.b].map((id) => <button key={id} className="v2-merge-keep" data-keep={id} onClick={() => { setLay((l) => keepPrimary(l, id, ids)); setSel(undefined); }}>Keep {nameOf(find(id))}</button>)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
