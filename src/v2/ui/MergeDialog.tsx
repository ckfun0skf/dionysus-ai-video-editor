import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TICKS_PER_SECOND, mergeLayer, type Composition, type Placement, type Project, type Track } from "../domain";
import type { Filmstrip, Peaks } from "./media";
import { clampPps } from "./gestures";
import { Ic } from "./Icon";
import { ClipBody, clipNoThumb, clipThumbStyle, effectName, useTimelineZoom } from "./TimelineClip";

type MergePlan = mergeLayer.MergePlan; type MergeLayout = mergeLayer.MergeLayout;
const { initialLayout, layoutOverlaps, moveInLayout, keepPrimary, trimThis, trimInLayout, previewLayout } = mergeLayer;

const T = TICKS_PER_SECOND;
const end = (p: Placement) => p.startTicks + p.durationTicks;
const sec = (t: number) => `${(t / T).toFixed(1)}s`;
const SNAP_PX = 10;
const nameOf = (p: Placement | undefined, project?: Project) => !p ? "Clip" : p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : p.clipType === "effect" ? effectName(p) : project?.assets[p.source.assetId]?.name ?? p.clipType;

/** Snap a dragged clip's start so its start or end meets another clip edge (or 0) within SNAP_PX. */
export function snapStart(start: number, dur: number, edges: number[], pps: number): number {
  const tol = (SNAP_PX / pps) * T;
  let best = start, gap = tol;
  for (const e of [0, ...edges]) for (const s of [e, e - dur]) { const d = Math.abs(s - start); if (d < gap && s >= 0) { gap = d; best = s; } }
  return Math.max(0, Math.round(best));
}
/** Snap a dragged edge to the nearest other clip edge within SNAP_PX. */
export function snapEdge(t: number, edges: number[], pps: number): number {
  const tol = (SNAP_PX / pps) * T;
  let best = t, gap = tol;
  for (const e of [0, ...edges]) { const d = Math.abs(e - t); if (d < gap) { gap = d; best = e; } }
  return Math.round(best);
}

/** Pixels per second that fit `[s, e)` into about half of a `view`-wide scroller. */
export const fitPps = (s: number, e: number, view: number) => clampPps((view * 0.5) / Math.max((e - s) / T, 0.1));

interface Item { a: string; b: string; s0: number; e0: number }

/**
 * P34 "Merge up" conflict panel, docked at the bottom so the real preview stays visible above it and shows the merged
 * result at the panel's playhead. Two lanes drawn with the timeline's own clip look (thumbnails, filmstrip, names):
 * the upper layer (directly above on screen, the merge target) and the incoming layer. Pinch / Ctrl+wheel zooms,
 * drag moves (snapping to clip edges), the selected clip's handles trim / extend it. Clips in no conflict are dimmed,
 * unresolved ones have a yellow border, resolved ones turn green. ‹ › jump between overlaps. Selecting a conflicting clip
 * shows Trim this / Trim others. Nothing changes until ✓ (disabled while any overlap remains), one undo step.
 */
