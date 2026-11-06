/**
 * P39/P40 Track sheet for one tracker of a video clip: draw a box on the paused frame, Track analyses its range forward
 * and backward (host-side region tracker with a scale search), then play / scrub, edit the path (drag points), nudge
 * drifted frames (unstable = yellow, lost = no box), set the range (In / Out from the playhead), pick followers and an
 * optional traveling mask. ✕ changes nothing; ✓ commits everything as one undo step.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { cmd, type Engine } from "../engine";
import { sourceAt, TICKS_PER_SECOND, tracking, type Box, type NamedTrack, type Placement, type Project, type TrackMask, type TrackSample } from "../domain";
import { makeTrackAnalyse, nearestIndex, rangeTrack, trackTicks, type TrackAnalyse } from "./trackAnalyse";
import { Ic } from "./Icon";

type Phase = "draw" | "busy" | "review";
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => `${v * 100}%`;
/** Conf strip: at most this many cells (each the weakest frame of its bucket). Path: at most this many drag points. */
const STRIP = 90, POINTS = 32;

export function followCandidates(project: Project, target: Placement): { id: string; label: string; kind: string }[] {
  const c = project.compositions[project.rootCompositionId], end = target.startTicks + target.durationTicks;
  return c.tracks.flatMap((t) => t.placements).filter((p) => p.id !== target.id && tracking.canFollow(p) && !p.blank && !p.placeholder && p.startTicks < end && p.startTicks + p.durationTicks > target.startTicks)
    .map((p) => ({ id: p.id, kind: p.clipType, label: p.clipType === "text" ? `“${(p.text?.text ?? "Text").slice(0, 28)}”` : (project.assets[p.source.assetId]?.name ?? p.id).replace(/\.[a-z0-9]+$/i, "") }));
}

