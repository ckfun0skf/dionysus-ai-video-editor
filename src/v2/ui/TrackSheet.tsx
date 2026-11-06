/**
 * P39 Track sheet: draw a box on the paused clip frame, Track analyses the clip forward and backward (host-side region
 * tracker), then scrub, nudge drifted frames (unstable ones are yellow), pick what follows the box and an optional
 * traveling mask. ✕ changes nothing; ✓ commits everything as one undo step.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { cmd, type Engine } from "../engine";
import { sourceAt, tracking, type Box, type MotionTrack, type Placement, type Project, type TrackMask, type TrackSample } from "../domain";
import { makeTrackAnalyse, nearestIndex, trackTicks, type TrackAnalyse } from "./trackAnalyse";
import { Ic } from "./Icon";

type Phase = "draw" | "busy" | "review";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => `${v * 100}%`;
/** Conf strip: at most this many cells (each the weakest frame of its bucket). */
const STRIP = 90;

export function followCandidates(project: Project, target: Placement): { id: string; label: string; kind: string }[] {
  const c = project.compositions[project.rootCompositionId], end = target.startTicks + target.durationTicks;
  return c.tracks.flatMap((t) => t.placements).filter((p) => p.id !== target.id && tracking.canFollow(p) && !p.blank && !p.placeholder && p.startTicks < end && p.startTicks + p.durationTicks > target.startTicks)
    .map((p) => ({ id: p.id, kind: p.clipType, label: p.clipType === "text" ? `“${(p.text?.text ?? "Text").slice(0, 28)}”` : (project.assets[p.source.assetId]?.name ?? p.id).replace(/\.[a-z0-9]+$/i, "") }));
}