export function MergeDialog({ plan, comp, project, thumbs, strips, peaks, time, playing, onSeek, onPlay, onDraft, onApply, onCancel }: {
  plan: MergePlan; comp: Composition; project: Project; thumbs?: Record<string, string>; strips?: Record<string, Filmstrip>; peaks?: Record<string, Peaks>;
  time: number; playing: boolean; onSeek: (t: number) => void; onPlay?: (play: boolean) => void; onDraft?: (c?: Composition) => void;
  onApply: (layout: MergeLayout) => void; onCancel: () => void;
}) {
  const start = useMemo(() => initialLayout(plan), [plan]);
  const [lay, setLay] = useState<MergeLayout>(start);
  const [sel, setSel] = useState<string>();
  const initial = useMemo(() => layoutOverlaps(start), [start]);
  const involved = useRef(new Set(initial.flatMap((o) => [o.a, o.b])));
  const n = useRef(0);
  const ids = () => { const id = `${plan.source.id}-k${++n.current}-${Math.random().toString(36).slice(2, 6)}`; involved.current.add(id); return id; };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(60);
  const [cur, setCur] = useState(0);
  useTimelineZoom(scrollRef, pps, (z) => setPps(clampPps(z)));
  const toPx = (t: number) => (t / T) * pps;
  const all = [...lay.upper, ...lay.incoming];
  const find = (id: string) => all.find((p) => p.id === id);
  const overlaps = layoutOverlaps(lay);
  const hot = new Set(overlaps.flatMap((o) => [o.a, o.b]));
  const span = Math.max(...all.map(end), 1);
  const items: Item[] = [...initial.map((o) => ({ a: o.a, b: o.b, s0: o.startTicks, e0: o.endTicks })),
    ...overlaps.filter((o) => !initial.some((i) => (i.a === o.a && i.b === o.b) || (i.a === o.b && i.b === o.a))).map((o) => ({ a: o.a, b: o.b, s0: o.startTicks, e0: o.endTicks }))];
  const live = (it: Item) => overlaps.find((o) => (o.a === it.a && o.b === it.b) || (o.a === it.b && o.b === it.a));
  const rangeOf = (it: Item): [number, number] => {
    const o = live(it); if (o) return [o.startTicks, o.endTicks];
    const ps = [find(it.a), find(it.b)].filter(Boolean) as Placement[];
    return ps.length ? [Math.min(...ps.map((p) => p.startTicks)), Math.max(...ps.map(end))] : [it.s0, it.e0];
  };
  const resolvedItem = (it: Item) => !live(it);
  const pending = useRef<[number, number]>();
  const focus = (i: number) => {
    const it = items[(i + items.length) % items.length]; if (!it) return;
    setCur((i + items.length) % items.length);
    const [s, e] = rangeOf(it);
    const view = scrollRef.current?.clientWidth || 360;
    setPps(fitPps(s, e, view));
    pending.current = [s, e];
    onSeek(Math.round((s + e) / 2));
  };
  useLayoutEffect(() => {
    const el = scrollRef.current, r = pending.current; if (!el || !r) return;
    pending.current = undefined;
    el.scrollLeft = Math.max(0, toPx((r[0] + r[1]) / 2) - el.clientWidth / 2);
  });
  useEffect(() => { focus(0); }, []);
  useEffect(() => { onDraft?.(previewLayout(comp, plan, lay)); }, [lay, comp, plan, onDraft]);
  useEffect(() => () => { onDraft?.(undefined); onPlay?.(false); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onCancel]);

  const maxSrc = (p: Placement) => { const a = project.assets[p.source.assetId]; return a?.kind === "image" ? undefined : a?.versions.find((v) => v.id === p.source.versionId)?.media.durationTicks; };
  const drag = useRef<{ id: string; kind: "move" | "left" | "right"; x0: number; base: MergeLayout; p0: Placement; moved: boolean; pointer: number }>();
  const begin = (e: React.PointerEvent, p: Placement, kind: "move" | "left" | "right") => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id: p.id, kind, x0: e.clientX, base: lay, p0: p, moved: false, pointer: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const dt = (dx / pps) * T;
    const edges = [...d.base.upper, ...d.base.incoming].filter((q) => q.id !== d.id).flatMap((q) => [q.startTicks, end(q)]);
    if (d.kind === "move") setLay(moveInLayout(d.base, d.id, snapStart(d.p0.startTicks + dt, d.p0.durationTicks, edges, pps)));
    else setLay(trimInLayout(d.base, d.id, d.kind, snapEdge((d.kind === "left" ? d.p0.startTicks : end(d.p0)) + dt, edges, pps), maxSrc(d.p0)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    drag.current = undefined;
    if (!d.moved && d.kind === "move") setSel((s) => (s === d.id ? undefined : d.id));
  };
  const nudge = (p: Placement, dir: -1 | 1) => setLay((l) => moveInLayout(l, p.id, p.startTicks + dir * T / 10));
  const seekAt = (e: React.PointerEvent) => {
    const el = scrollRef.current; if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    onSeek(Math.max(0, Math.round((x / pps) * T)));
  };
  const width = Math.max(toPx(span) + 200, 320);
  const step = pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 12 ? 5 : 10;
  const ticks = Array.from({ length: Math.ceil(width / pps / step) + 1 }, (_, i) => i * step);

  const lane = (label: string, who: "upper" | "incoming", track: Track, ps: Placement[]) => (
    <div className={`v2-lane v2-merge-lane kind-${track.kind}`} data-lane={who} role="group" aria-label={label} onPointerDown={(e) => { if (e.target === e.currentTarget) { setSel(undefined); seekAt(e); } }}>
      <span className="v2-merge-lane-name" aria-hidden>{who === "upper" ? "Upper" : "Incoming"} · {track.name}</span>
      {ps.map((p) => {
        const state = hot.has(p.id) ? "is-conflict" : involved.current.has(p.id) ? "is-resolved" : "is-dim";
        const isSel = sel === p.id;
        return (
          <div key={p.id} role="button" tabIndex={0} className={`v2-clip clip-${p.clipType} v2-merge-clip ${state} ${isSel ? "is-selected" : ""} ${clipNoThumb(p, thumbs, strips) ? "is-nothumb" : ""}`} data-clip={p.id} data-state={state.slice(3)}
            style={{ left: toPx(p.startTicks), width: Math.max(4, toPx(p.durationTicks)), ...clipThumbStyle(p, thumbs, strips) }}
            aria-pressed={isSel} aria-label={`${nameOf(p, project)}, ${sec(p.startTicks)}–${sec(end(p))}${state === "is-conflict" ? ", overlaps" : state === "is-resolved" ? ", resolved" : ""}. Drag to move, arrow keys nudge`}
            onPointerDown={(e) => begin(e, p, "move")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); nudge(p, -1); } if (e.key === "ArrowRight") { e.preventDefault(); nudge(p, 1); } if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel((s) => (s === p.id ? undefined : p.id)); } }}>
            <ClipBody p={p} track={track} isMain={false} project={project} pps={pps} strips={strips} peaks={peaks} />
            {isSel && <>
              <div className="v2-handle left" aria-label="Trim start" onPointerDown={(e) => begin(e, p, "left")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
              <div className="v2-handle right" aria-label="Trim end" onPointerDown={(e) => begin(e, p, "right")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
            </>}
          </div>
        );
      })}
      {overlaps.map((o, i) => <i key={i} className="v2-merge-hatch" aria-hidden style={{ left: toPx(o.startTicks), width: Math.max(toPx(o.endTicks - o.startTicks), 2) }} />)}
    </div>
  );

  const ok = overlaps.length === 0;
  const selHot = sel && hot.has(sel) ? sel : undefined;
  const it = items[cur];
  return (
    <div className="v2-merge-backdrop">
      <div className="v2-confirm v2-merge" role="dialog" aria-modal="true" aria-label="Merge layer up">
        <div className="v2-merge-head">
          <button className="v2-icon" aria-label="Cancel merge" title="Cancel" onClick={onCancel}><Ic g="✕" /></button>
          <h4><Ic g="merge" size={18} /> Merge into {plan.target.name}</h4>
          <button className="v2-icon v2-merge-ok" aria-label="Apply merge" title={ok ? "Merge (one undo step)" : "Resolve every yellow overlap first"} disabled={!ok} onClick={() => ok && onApply(lay)}><Ic g="✓" /></button>
        </div>
        <div className="v2-merge-nav">
          <button className="v2-icon" aria-label="Previous overlap" disabled={items.length < 2} onClick={() => focus(cur - 1)}><Ic g="prev" /></button>
          <span className="v2-merge-count" role="status">{items.length ? `${cur + 1} of ${items.length}` : "0 of 0"}<small className={it && resolvedItem(it) ? "is-ok" : ""}>{it ? (resolvedItem(it) ? "Resolved" : "Overlap") : ""} · {ok ? "all clear" : `${overlaps.length} left`}</small></span>
          <button className="v2-icon" aria-label="Next overlap" disabled={items.length < 2} onClick={() => focus(cur + 1)}><Ic g="next" /></button>
          <span className="v2-merge-spacer" />
          <span className="v2-merge-time">{sec(time)}</span>
          <button className="v2-icon" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => onPlay?.(!playing)}><Ic g={playing ? "❚❚" : "▶"} /></button>
        </div>
        <div className="v2-merge-scroll" ref={scrollRef}>
          <div className="v2-merge-lanes" style={{ width }}>
            <div className="v2-merge-ruler" onPointerDown={(e) => { setSel(undefined); seekAt(e); }}>
              {ticks.map((s) => <span key={s} style={{ left: s * pps }}>{s}s</span>)}
            </div>
            {lane(`Upper layer ${plan.target.name}`, "upper", plan.target, lay.upper)}
            {lane(`Incoming layer ${plan.source.name}`, "incoming", plan.source, lay.incoming)}
            <div className="v2-merge-playhead" style={{ left: toPx(time) }} aria-hidden />
          </div>
        </div>
        {selHot ? (
          <div className="v2-merge-actions" role="group" aria-label={`Resolve ${nameOf(find(selHot), project)}`}>
            <button className="v2-merge-act" data-act="trim-this" onClick={() => { setLay((l) => trimThis(l, selHot, ids)); setSel(undefined); }}><Ic g="✂" /> Trim this</button>
            <button className="v2-merge-act" data-act="trim-others" onClick={() => { setLay((l) => keepPrimary(l, selHot, ids)); setSel(undefined); }}><Ic g="✂" /> Trim others</button>
          </div>
        ) : (
          <p className="v2-merge-hint">{ok ? "All clear. ✓ merges as one undo step." : "Select a yellow clip to trim, drag it, or drag its edges. Pinch or Ctrl+scroll to zoom."}</p>
        )}
        {lay !== start && <button className="v2-merge-reset" aria-label="Reset" onClick={() => { setLay(start); setSel(undefined); }}><Ic g="↶" size={14} /> Reset</button>}
      </div>
    </div>
  );
}
