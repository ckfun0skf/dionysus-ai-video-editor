import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePeaks, usePreviewBlob, WaveStrip } from "../AssetPreview";
import { Ic } from "../Icon";

const fmt = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * P2C (item 4): trim an audio version in the storyboard, without the timeline: the waveform with the part in use
 * highlighted, start and end sliders (44px), and a player that plays just that part. Saved as the version's trim,
 * which Send to timeline uses for the cue (V2-SB-121's per-version trim).
 */
export function AudioTrim({ clip, name, totalSec, initial, onSave, onFull, onCancel }: {
  clip: Blob; name: string; totalSec: number; initial?: { inSec: number; outSec: number };
  onSave: (inSec: number, outSec: number) => void; onFull: () => void; onCancel: () => void;
}) {
  const { url } = usePreviewBlob(() => Promise.resolve(clip), "audio", `${clip.size}:${name}`);
  const peaks = usePeaks(clip);
  const [from, setFrom] = useState(initial?.inSec ?? 0);
  const [to, setTo] = useState(initial?.outSec ?? totalSec);
  const [at, setAt] = useState<number>();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [host] = useState<Element>(() => document.querySelector(".v2-app") ?? document.body);
  useEffect(() => () => audio.current?.pause(), []);
  const play = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    a.currentTime = from;
    void a.play()?.catch?.(() => undefined);
    setPlaying(true);
  };
  const onTime = () => {
    const a = audio.current;
    if (!a) return;
    setAt(a.currentTime);
    if (a.currentTime >= to) { a.pause(); setPlaying(false); }
  };
  const minLen = Math.min(0.2, totalSec);
  return createPortal(
    <div className="v2-modal v2-trim v2-atrim" role="dialog" aria-modal="true" aria-label="Trim audio" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="v2-modal-card v2-trim-card">
        <h2>Trim “{name}”</h2>
        <WaveStrip peaks={peaks} durSec={totalSec} from={from} to={to} at={at} height={72} label={`Waveform, using ${fmt(from)} to ${fmt(to)}`} />
        <audio ref={audio} src={url} preload="auto" onTimeUpdate={onTime} onEnded={() => setPlaying(false)} aria-label="Trim preview" />
        <label className="v2-atrim-row">Start <output>{fmt(from)}</output>
          <input type="range" className="v2-trim-range" aria-label="Trim start (seconds)" min={0} max={totalSec} step={0.05} value={from} onChange={(e) => setFrom(clamp(Number(e.target.value), 0, to - minLen))} />
        </label>
        <label className="v2-atrim-row">End <output>{fmt(to)}</output>
          <input type="range" className="v2-trim-range" aria-label="Trim end (seconds)" min={0} max={totalSec} step={0.05} value={to} onChange={(e) => setTo(clamp(Number(e.target.value), from + minLen, totalSec))} />
        </label>
        <p className="v2-hint v2-trim-read" aria-live="polite">Uses {fmt(from)} – {fmt(to)} ({fmt(to - from)}) of {fmt(totalSec)}</p>
        <div className="v2-modal-actions">
          <button type="button" className="v2-btn" onClick={play} aria-label={playing ? "Stop preview" : "Play the trimmed part"}><Ic g={playing ? "❚❚" : "▶"} size={16} /> {playing ? "Stop" : "Play"}</button>
          <button type="button" className="v2-btn" onClick={onFull}>Use whole file</button>
          <button type="button" className="v2-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="v2-btn primary" onClick={() => onSave(from, to)}>Save trim</button>
        </div>
      </div>
    </div>,
    host,
  );
}
