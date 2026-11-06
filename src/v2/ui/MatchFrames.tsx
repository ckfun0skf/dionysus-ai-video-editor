/**
 * P3A-23 / P36: "Match frames" for two adjacent video clips. Samples A's last 2 s and B's first 2 s in the browser, scores
 * every pair (SSIM + mean difference on 32×18 luminance), and shows the best few side by side. Applying one sets A's
 * out point (A ends on its frame) and B's in point (B starts on its frame), as one undo step.
 * P36: the options are chips over ONE mini timeline of A's tail and B's head, the part each option cuts away boxed in
 * red, and a looping preview of the join (A's last second, then B from its new in point).
 */
import { useEffect, useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { clipRange, TICKS_PER_SECOND, type Placement, type Project } from "../domain";
import { grabFrames, sampleTicks, topMatches, type Frame, type MatchCandidate } from "./frameMatch";
import { Ic } from "./Icon";

export const MATCH_WINDOW_TICKS = 2 * TICKS_PER_SECOND;
export type Analyse = (a: Placement, b: Placement, onProgress: (p: number) => void, signal: { cancelled: boolean }) => Promise<MatchCandidate[]>;

/** The default analyser: two seek-and-draw passes, then scoring. */
export function makeAnalyse(project: Project, loadBlob: (assetId: string) => Promise<Blob | undefined>): Analyse {
  const fps = project.settings.fps;
  return async (a, b, onProgress, signal) => {
    const sa = clipRange.sourceSpan(project, a), sb = clipRange.sourceSpan(project, b);
    const ta = sampleTicks(Math.max(sa.inTicks, sa.outTicks - MATCH_WINDOW_TICKS), sa.outTicks, fps);
    const tb = sampleTicks(sb.inTicks, Math.min(sb.outTicks, sb.inTicks + MATCH_WINDOW_TICKS), fps);
    const total = ta.length + tb.length;
    const [ba, bb] = await Promise.all([loadBlob(a.source.assetId), loadBlob(b.source.assetId)]);
    if (!ba || !bb) throw new Error("The video files for these clips are not on this device");
    const fa: Frame[] = await grabFrames(ba, ta, fps, (n) => onProgress(n / total), signal);
    const fb: Frame[] = await grabFrames(bb, tb, fps, (n) => onProgress((ta.length + n) / total), signal);
    return topMatches(fa, fb, 4);
  };
}

export function MatchFrames({ engine, project, a, b, analyse, onDone, loadMedia }: { engine: Engine; project: Project; a: Placement; b: Placement; analyse: Analyse; onDone: (msg?: string) => void; loadMedia?: (assetId: string) => Promise<Blob | undefined> }) {
  const fps = project.settings.fps, ft = TICKS_PER_SECOND / fps;
  const [progress, setProgress] = useState(0);
  const [cands, setCands] = useState<MatchCandidate[] | null>(null);
  const [error, setError] = useState<string>();
  /** -1 = keep the current cut. */
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const signal = { cancelled: false };
    setCands(null); setError(undefined); setProgress(0);
    analyse(a, b, setProgress, signal).then((c) => { if (!signal.cancelled) { setCands(c); setPick(c.length ? 0 : -1); } }, (e: Error) => { if (!signal.cancelled) setError(e.message || "Couldn't read frames"); });
    return () => { signal.cancelled = true; };
    // Re-run only for a different pair, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b.id]);
  const sa = clipRange.sourceSpan(project, a), sb = clipRange.sourceSpan(project, b);
  const cur = pick >= 0 ? cands?.[pick] : undefined;
  /** The source cut: A's new out (exclusive) and B's new in; the current cut when keeping. */
  const aOut = cur ? Math.min(sa.outTicks, cur.aTicks + ft) : sa.outTicks, bIn = cur ? Math.max(sb.inTicks, cur.bTicks) : sb.inTicks;
  const apply = () => {
    if (!cur) { onDone(); return; }
    engine.dispatch(cmd.matchJoin(a.id, b.id, cur.aTicks + ft, cur.bTicks));
    onDone(`Matched: A ends on frame ${clipRange.ticksToFrame(cur.aTicks, fps)}, B starts on frame ${clipRange.ticksToFrame(cur.bTicks, fps)} (${Math.round(cur.score * 100)}%)`);
  };
  const sec = (t: number) => `${(Math.round((t / TICKS_PER_SECOND) * 100) / 100).toFixed(2)}s`;
  const optLabel = (c: MatchCandidate, i: number) => `Option ${i + 1}: cuts ${sec(Math.max(0, sa.outTicks - c.aTicks - ft))} from A and ${sec(Math.max(0, c.bTicks - sb.inTicks))} from B, ${Math.round(c.score * 100)}% similar`;
  return (
    <div className="v2-match">
      {error ? <p className="v2-abnote v2-match-err" role="alert">{error}</p>
        : !cands ? <div className="v2-match-busy" role="status" aria-live="polite"><progress max={1} value={progress} aria-label="Analysing frames" /> Analysing frames… {Math.round(progress * 100)}%</div>
        : <>
          {loadMedia && <JoinPreview a={a} b={b} aOut={aOut} bIn={bIn} loadMedia={loadMedia} />}
          <MatchTimeline sa={sa} sb={sb} aOut={aOut} bIn={bIn} />
          {!cands.length && <p className="v2-abnote" role="status">No frames to compare — the clips may be too short.</p>}
          <div className="v2-match-chips" role="radiogroup" aria-label="Cut options">
            <button type="button" role="radio" aria-checked={pick === -1} className={`v2-match-chip ${pick === -1 ? "is-active" : ""}`} onClick={() => setPick(-1)} aria-label="Keep current cut (nothing is cut away)">
              <span className="v2-match-chip-ph" aria-hidden><Ic g="✕" size={18} /></span><b>Keep current</b>
            </button>
            {cands.map((c, i) => (
              <button key={`${c.aTicks}-${c.bTicks}`} type="button" role="radio" aria-checked={pick === i} className={`v2-match-chip ${pick === i ? "is-active" : ""}`} onClick={() => setPick(i)} aria-label={optLabel(c, i)} title={optLabel(c, i)}>
                <span className="v2-match-chip-pair" aria-hidden>{c.aThumb ? <img src={c.aThumb} alt="" /> : <i />}{c.bThumb ? <img src={c.bThumb} alt="" /> : <i />}</span>
                <b>Option {i + 1} · {Math.round(c.score * 100)}%{i === 0 ? " best" : ""}</b>
              </button>
            ))}
          </div>
          <div className="v2-match-actions">
            <button type="button" className="v2-btn primary" onClick={apply} aria-label={cur ? `Apply option ${pick + 1}` : "Keep current cut"}><Ic g="✓" size={16} /> {cur ? `Apply option ${pick + 1}` : "Keep current"}</button>
          </div>
        </>}
    </div>
  );
}

/** One strip: A's last 2 s then B's first 2 s; what the option cuts away is boxed in red (hatched). */
export function MatchTimeline({ sa, sb, aOut, bIn }: { sa: { inTicks: number; outTicks: number }; sb: { inTicks: number; outTicks: number }; aOut: number; bIn: number }) {
  const a0 = Math.max(sa.inTicks, sa.outTicks - MATCH_WINDOW_TICKS), b1 = Math.min(sb.outTicks, sb.inTicks + MATCH_WINDOW_TICKS);
  const lenA = Math.max(1, sa.outTicks - a0), lenB = Math.max(1, b1 - sb.inTicks), total = lenA + lenB;
  const pct = (t: number) => `${(t / total) * 100}%`;
  const cutA = Math.max(0, sa.outTicks - aOut), cutB = Math.max(0, bIn - sb.inTicks);
  const s = (t: number) => `${(Math.round((t / TICKS_PER_SECOND) * 100) / 100).toFixed(2)}s`;
  return (
    <div className="v2-match-tl" aria-label={`Cut: ${cutA ? `${s(cutA)} trimmed from the end of A` : "A unchanged"}, ${cutB ? `${s(cutB)} trimmed from the start of B` : "B unchanged"}`} role="img">
      <div className="v2-match-tl-clip is-a" style={{ left: 0, width: pct(lenA) }}><span>A</span></div>
      <div className="v2-match-tl-clip is-b" style={{ left: pct(lenA), width: pct(lenB) }}><span>B</span></div>
      {cutA > 0 && <div className="v2-match-chop" data-testid="chop-a" style={{ left: pct(lenA - Math.min(cutA, lenA)), width: pct(Math.min(cutA, lenA)) }}><em>−{s(cutA)}</em></div>}
      {cutB > 0 && <div className="v2-match-chop" data-testid="chop-b" style={{ left: pct(lenA), width: pct(Math.min(cutB, lenB)) }}><em>−{s(cutB)}</em></div>}
      <div className="v2-match-tl-cut" style={{ left: pct(lenA) }} aria-hidden />
    </div>
  );
}

/** Loops the join with the chosen option: A's last second up to its new out, then B's first second from its new in. */
function JoinPreview({ a, b, aOut, bIn, loadMedia }: { a: Placement; b: Placement; aOut: number; bIn: number; loadMedia: (assetId: string) => Promise<Blob | undefined> }) {
  const va = useRef<HTMLVideoElement>(null), vb = useRef<HTMLVideoElement>(null);
  const [urls, setUrls] = useState<[string, string]>();
  const [playing, setPlaying] = useState(true);
  const [side, setSide] = useState<"a" | "b">("a");
  useEffect(() => {
    let off = false; const made: string[] = [];
    void Promise.all([loadMedia(a.source.assetId), loadMedia(b.source.assetId)]).then(([x, y]) => {
      if (off || !x || !y) return;
      const u: [string, string] = [URL.createObjectURL(x), URL.createObjectURL(y)]; made.push(...u); setUrls(u);
    }).catch(() => undefined);
    return () => { off = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [a.source.assetId, b.source.assetId, loadMedia]);
  const aEnd = aOut / TICKS_PER_SECOND, aStart = Math.max(0, aEnd - 1), bStart = bIn / TICKS_PER_SECOND, bEnd = bStart + 1;
  useEffect(() => {
    const A = va.current, B = vb.current;
    if (!urls || !A || !B) return;
    let raf = 0, cur: "a" | "b" = "a";
    const start = () => { cur = "a"; setSide("a"); A.currentTime = aStart; B.currentTime = bStart; B.pause(); if (playing) void A.play().catch(() => undefined); };
    const tick = () => {
      if (cur === "a" && A.currentTime >= aEnd - 0.02) { A.pause(); cur = "b"; setSide("b"); if (playing) void B.play().catch(() => undefined); }
      else if (cur === "b" && B.currentTime >= bEnd) { B.pause(); start(); }
      raf = requestAnimationFrame(tick);
    };
    start(); if (!playing) { A.pause(); B.pause(); A.currentTime = aEnd - 0.04; } else raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [urls, aStart, aEnd, bStart, bEnd, playing]);
  return (
    <div className="v2-match-preview">
      <video ref={va} src={urls?.[0]} muted playsInline preload="auto" className={side === "a" ? "" : "is-hidden"} aria-label="Preview: end of A" />
      <video ref={vb} src={urls?.[1]} muted playsInline preload="auto" className={side === "b" ? "" : "is-hidden"} aria-label="Preview: start of B" />
      <span className="v2-match-preview-tag">{side === "a" ? "A" : "B"}</span>
      <button type="button" className="v2-icon-btn v2-match-play" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying(!playing)}><Ic g={playing ? "❚❚" : "▶"} size={18} /></button>
    </div>
  );
}