export function TrackSheet({ engine, project, placement, trackId, time, loadBlob, analyse, onClose, onDone }: {
  engine: Engine; project: Project; placement: Placement; /** Existing tracker to review; undefined = add a new one. */ trackId?: string; time: number;
  loadBlob: (assetId: string) => Promise<Blob | undefined>; analyse?: TrackAnalyse;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const ticks = useMemo(() => trackTicks(project, placement), [project, placement]);
  const prev = useMemo(() => tracking.tracksOf(placement).find((t) => t.id === trackId), [placement, trackId]);
  const fresh = useMemo(() => tracking.nextTrackName(placement), [placement]);
  const [idx, setIdx] = useState(() => nearestIndex(ticks, sourceAt(placement, time)));
  const [track, setTrack] = useState<NamedTrack | undefined>(prev);
  const [name, setName] = useState(prev?.name ?? fresh.name);
  const [range, setRange] = useState<[number, number]>(prev ? [prev.inS, prev.outS] : [ticks[0], ticks[ticks.length - 1] + 1]);
  const [phase, setPhase] = useState<Phase>(prev?.samples.length ? "review" : "draw");
  const [box, setBox] = useState<Box>();
  const [done, setDone] = useState(0), [total, setTotal] = useState(1);
  const [live, setLive] = useState<TrackSample[]>([]);
  const [error, setError] = useState<string>();
  const [follow, setFollow] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(true);
  const [mask, setMask] = useState<TrackMask | undefined>(prev?.mask);
  const [showPath, setShowPath] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string>();
  const [aspect, setAspect] = useState(prev ? prev.srcW / prev.srcH : 16 / 9);
  const signal = useRef({ cancelled: false });
  const video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; move?: { bx: number; by: number; i: number } }>();
  const cands = useMemo(() => followCandidates(project, placement), [project, placement]);
  const run = useMemo(() => analyse ?? makeTrackAnalyse(() => loadBlob(placement.source.assetId)), [analyse, loadBlob, placement.source.assetId]);

  useEffect(() => {
    let off = false, made = "";
    void loadBlob(placement.source.assetId).then((b) => { if (!off && b) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { off = true; signal.current.cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [loadBlob, placement.source.assetId]);
  // Paused: show the chosen frame. Playing: the video runs and drives the frame index (box, path and mask follow).
  useEffect(() => { const v = video.current; if (v && url && !playing && ticks[idx] !== undefined) v.currentTime = ticks[idx] / TICKS_PER_SECOND + 0.001; }, [url, idx, ticks, playing]);
  useEffect(() => {
    const v = video.current;
    if (!playing || !v) return;
    let raf = 0;
    const end = Math.min(range[1], ticks[ticks.length - 1] + 1) / TICKS_PER_SECOND;
    if (v.currentTime >= end - 0.05) v.currentTime = range[0] / TICKS_PER_SECOND;
    void v.play().catch(() => setPlaying(false));
    const tick = () => { const s = Math.round(v.currentTime * TICKS_PER_SECOND); setIdx(nearestIndex(ticks, s)); if (v.currentTime >= end || v.ended) { v.pause(); setPlaying(false); return; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); v.pause(); };
  }, [playing, ticks, range]);
  const togglePlay = () => { if (phase !== "busy") setPlaying((p) => !p); };
  useEffect(() => {
    // Space plays / pauses the sheet's preview (not the editor's), unless a text field has focus.
    const k = (e: KeyboardEvent) => { if (e.code !== "Space" || (e.target as HTMLElement)?.closest?.("input:not([type=checkbox]):not([type=range]),textarea")) return; e.preventDefault(); e.stopPropagation(); togglePlay(); };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });

  const s = ticks[idx];
  const inRange = s >= range[0] && s < range[1];
  const view: NamedTrack | undefined = track ? { ...track, inS: range[0], outS: range[1] } : undefined;
  const cur = view ? tracking.sampleAt(view, s) : phase === "busy" ? live[idx] : undefined;
  const lost = !!cur?.lost;
  const shown: Box | undefined = phase === "draw" ? box : cur && !lost ? { x: cur.x - cur.w / 2, y: cur.y - cur.h / 2, w: cur.w, h: cur.h } : undefined;
  const unstable = !!cur && !lost && cur.conf < tracking.UNSTABLE_CONF;

  const at = (e: RPointerEvent) => { const r = stage.current!.getBoundingClientRect(); return { x: clamp01((e.clientX - r.left) / (r.width || 1)), y: clamp01((e.clientY - r.top) / (r.height || 1)) }; };
  const down = (e: RPointerEvent) => {
    if (phase === "busy") return;
    setPlaying(false);
    const p = at(e); (e.target as Element).setPointerCapture?.(e.pointerId);
    if (phase === "review" && shown && cur && p.x >= shown.x && p.x <= shown.x + shown.w && p.y >= shown.y && p.y <= shown.y + shown.h) drag.current = { x0: p.x, y0: p.y, move: { bx: cur.x, by: cur.y, i: idx } };
    else if (phase === "draw") { if (!inRange) { setError("Move to a frame inside the range (In / Out) to draw the box."); return; } drag.current = { x0: p.x, y0: p.y }; setBox(undefined); }
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = at(e);
    if (d.move) { nudge(d.move.i, d.move.bx + p.x - d.x0, d.move.by + p.y - d.y0); return; }
    setBox({ x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
  };
  const up = () => { drag.current = undefined; };
  /** Move frame i's box centre (a nudge or a path-point drag): marks it manual, trusted and found. */
  const nudge = (i: number, x: number, y: number) => {
    setTrack((t) => {
      if (!t) return t;
      const at2 = ticks[i], base = tracking.sampleAt({ ...t, inS: undefined, outS: undefined }, at2);
      if (!base) return t;
      const fixed: TrackSample = { ...base, s: at2, x: clamp01(x), y: clamp01(y), conf: 1, manual: true };
      delete fixed.lost;
      return { ...t, samples: [...t.samples.filter((q) => q.s !== at2), fixed].sort((a, b) => a.s - b.s) };
    });
  };
  const start = () => {
    setRemoving(false);
    if (!box || tracking.boxIssue(box)) return;
    const sub = ticks.filter((t) => t >= range[0] && t < range[1]), si = nearestIndex(sub, s);
    signal.current = { cancelled: false }; setPhase("busy"); setDone(0); setTotal(sub.length); setError(undefined); setLive([]); setPlaying(false);
    run(sub, si, box, (n, part) => { setDone(n); setLive(ticks.map((t) => part[sub.indexOf(t)]) as TrackSample[]); }, signal.current).then((t) => {
      if (signal.current.cancelled) return;
      setTrack({ ...t, id: prev?.id ?? fresh.id, name, inS: range[0], outS: range[1] }); setAspect(t.srcW / t.srcH); setPhase("review");
    }, (e: Error) => { if (!signal.current.cancelled) { setError(e.message || "Couldn't read frames"); setPhase("draw"); } });
  };
  const setIn = () => { if (s < range[1]) setRange([s, range[1]]); };
  const setOut = () => { const e = s + 1; if (e > range[0]) setRange([range[0], Math.max(e, ticks[Math.min(idx + 1, ticks.length - 1)])]); };
  const redraw = () => { setTrack(undefined); setBox(undefined); setPhase("draw"); setPlaying(false); };
  const cancel = () => { signal.current.cancelled = true; onClose(); };
  const commit = async () => {
    setPlaying(false);
    if (!track) { if (removing && prev) { engine.dispatch(cmd.commitTrack(placement.id, undefined, [], 0, { removeId: prev.id })); onDone(`${prev.name} removed (Undo to restore)`); } else onClose(); return; }
    let t: NamedTrack = { ...track, name: name.trim() || track.name };
    if (mask) t.mask = mask; else delete t.mask;
    if (tracking.missingRanges(t, range[0], range[1]).length) {
      // The range grew: analyse only the new part before committing.
      signal.current = { cancelled: false }; setPhase("busy"); setDone(0);
      try { t = await rangeTrack(run, project, placement, t, range[0], range[1], (d, n) => { setDone(d); setTotal(n); }, signal.current); } catch (e) { setError((e as Error).message); setPhase("review"); return; }
      if (signal.current.cancelled) return;
    } else t = tracking.withRange(t, range[0], range[1]);
    if (engine.dispatch(cmd.commitTrack(placement.id, t, [...follow], time, { scale }))) onDone(`${t.name}: ${t.samples.length} frames${follow.size ? ` · ${follow.size} following` : ""}${mask ? ` · mask ${mask}` : ""}`);
  };
  const strip = useMemo(() => {
    const n = Math.min(STRIP, ticks.length), out: { from: number; cls: string }[] = [];
    for (let k = 0; k < n; k += 1) {
      const a = Math.floor((k * ticks.length) / n), b = Math.max(a + 1, Math.floor(((k + 1) * ticks.length) / n));
      let low = 1, any = false, gone = false;
      for (let i = a; i < b; i += 1) { const q = view && tracking.sampleAt(view, ticks[i]); if (q) { any = true; if (q.lost) gone = true; low = Math.min(low, q.conf); } }
      const inR = ticks[a] >= range[0] && ticks[a] < range[1];
      out.push({ from: a, cls: !inR ? "is-out" : !any ? "" : gone || low < tracking.UNSTABLE_CONF ? "is-bad" : "is-ok" });
    }
    return out;
  }, [view, ticks, range]);
  const path = useMemo(() => {
    if (!view || !showPath || phase !== "review") return { segs: [] as string[], pts: [] as { i: number; x: number; y: number; bad: boolean }[] };
    const inR = ticks.map((t, i) => [t, i] as const).filter(([t]) => t >= range[0] && t < range[1]);
    const segs: string[] = []; let seg: string[] = [];
    for (const [t] of inR) { const q = tracking.sampleAt(view, t); if (!q || q.lost) { if (seg.length > 1) segs.push(seg.join(" ")); seg = []; continue; } seg.push(`${q.x},${q.y}`); }
    if (seg.length > 1) segs.push(seg.join(" "));
    const every = Math.max(1, Math.ceil(inR.length / POINTS));
    const pts = inR.filter((_, k) => k % every === 0 || k === inR.length - 1).map(([t, i]) => ({ i, q: tracking.sampleAt(view, t) })).filter((p) => p.q && !p.q.lost).map((p) => ({ i: p.i, x: p.q!.x, y: p.q!.y, bad: p.q!.conf < tracking.UNSTABLE_CONF }));
    return { segs, pts };
  }, [view, showPath, phase, ticks, range]);
  const pointDown = (e: RPointerEvent, i: number, x: number, y: number) => { e.stopPropagation(); setPlaying(false); setIdx(i); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { ...at(e), x0: at(e).x, y0: at(e).y, move: { bx: x, by: y, i } }; };
  const badCount = view ? view.samples.filter((q) => q.conf < tracking.UNSTABLE_CONF).length : 0, lostCount = view ? view.samples.filter((q) => q.lost).length : 0;
  const okLabel = phase === "review" ? `Apply ${name || "track"}${follow.size ? ` and ${follow.size} follower${follow.size === 1 ? "" : "s"}` : ""}` : removing ? "Remove tracker" : "Done";
  const sec = (t: number) => `${(Math.max(0, t - ticks[0]) / TICKS_PER_SECOND).toFixed(2)}s`;
  const lo = (range[0] - ticks[0]) / Math.max(1, ticks[ticks.length - 1] + 1 - ticks[0]), hi = (range[1] - ticks[0]) / Math.max(1, ticks[ticks.length - 1] + 1 - ticks[0]);

  return (
    <div className="v2-track" role="dialog" aria-label="Track" onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
      <header className="v2-subimport-head">
        <button className="v2-icon-btn" aria-label="Cancel" title="Cancel: no change (Esc)" onClick={cancel}><Ic g="✕" /></button>
        <input className="v2-track-name" aria-label="Tracker name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button className="v2-icon-btn" aria-label={okLabel} title={okLabel + " (one undo step)"} disabled={phase === "busy" || (phase === "draw" && !removing)} onClick={() => void commit()}><Ic g="✓" /></button>
      </header>
      <div ref={stage} className={`v2-track-stage is-${phase}${mask && phase === "review" ? ` mask-${mask}` : ""}`} style={{ aspectRatio: `${aspect}`, width: `min(100%, calc(48dvh * ${aspect}))` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <video ref={video} src={url} muted playsInline preload="auto" aria-label="Clip frame" onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight && !prev) setAspect(v.videoWidth / v.videoHeight); }} />
        {mask === "inside" && phase === "review" && (lost || !inRange) && <div className="v2-track-hide" aria-hidden />}
        {path.segs.length > 0 && <svg className="v2-track-path" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>{path.segs.map((pts, k) => <polyline key={k} points={pts} />)}</svg>}
        {path.pts.map((p) => (
          <button key={p.i} type="button" className={`v2-track-pt${p.i === idx ? " is-cur" : ""}${p.bad ? " is-bad" : ""}`} style={{ left: pct(p.x), top: pct(p.y) }} aria-label={`Path point, frame ${p.i + 1}: drag to move`}
            onPointerDown={(e) => pointDown(e, p.i, p.x, p.y)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><i /></button>
        ))}
        {shown && shown.w > 0 && <div className={`v2-track-box${unstable ? " is-unstable" : ""}${phase === "review" ? " is-solved" : ""}`} data-testid="track-box" style={{ left: pct(shown.x), top: pct(shown.y), width: pct(shown.w), height: pct(shown.h) }}><i aria-hidden /></div>}
        {phase === "review" && (lost || !inRange) && <span className="v2-track-flag" role="status">{lost ? "Lost: not found on this frame" : "Outside the range"}</span>}
        {phase === "draw" && !box && <p className="v2-track-tip" aria-hidden>Drag a box around the feature</p>}
      </div>
      <div className="v2-track-scrub">
        <div className="v2-track-strip" aria-hidden>{strip.map((c) => <i key={c.from} className={c.cls} />)}</div>
        <div className="v2-track-range" aria-hidden><b style={{ left: pct(lo), width: pct(Math.max(0, hi - lo)) }} /></div>
        <div className="v2-track-row v2-track-ctl">
          <button type="button" className="v2-icon-btn v2-track-play" aria-label={playing ? "Pause" : "Play"} title={`${playing ? "Pause" : "Play"} (Space)`} disabled={phase === "busy" || !url} onClick={togglePlay}><Ic g={playing ? "❚❚" : "▶"} size={18} /></button>
          <input type="range" min={0} max={ticks.length - 1} step={1} value={idx} aria-label="Frame" disabled={phase === "busy"} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
        </div>
        <div className="v2-track-row v2-track-inout">
          <button type="button" className="v2-btn" disabled={phase === "busy" || s >= range[1]} onClick={setIn} title="Start the tracker on this frame"><Ic g="trim-start" size={16} /> In {sec(range[0])}</button>
          <button type="button" className="v2-btn" disabled={phase === "busy" || s < range[0]} onClick={setOut} title="End the tracker after this frame"><Ic g="trim-end" size={16} /> Out {sec(range[1])}</button>
          {phase === "review" && <label className="v2-track-check"><input type="checkbox" checked={showPath} onChange={() => setShowPath(!showPath)} /> Path</label>}
        </div>
        <p className="v2-hint" role="status">Frame {idx + 1} of {ticks.length}{unstable ? " · unstable: drag the box or its path point onto the feature" : cur?.manual ? " · nudged" : ""}{badCount ? ` · ${badCount} unstable` : ""}{lostCount ? ` · ${lostCount} lost (no position)` : ""}</p>
      </div>
      {phase === "draw" && (
        <div className="v2-track-row">
          <p className="v2-hint">{error ? <span role="alert">{error}</span> : box && tracking.boxIssue(box) ? tracking.boxIssue(box) : `${removing ? "✓ removes this tracker. Or d" : "D"}raw a box around something with clear edges or contrast.`}</p>
          <button type="button" className="v2-btn primary" disabled={!box || !!tracking.boxIssue(box) || !inRange} onClick={start}><Ic g="track" size={16} /> Track</button>
        </div>
      )}
      {phase === "busy" && (
        <div className="v2-match-busy" role="status" aria-live="polite"><progress max={total} value={done} aria-label="Tracking" /> Tracking… {Math.round((done / Math.max(1, total)) * 100)}%</div>
      )}
      {phase === "review" && track && (
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
            {prev && <button type="button" className="v2-btn" onClick={() => { setTrack(undefined); setRemoving(true); setBox(undefined); setPhase("draw"); }}><Ic g="🗑" size={16} /> Remove tracker</button>}
          </div>
          <p className="v2-muted v2-track-note">Region tracking follows the pixels in the box, growing and shrinking with them; it is not AI subject detection. Where the feature leaves the picture or the match is weak the frame is lost (no position). Works best on high-contrast features.</p>
        </div>
      )}
    </div>
  );
}
