/**
 * P3A-24: exact in and out frames for a video clip, in project frames. Each row has a frame-number field, −/+ one-frame
 * steppers (44 px) and the matching timecode. In is the first frame shown, Out the last; the clip's start stays.
 */
import { useEffect, useState } from "react";
import { cmd, type Engine } from "../engine";
import { clipRange, formatTimecode, type Placement, type Project } from "../domain";
import { Ic } from "./Icon";

function FrameRow({ label, frame, min, max, fps, onSet, hint }: { label: string; frame: number; min: number; max: number; fps: number; onSet: (f: number) => void; hint: string }) {
  const [text, setText] = useState(String(frame));
  useEffect(() => setText(String(frame)), [frame]);
  const commit = () => {
    const n = Math.round(Number(text.trim()));
    if (Number.isFinite(n) && n !== frame) onSet(Math.max(min, Math.min(max, n))); else setText(String(frame));
  };
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="v2-frames-row" role="group" aria-label={`${label} frame`}>
      <span className="v2-frames-label">{label}</span>
      <button type="button" className="v2-btn" aria-label={`${label} one frame earlier`} title={`${label}: one frame earlier`} disabled={frame <= min} onClick={() => onSet(frame - 1)}><Ic g="－" size={16} /></button>
      <input id={`frames-${id}`} className="v2-frames-num" value={text} inputMode="numeric" aria-label={`${label} frame number`} title={hint}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
      <button type="button" className="v2-btn" aria-label={`${label} one frame later`} title={`${label}: one frame later`} disabled={frame >= max} onClick={() => onSet(frame + 1)}><Ic g="＋" size={16} /></button>
      <output className="v2-frames-tc" aria-label={`${label} timecode`}>{formatTimecode(clipRange.frameToTicks(frame, fps), fps)}</output>
    </div>
  );
}

export function ClipFrames({ engine, project, placement: pl }: { engine: Engine; project: Project; placement: Placement }) {
  const fps = project.settings.fps;
  if (!clipRange.canSetRange(project, pl)) return <p className="v2-abnote">{pl.reverse ? "In and out frames are set on forward clips — turn Reverse off first." : "In and out frames need a video clip (not a freeze frame)."}</p>;
  const { inTicks, outTicks, mediaTicks = 0 } = clipRange.sourceSpan(project, pl);
  const inF = clipRange.ticksToFrame(inTicks, fps), outF = clipRange.ticksToFrame(outTicks - 1, fps);
  const lastF = clipRange.ticksToFrame(mediaTicks - 1, fps);
  const set = (a: number, b: number) => engine.dispatch(cmd.setSourceRange(pl.id, clipRange.frameToTicks(a, fps), clipRange.frameToTicks(b + 1, fps)));
  const frames = outF - inF + 1;
  return (
    <div className="v2-frames">
      <FrameRow label="In" frame={inF} min={0} max={outF} fps={fps} hint="First frame of the video this clip shows" onSet={(f) => set(f, outF)} />
      <FrameRow label="Out" frame={outF} min={inF} max={lastF} fps={fps} hint="Last frame of the video this clip shows" onSet={(f) => set(inF, f)} />
      <p className="v2-abnote" aria-live="polite">Frames {inF}–{outF} of 0–{lastF} · {frames} frame{frames === 1 ? "" : "s"} at {fps} fps. The clip's start stays; a later Out stops at the next clip.</p>
    </div>
  );
}
