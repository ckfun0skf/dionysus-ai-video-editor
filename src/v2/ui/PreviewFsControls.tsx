import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { formatTimecode, secondsToTicks, ticksToSeconds } from "../domain";
import { Ic } from "./Icon";
import {
  accumulateSkip, clampTime, createAutohide, formatSkipIndicator, FS_AUTOHIDE_MS, FS_TAP_DELAY_MS,
  resolveFsTap, type PendingFsTap,
} from "./previewFs";
import type { PreviewOrient } from "./previewOrient";

export function PreviewFsControls({
  playing, timeTicks, durationTicks, fps, muted, orient, showOrient = true,
  onTogglePlay, onSeek, onExit, onMute, onOrient,
}: {
  playing: boolean;
  timeTicks: number;
  durationTicks: number;
  fps: number;
  muted: boolean;
  orient: PreviewOrient;
  showOrient?: boolean;
  onTogglePlay: () => void;
  onSeek: (ticks: number) => void;
  onExit: () => void;
  onMute: () => void;
  onOrient?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [skipLabel, setSkipLabel] = useState("");
  const pending = useRef<PendingFsTap | undefined>(undefined);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const burst = useRef(0);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useRef(createAutohide(() => setVisible(false), FS_AUTOHIDE_MS));

  useEffect(() => {
    hide.current.ping({ visible, playing, scrubbing });
    return () => hide.current.clear();
  }, [visible, playing, scrubbing]);

  const durSec = Math.max(0, ticksToSeconds(durationTicks));
  const timeSec = clampTime(ticksToSeconds(timeTicks), durSec);
  const flash = (nextBurst: number) => {
    setSkipLabel(formatSkipIndicator(nextBurst));
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(() => { setSkipLabel(""); burst.current = 0; }, 800);
  };

  const onStagePointerUp = (e: RPE<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-fs-chrome]")) return;
    const el = e.currentTarget;
    // offsetX / offsetWidth are the overlay's local box, so a CSS-rotated ancestor keeps left/right correct.
    const x = e.nativeEvent.offsetX, y = e.nativeEvent.offsetY;
    const w = el.offsetWidth || el.getBoundingClientRect().width;
    const now = Date.now();
    const res = resolveFsTap(pending.current, now, x, y, w);
    if (singleTimer.current) { clearTimeout(singleTimer.current); singleTimer.current = undefined; }
    if (res.kind === "double") {
      pending.current = undefined;
      burst.current = accumulateSkip(burst.current, res.side);
      const next = secondsToTicks(clampTime(timeSec + res.deltaSec, durSec));
      onSeek(next);
      flash(burst.current);
      return;
    }
    pending.current = res.pending;
    singleTimer.current = setTimeout(() => {
      pending.current = undefined;
      singleTimer.current = undefined;
      setVisible((v) => !v);
    }, FS_TAP_DELAY_MS);
  };

  const seekSec = (sec: number) => onSeek(secondsToTicks(clampTime(sec, durSec)));

  return (
    <div className="v2-fs" data-testid="preview-fs" onPointerUp={onStagePointerUp}>
      {skipLabel && <div className="v2-fs-skip" data-testid="preview-fs-skip" role="status">{skipLabel}</div>}
      <div className={`v2-fs-ui ${visible ? "is-on" : ""}`} data-fs-chrome data-testid="preview-fs-ui" onPointerUp={(e) => e.stopPropagation()}>
        <div className="v2-fs-top">
          <button type="button" className="v2-fs-btn" aria-label="Exit fullscreen" title="Exit fullscreen" data-testid="preview-fs-exit" onClick={onExit}><Ic g="✕" /></button>
          <span className="v2-fs-top-end">
            <button type="button" className="v2-fs-btn" aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"} data-testid="preview-fs-mute" onClick={onMute}><Ic g={muted ? "🔇" : "🔊"} /></button>
            {showOrient && onOrient && (
              <button type="button" className="v2-fs-btn" aria-label={orient === "landscape" ? "Switch to portrait" : "Switch to landscape"} title={orient === "landscape" ? "Portrait" : "Landscape"} data-testid="preview-fs-orient" onClick={onOrient}><Ic g="⟳" /></button>
            )}
          </span>
        </div>
        <button type="button" className="v2-fs-play" aria-label={playing ? "Pause" : "Play"} data-testid="preview-fs-play" onClick={onTogglePlay}>
          <Ic g={playing ? "❚❚" : "▶"} size={36} />
        </button>
        <div className="v2-fs-bottom">
          <span className="v2-fs-time" data-testid="preview-fs-time">{formatTimecode(timeTicks, fps)}</span>
          <input className="v2-fs-scrub" data-testid="preview-fs-scrub" type="range" min={0} max={durSec || 0} step={0.01} value={timeSec}
            aria-label="Seek" onPointerDown={() => setScrubbing(true)} onPointerUp={() => setScrubbing(false)}
            onChange={(e) => seekSec(Number(e.target.value))} />
          <span className="v2-fs-time" data-testid="preview-fs-total">{formatTimecode(durationTicks, fps)}</span>
        </div>
      </div>
    </div>
  );
}
