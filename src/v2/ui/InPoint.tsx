/**
 * V2-SB-133: a video clip's in point (where it starts in its video), without changing its length or position: a
 * slider, a seconds field and ±0.1 s steps (44 px targets). Used by the desktop inspector's Speed tab and the phone
 * "In point" sheet. Storyboard layers start at their JSON "inSec" (or the version's trim); this is how to change it.
 */
import { useEffect, useState } from "react";
import { cmd, type Engine } from "../engine";
import { sourceInMax, TICKS_PER_SECOND, type Placement, type Project } from "../domain";
import { Ic } from "./Icon";

const s2 = (t: number) => Math.round((t / TICKS_PER_SECOND) * 100) / 100;

/** Whether the clip can slip: a non-freeze video clip shorter than its media. */
export function canSetInPoint(project: Project, pl: Placement): boolean {
  return (sourceInMax(project, pl) ?? 0) > 0;
}

export function InPointControl({ engine, project, placement: pl }: { engine: Engine; project: Project; placement: Placement }) {
  const max = sourceInMax(project, pl) ?? 0;
  const at = pl.sourceInTicks;
  const [text, setText] = useState(String(s2(at)));
  useEffect(() => setText(String(s2(at))), [at]);
  const set = (ticks: number) => engine.dispatch(cmd.setSourceIn(pl.id, ticks));
  const total = max + Math.round(pl.durationTicks * (pl.speed ?? 1));
  const commit = () => {
    const n = Number(text.trim().replace(",", "."));
    if (Number.isFinite(n)) set(Math.round(n * TICKS_PER_SECOND)); else setText(String(s2(at)));
  };
  const step = (d: number) => set(at + Math.round(d * TICKS_PER_SECOND));
  if (max <= 0) return <p className="v2-abnote">This clip plays its whole video, so there is nothing to slip. Trim it shorter first.</p>;
  return (
    <div className="v2-inpoint">
      <label className="v2-inpoint-range"><span className="v2-sr">In point (seconds into the video)</span>
        <input type="range" min={0} max={max} step={TICKS_PER_SECOND / 20} value={at} aria-label="In point"
          aria-valuetext={`Starts ${s2(at)} s into the ${s2(total)} s video`}
          onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
          onChange={(e) => set(Number(e.target.value))} />
      </label>
      <div className="v2-inpoint-row">
        <button type="button" className="v2-btn" aria-label="In point 0.1 s earlier" disabled={at <= 0} onClick={() => step(-0.1)}><Ic g="－" size={16} /></button>
        <label className="v2-inpoint-num">Starts at
          <input value={text} inputMode="decimal" aria-label="In point in seconds" onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} /> s
        </label>
        <button type="button" className="v2-btn" aria-label="In point 0.1 s later" disabled={at >= max} onClick={() => step(0.1)}><Ic g="＋" size={16} /></button>
      </div>
      <p className="v2-abnote" aria-live="polite">Plays {s2(at)}–{s2(at + Math.round(pl.durationTicks * (pl.speed ?? 1)))} s of {s2(total)} s. Length and position stay.</p>
    </div>
  );
}