export function TrackSheet({ engine, project, placement, time, loadBlob, analyse, onClose, onDone }: {
  engine: Engine; project: Project; placement: Placement; time: number;
  loadBlob: (assetId: string) => Promise<Blob | undefined>; analyse?: TrackAnalyse;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const ticks = useMemo(() => trackTicks(project, placement), [project, placement]);
  const [idx, setIdx] = useState(() => nearestIndex(ticks, sourceAt(placement, time)));
  const prev = placement.motionTrack;
  const [track, setTrack] = useState<MotionTrack | undefined>(prev);
  const [phase, setPhase] = useState<Phase>(prev?.samples.length ? "review" : "draw");
  const [box, setBox] = useState<Box>();
  const [done, setDone] = useState(0);
  const [live, setLive] = useState<TrackSample[]>([]);
  const [error, setError] = useState<string>();
  const [follow, setFollow] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(true);
  const [mask, setMask] = useState<TrackMask | undefined>(prev?.mask);
  const [removing, setRemoving] = useState(false);
  const [url, setUrl] = useState<string>();
  const [aspect, setAspect] = useState(prev ? prev.srcW / prev.srcH : 16 / 9);
  const signal = useRef({ cancelled: false });
  const video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; move?: { bx: number; by: number } }>();
  const cands = useMemo(() => followCandidates(project, placement), [project, placement]);
  const run = useMemo(() => analyse ?? makeTrackAnalyse(() => loadBlob(placement.source.assetId)), [analyse, loadBlob, placement.source.assetId]);

  useEffect(() => {
    let off = false, made = "";
    void loadBlob(placement.source.assetId).then((b) => { if (!off && b) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { off = true; signal.current.cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [loadBlob, placement.source.assetId]);
  useEffect(() => { const v = video.current; if (v && url && ticks[idx] !== undefined) v.currentTime = ticks[idx] / 120_000 + 0.001; }, [url, idx, ticks]);

  const cur = track ? tracking.sampleAt(track, ticks[idx]) : phase === "busy" ? live[idx] : undefined;
  const shown: Box | undefined = phase === "draw" ? box : cur ? { x: cur.x - cur.w / 2, y: cur.y - cur.h / 2, w: cur.w, h: cur.h } : undefined;
  const unstable = !!cur && cur.conf < tracking.UNSTABLE_CONF;

  const at = (e: RPointerEvent) => { const r = stage.current!.getBoundingClientRect(); return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }; };
  const down = (e: RPointerEvent) => {
    if (phase === "busy") return;
    const p = at(e); (e.target as Element).setPointerCapture?.(e.pointerId);
    if (phase === "review" && shown && p.x >= shown.x && p.x <= shown.x + shown.w && p.y >= shown.y && p.y <= shown.y + shown.h) drag.current = { x0: p.x, y0: p.y, move: { bx: cur!.x, by: cur!.y } };
    else if (phase === "draw") { drag.current = { x0: p.x, y0: p.y }; setBox(undefined); }
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = at(e);
    if (d.move && track && cur) { nudge(d.move.bx + p.x - d.x0, d.move.by + p.y - d.y0); return; }
    setBox({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
  };
  const up = () => { drag.current = undefined; };
  /** Move this frame's box (a nudge): marks it manual and fully trusted. */
  const nudge = (x: number, y: number) => {
    if (!track || !cur) return;
    const s = ticks[idx], rest = track.samples.filter((q) => q.s !== s);
    const fixed: TrackSample = { ...cur, s, x: clamp01(x), y: clamp01(y), conf: 1, manual: true };
    setTrack({ ...track, samples: [...rest, fixed].sort((a, b) => a.s - b.s) });
  };
  const start = () => {
    setRemoving(false);
    if (!box || tracking.boxIssue(box)) return;
    signal.current = { cancelled: false }; setPhase("busy"); setDone(0); setError(undefined); setLive([]);
    run(ticks, idx, box, (n, part) => { setDone(n); setLive([...part]); }, signal.current).then((t) => {
      if (signal.current.cancelled) return;
      setTrack({ ...t, ...(mask ? { mask } : {}) }); setAspect(t.srcW / t.srcH); setPhase("review");
    }, (e: Error) => { if (!signal.current.cancelled) { setError(e.message || "Couldn't read frames"); setPhase("draw"); } });
  };
  const redraw = () => { setTrack(undefined); setBox(undefined); setPhase("draw"); };
  const cancel = () => { signal.current.cancelled = true; onClose(); };
  const commit = () => {
    if (!track) { if (removing) { engine.dispatch(cmd.commitTrack(placement.id, undefined)); onDone("Track removed (Undo to restore)"); } else onClose(); return; }
    const t: MotionTrack = { ...track, ...(mask ? { mask } : {}) };
    if (!mask) delete t.mask;
    if (engine.dispatch(cmd.commitTrack(placement.id, t, [...follow], time, { scale }))) onDone(`Tracked ${t.samples.length} frames${follow.size ? ` · ${follow.size} following` : ""}${mask ? ` · mask ${mask}` : ""}`);
  };
  const strip = useMemo(() => {
    if (!track) return [];
    const n = Math.min(STRIP, ticks.length), out: { from: number; bad: boolean }[] = [];
    for (let k = 0; k < n; k += 1) {
      const a = Math.floor((k * ticks.length) / n), b = Math.max(a + 1, Math.floor(((k + 1) * ticks.length) / n));
      let low = 1; for (let i = a; i < b; i += 1) low = Math.min(low, tracking.sampleAt(track, ticks[i])?.conf ?? 0);
      out.push({ from: a, bad: low < tracking.UNSTABLE_CONF });
    }
    return out;
  }, [track, ticks]);
  const badCount = track ? track.samples.filter((s) => s.conf < tracking.UNSTABLE_CONF).length : 0;
  const okLabel = phase === "review" ? `Apply track${follow.size ? ` and ${follow.size} follower${follow.size === 1 ? "" : "s"}` : ""}` : removing ? "Remove track" : "Done";

  return (
    <div className="v2-track" role="dialog" aria-label="Track" onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
      <header className="v2-subimport-head">
        <button className="v2-icon-btn" aria-label="Cancel" title="Cancel: no change (Esc)" onClick={cancel}><Ic g="✕" /></button>
        <h3>Track</h3>
        <button className="v2-icon-btn" aria-label={okLabel} title={okLabel + " (one undo step)"} disabled={phase === "busy" || (phase === "draw" && !removing)} onClick={commit}><Ic g="✓" /></button>
      </header>
      <div ref={stage} className={`v2-track-stage is-${phase}`} style={{ aspectRatio: `${aspect}`, width: `min(100%, calc(52dvh * ${aspect}))` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <video ref={video} src={url} muted playsInline preload="auto" aria-label="Clip frame" onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight && !prev) setAspect(v.videoWidth / v.videoHeight); }} />
        {shown && shown.w > 0 && <div className={`v2-track-box${unstable ? " is-unstable" : ""}${phase === "review" ? " is-solved" : ""}`} data-testid="track-box" style={{ left: pct(shown.x), top: pct(shown.y), width: pct(shown.w), height: pct(shown.h) }}><i aria-hidden /></div>}
        {phase === "draw" && !box && <p className="v2-track-tip" aria-hidden>Drag a box around the feature</p>}
      </div>
      {phase === "draw" && (
        <div className="v2-track-row">
          <p className="v2-hint">{error ? <span role="alert">{error}</span> : box && tracking.boxIssue(box) ? tracking.boxIssue(box) : `${removing ? "✓ removes the track. Or d" : "D"}raw a box around something with clear edges or contrast that stays in view.`}</p>
          <button type="button" className="v2-btn primary" disabled={!box || !!tracking.boxIssue(box)} onClick={start}><Ic g="track" size={16} /> Track</button>
        </div>
      )}
      {phase === "busy" && (
        <div className="v2-match-busy" role="status" aria-live="polite"><progress max={ticks.length} value={done} aria-label="Tracking" /> Tracking forward and back… {Math.round((done / ticks.length) * 100)}%</div>
      )}
      {phase === "review" && track && <>
        <div className="v2-track-scrub">
          <div className="v2-track-strip" aria-hidden>{strip.map((c) => <i key={c.from} className={c.bad ? "is-bad" : ""} />)}</div>
          <input type="range" min={0} max={ticks.length - 1} step={1} value={idx} aria-label="Frame" onChange={(e) => setIdx(Number(e.target.value))} />
          <p className="v2-hint" role="status">Frame {idx + 1} of {ticks.length}{unstable ? " · unstable: drag the box onto the feature" : cur?.manual ? " · nudged" : ""}{badCount ? ` · ${badCount} unstable (yellow)` : ""}</p>
        </div>
        <div className="v2-track-out">
          <h4>Follow</h4>
          {!cands.length ? <p className="v2-muted">Add a text, photo, overlay or code clip over this clip to make it follow the box.</p> : cands.map((c) => (
            <label key={c.id} className="v2-cleanup-row">
              <input type="checkbox" checked={follow.has(c.id)} onChange={() => { const n = new Set(follow); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setFollow(n); }} />
              <Ic g={c.kind === "text" ? "T" : c.kind === "html" ? "</>" : c.kind === "image" ? "image" : "▭"} size={16} /><span className="v2-cleanup-name">{c.label}</span>
            </label>
          ))}
          {!!cands.length && <label className="v2-cleanup-row"><input type="checkbox" checked={scale} onChange={() => setScale(!scale)} /><span className="v2-cleanup-name">Scale with the box</span></label>}
          <h4>Mask</h4>
          <div className="v2-seg" role="radiogroup" aria-label="Mask">
            {([[undefined, "Off"], ["inside", "Inside box"], ["outside", "Outside box"]] as const).map(([m, l]) => (
              <button key={l} type="button" role="radio" aria-checked={mask === m} className={mask === m ? "is-active" : ""} onClick={() => setMask(m)}>{l}</button>
            ))}
          </div>
          <div className="v2-track-row">
            <button type="button" className="v2-btn" onClick={redraw}><Ic g="↶" size={16} /> Redraw box</button>
            {prev && <button type="button" className="v2-btn" onClick={() => { setTrack(undefined); setRemoving(true); setBox(undefined); setPhase("draw"); }}><Ic g="🗑" size={16} /> Remove track</button>}
          </div>
          <p className="v2-muted v2-track-note">Region tracking follows the pixels in the box; it is not AI subject detection. It works best on high-contrast features that stay in view.</p>
        </div>
      </>}
    </div>
  );
}
