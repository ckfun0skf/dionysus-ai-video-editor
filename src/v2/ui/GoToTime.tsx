/**
 * P90: go to an exact time on the phone (the timeline's time label opens it). A timecode field (min:sec:frames, or
 * seconds, or "45f"), −/+ one frame and −/+ one second, so a frame can be reached exactly without a keyboard.
 */
import { useEffect, useState } from "react";
import { formatTimecode, parseTimecode, TICKS_PER_SECOND } from "../domain";
import { Ic } from "./Icon";
import { Sheet } from "./Sheet";

export function GoToTimeSheet({ time, duration, fps, onSeek, onClose }: { time: number; duration: number; fps: number; onSeek: (ticks: number) => void; onClose: () => void }) {
  const [text, setText] = useState(formatTimecode(time, fps));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(formatTimecode(time, fps)); setBad(false); }, [time, fps]);
  const frameTicks = TICKS_PER_SECOND / fps;
  const frame = Math.floor((time / TICKS_PER_SECOND) * fps + 1e-6), last = Math.max(0, Math.ceil((duration / TICKS_PER_SECOND) * fps) - 1);
  const go = (t: number) => onSeek(Math.max(0, Math.min(Math.round(last * frameTicks), Math.round(t))));
  const apply = () => { const t = parseTimecode(text, fps); if (t === undefined) { setBad(true); return; } go(t); };
  const step = (frames: number) => go(Math.round((frame + frames) * frameTicks));
  return (
    <Sheet label="Go to time" className="v2-msheet-insp v2-goto" snaps={[0.36]} initial={0} dim={false} onClose={onClose}>
      <div className="v2-goto-body">
        <label className="v2-goto-field">
          <span>Time <small>min:sec:frames, seconds (2.5) or frames (45f)</small></span>
          <input aria-label="Time" data-testid="goto-time" inputMode="decimal" value={text} aria-invalid={bad || undefined}
            onChange={(e) => { setText(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }} />
        </label>
        {bad && <p className="v2-hint v2-goto-bad" role="alert">Type a time like 00:01:15, 1.5 or 45f.</p>}
        <div className="v2-goto-steps">
          <button type="button" className="v2-btn" aria-label="Back one second" onClick={() => step(-fps)} disabled={frame <= 0}><Ic g="step-back" size={16} /> 1 s</button>
          <button type="button" className="v2-btn" aria-label="Previous frame" onClick={() => step(-1)} disabled={frame <= 0}><Ic g="－" size={16} /> 1 f</button>
          <button type="button" className="v2-btn" aria-label="Next frame" onClick={() => step(1)} disabled={frame >= last}><Ic g="+" size={16} /> 1 f</button>
          <button type="button" className="v2-btn" aria-label="Forward one second" onClick={() => step(fps)} disabled={frame >= last}><Ic g="step-fwd" size={16} /> 1 s</button>
        </div>
        <div className="v2-goto-foot">
          <span className="v2-hint" data-testid="goto-frame">Frame {frame + 1} of {last + 1}</span>
          <button type="button" className="v2-btn primary" data-testid="goto-go" onClick={apply}><Ic g="✓" size={16} /> Go</button>
        </div>
      </div>
    </Sheet>
  );
}
