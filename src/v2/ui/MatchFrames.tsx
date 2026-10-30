/**
 * P3A-23: "Match frames" for two adjacent video clips. Samples A's last 2 s and B's first 2 s in the browser, scores
 * every pair (SSIM + mean difference on 32×18 luminance), and shows the best few side by side. Applying one sets A's
 * out point (A ends on its frame) and B's in point (B starts on its frame), as one undo step.
 */
import { useEffect, useState } from "react";
import { cmd, type Engine } from "../engine";
import { clipRange, formatTimecode, TICKS_PER_SECOND, type Placement, type Project } from "../domain";
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

export function MatchFrames({ engine, project, a, b, analyse, onDone }: { engine: Engine; project: Project; a: Placement; b: Placement; analyse: Analyse; onDone: (msg?: string) => void }) {
  const fps = project.settings.fps, ft = TICKS_PER_SECOND / fps;
  const [progress, setProgress] = useState(0);
  const [cands, setCands] = useState<MatchCandidate[] | null>(null);
  const [error, setError] = useState<string>();
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const signal = { cancelled: false };
    setCands(null); setError(undefined); setProgress(0);
    analyse(a, b, setProgress, signal).then((c) => { if (!signal.cancelled) { setCands(c); setPick(0); } }, (e: Error) => { if (!signal.cancelled) setError(e.message || "Couldn't read frames"); });
    return () => { signal.cancelled = true; };
    // Re-run only for a different pair, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b.id]);
  const apply = (c: MatchCandidate) => {
    engine.dispatch(cmd.matchJoin(a.id, b.id, c.aTicks + ft, c.bTicks));
    onDone(`Matched: A ends on frame ${clipRange.ticksToFrame(c.aTicks, fps)}, B starts on frame ${clipRange.ticksToFrame(c.bTicks, fps)} (${Math.round(c.score * 100)}%)`);
  };
  const tc = (t: number) => `${clipRange.ticksToFrame(t, fps)} · ${formatTimecode(t, fps)}`;
  return (
    <div className="v2-match">
      <p className="v2-abnote">Compares the last 2 s of clip A with the first 2 s of clip B and finds the frames that look most alike, so the cut is seamless.</p>
      {error ? <p className="v2-abnote v2-match-err" role="alert">{error}</p>
        : !cands ? <div className="v2-match-busy" role="status" aria-live="polite"><progress max={1} value={progress} aria-label="Analysing frames" /> Analysing frames… {Math.round(progress * 100)}%</div>
        : !cands.length ? <p className="v2-abnote" role="status">No frames to compare — the clips may be too short.</p>
        : <>
          <ul className="v2-match-list" role="radiogroup" aria-label="Matching frame pairs">
            {cands.map((c, i) => (
              <li key={`${c.aTicks}-${c.bTicks}`}>
                <button type="button" role="radio" aria-checked={pick === i} className={`v2-match-cand ${pick === i ? "is-active" : ""}`} onClick={() => setPick(i)}
                  aria-label={`Pair ${i + 1}: A frame ${clipRange.ticksToFrame(c.aTicks, fps)}, B frame ${clipRange.ticksToFrame(c.bTicks, fps)}, ${Math.round(c.score * 100)}% similar`}>
                  <span className="v2-match-pair">
                    <figure>{c.aThumb ? <img src={c.aThumb} alt="" /> : <span className="v2-match-ph" />}<figcaption>A out {tc(c.aTicks)}</figcaption></figure>
                    <figure>{c.bThumb ? <img src={c.bThumb} alt="" /> : <span className="v2-match-ph" />}<figcaption>B in {tc(c.bTicks)}</figcaption></figure>
                  </span>
                  <b className="v2-match-score">{Math.round(c.score * 100)}%{i === 0 ? " · best" : ""}</b>
                </button>
              </li>
            ))}
          </ul>
          <div className="v2-match-actions">
            <button type="button" className="v2-btn" onClick={() => apply(cands[0])}><Ic g="match" size={16} /> Auto-apply best</button>
            <button type="button" className="v2-btn primary" onClick={() => apply(cands[pick])}><Ic g="✓" size={16} /> Apply pair {pick + 1}</button>
          </div>
        </>}
    </div>
  );
}
