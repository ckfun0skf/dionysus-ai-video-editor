/**
 * P40 Tracks lane: a thin, non-exported lane under a video track showing each tracker of its clips as a span over its
 * range (yellow where frames are weak or lost). Tap a span to review that tracker; drag its ends to set In / Out or its
 * body to slide the range (one undo step on release). It can't hold clips and never renders into the picture.
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { tracking, type Placement, type Track } from "../domain";

export const MT_ROW_H = 22;
export interface TrackRangeChange { clipId: string; trackId: string; start: number; end: number }

/** Spans of one video track's trackers on the timeline, stacked into rows (one row per tracker index on a clip). */
export function trackSpans(t: Track) {
  return t.placements.flatMap((p) => tracking.tracksOf(p).map((tr, row) => ({ p, tr, row, ...tracking.trackSpan(p, tr) })));
}
export const laneRows = (t: Track) => Math.max(0, ...t.placements.map((p) => tracking.tracksOf(p).length));

/** CSS gradient of a tracker's quality across its span: accent where found, yellow where weak / lost / not analysed. */
export function qualityGradient(p: Placement, tr: tracking.NamedTrack, start: number, end: number, cells = 40): string {
  const stops: string[] = [];
  for (let k = 0; k < cells; k += 1) {
    const t = start + ((k + 0.5) * (end - start)) / cells, q = tracking.sampleAt(tr, tracking.sourceOfTime(p, t));
    const bad = !q || q.lost || q.conf < tracking.UNSTABLE_CONF;
    stops.push(`${bad ? "var(--mt-bad)" : "var(--mt-ok)"} ${(k * 100) / cells}% ${((k + 1) * 100) / cells}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function TracksLane({ track, toPx, pps, selected, onOpen, onRange }: {
  track: Track; toPx: (t: number) => number; /** px per second */ pps: number; selected?: string;
  onOpen: (clipId: string, trackId: string) => void; onRange?: (c: TrackRangeChange) => void;
}) {
  const [drag, setDrag] = useState<{ key: string; kind: "in" | "out" | "body"; x0: number; d: number; moved: boolean }>();
  const ref = useRef(drag); ref.current = drag;
  const spans = trackSpans(track), rows = Math.max(1, laneRows(track));
  const ticksPerPx = 120_000 / Math.max(1e-6, pps);
  const begin = (e: RPointerEvent, key: string, kind: "in" | "out" | "body") => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setDrag({ key, kind, x0: e.clientX, d: 0, moved: false }); };
  const moveP = (e: RPointerEvent) => { const d = ref.current; if (d) setDrag({ ...d, d: (e.clientX - d.x0) * ticksPerPx, moved: d.moved || Math.abs(e.clientX - d.x0) > 4 }); };
  const shape = (sp: ReturnType<typeof trackSpans>[number]) => {
    const d = drag && drag.key === `${sp.p.id}:${sp.tr.id}` ? drag : undefined, lo = sp.p.startTicks, hi = sp.p.startTicks + sp.p.durationTicks, min = 120_000 / 10;
    if (!d) return { start: sp.start, end: sp.end };
    if (d.kind === "in") return { start: Math.min(Math.max(lo, sp.start + d.d), sp.end - min), end: sp.end };
    if (d.kind === "out") return { start: sp.start, end: Math.max(Math.min(hi, sp.end + d.d), sp.start + min) };
    const len = sp.end - sp.start, st = Math.min(Math.max(lo, sp.start + d.d), hi - len);
    return { start: st, end: st + len };
  };
  const end = (sp: ReturnType<typeof trackSpans>[number]) => {
    const d = ref.current; setDrag(undefined);
    if (!d) return;
    if (!d.moved) { if (d.kind === "body") onOpen(sp.p.id, sp.tr.id); return; }
    const r = shape(sp);
    if (Math.abs(r.start - sp.start) > 1 || Math.abs(r.end - sp.end) > 1) onRange?.({ clipId: sp.p.id, trackId: sp.tr.id, start: Math.round(r.start), end: Math.round(r.end) });
  };
  return (
    <div className="v2-mtrack-lane" style={{ height: rows * MT_ROW_H + 4 }} aria-label="Tracks (not exported)" role="group">
      {spans.map((sp) => {
        const k = `${sp.p.id}:${sp.tr.id}`, r = shape(sp), isSel = selected === k;
        return (
          <div key={k} className={`v2-mtrack${isSel ? " is-selected" : ""}`} style={{ left: toPx(r.start), width: Math.max(8, toPx(r.end) - toPx(r.start)), top: 2 + sp.row * MT_ROW_H, backgroundImage: qualityGradient(sp.p, sp.tr, sp.start, sp.end) }}
            role="button" tabIndex={0} aria-label={`${sp.tr.name}: tap to review, drag the ends to set In / Out`} title={`${sp.tr.name} · tap to review · drag ends for In / Out, body to slide`}
            onPointerDown={(e) => begin(e, k, "body")} onPointerMove={moveP} onPointerUp={() => end(sp)} onPointerCancel={() => setDrag(undefined)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(sp.p.id, sp.tr.id); } }}>
            <span className="v2-mtrack-h is-in" aria-hidden onPointerDown={(e) => begin(e, k, "in")} onPointerMove={moveP} onPointerUp={() => end(sp)} />
            <span className="v2-mtrack-name">{sp.tr.name}</span>
            <span className="v2-mtrack-h is-out" aria-hidden onPointerDown={(e) => begin(e, k, "out")} onPointerMove={moveP} onPointerUp={() => end(sp)} />
          </div>
        );
      })}
    </div>
  );
}
