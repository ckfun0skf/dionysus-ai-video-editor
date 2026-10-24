/**
 * V2-SB-121: choose which part of a clip a shot uses. A fixed window as long as the shot slides over a filmstrip of
 * the clip (drag it, tap the strip, or use the slider), with a preview that plays just the window.
 * On upload it also offers keeping the whole clip, which makes the shot that long instead.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { drawVideoFrame } from "../frameGrab";
import { Ic } from "../Icon";

const STRIP_FRAMES = 8;
const fmt = (sec: number) => `${Math.round(sec * 10) / 10} s`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Small frames spread over the clip, drawn once the clip can be read. Empty when the browser cannot decode it. */
function useFilmstrip(url: string, totalSec: number, ready: boolean): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!ready || !totalSec) return;
    let dead = false;
    const el = document.createElement("video");
    el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
    const once = (ev: string, ms = 4000) => new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), ms);
      el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
      el.addEventListener("error", () => { clearTimeout(t); rej(new Error("error")); }, { once: true });
    });
    void (async () => {
      try {
        await once("loadeddata");
        const h = 48, w = Math.max(16, Math.round((h * (el.videoWidth || 16)) / (el.videoHeight || 9)));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true }); // the blank-frame check reads pixels each frame
        if (!g) return;
        const out: string[] = [];
        for (let i = 0; i < STRIP_FRAMES && !dead; i += 1) {
          el.currentTime = ((i + 0.5) * totalSec) / STRIP_FRAMES;
          await once("seeked");
          if (await drawVideoFrame(g, el, w, h)) out.push(c.toDataURL("image/jpeg", 0.6)); else out.push("");
          if (!dead) setFrames([...out]);
        }
      } catch { /* no filmstrip: the window still works on a plain bar */ }
      finally { el.removeAttribute("src"); el.load(); }
    })();
    return () => { dead = true; };
  }, [url, totalSec, ready]);
  return frames;
}

export interface TrimPickerProps {
  /** The clip (an uploaded File or a stored blob). */
  clip: Blob;
  totalSec: number;
  /** Window length: the shot's planned length. */
  windowSec: number;
  /** Start of the window; default centred. */
  initialInSec?: number;
  /** "upload": choose trim or keep full; "adjust": change a version's trim later. */
  mode: "upload" | "adjust";
  onTrim: (inSec: number) => void;
  /** Upload: keep the whole clip (the shot becomes that long). Adjust: clear the trim. */
  onFull: () => void;
  onCancel: () => void;
}

export function TrimPicker({ clip, totalSec, windowSec, initialInSec, mode, onTrim, onFull, onCancel }: TrimPickerProps) {
  const url = useMemo(() => URL.createObjectURL(clip), [clip]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const win = Math.min(windowSec, totalSec);
  const maxIn = Math.max(0, totalSec - win);
  const [inSec, setIn] = useState(() => clamp(initialInSec ?? maxIn / 2, 0, maxIn));
  const [choice, setChoice] = useState<"trim" | "full">("trim");
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const frames = useFilmstrip(url, totalSec, loaded);
  const video = useRef<HTMLVideoElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const grab = useRef<number | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);

  // The preview shows the first frame of the window; while playing it loops inside the window.
  useEffect(() => { const v = video.current; if (v && loaded && !playing) { try { v.currentTime = inSec; } catch { /* not seekable yet */ } } }, [inSec, loaded, playing]);
  useEffect(() => { card.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(); }, []);
  const onTime = () => {
    const v = video.current;
    if (v && playing && v.currentTime >= inSec + win - 0.03) { v.pause(); setPlaying(false); v.currentTime = inSec; }
  };
  const play = () => {
    const v = video.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); v.currentTime = inSec; return; }
    v.currentTime = inSec;
    setPlaying(true);
    const r = v.play();
    if (r && typeof r.catch === "function") r.catch(() => setPlaying(false));
  };
  const move = (sec: number) => { if (playing) { video.current?.pause(); setPlaying(false); } setIn(clamp(Math.round(sec * 20) / 20, 0, maxIn)); };

  const secAt = (e: ReactPointerEvent) => {
    const r = strip.current!.getBoundingClientRect();
    return r.width ? ((e.clientX - r.left) / r.width) * totalSec : 0;
  };
  const down = (e: ReactPointerEvent) => {
    if (!strip.current) return;
    const at = secAt(e);
    // Grabbing the window keeps the finger's offset; tapping elsewhere centres the window there.
    grab.current = at >= inSec && at <= inSec + win ? at - inSec : win / 2;
    move(at - grab.current);
    strip.current.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const drag = (e: ReactPointerEvent) => { if (grab.current !== undefined) move(secAt(e) - grab.current); };
  const up = () => { grab.current = undefined; };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } };

  // Portal out of the transformed Sheet, but stay inside .v2-app so the theme variables apply.
  const [host] = useState<Element>(() => document.querySelector(".v2-app") ?? document.body);
  const upload = mode === "upload";
  const trimming = !upload || choice === "trim";
  const title = upload ? `This clip is ${fmt(totalSec)}, the shot is planned at ${fmt(windowSec)}` : "Adjust trim";
  return createPortal(
    <div className="v2-modal v2-trim" role="dialog" aria-modal="true" aria-label={upload ? "Trim the upload" : "Adjust trim"} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
      <div className="v2-modal-card v2-trim-card" ref={card}>
        <h2>{title}</h2>
        {upload && (
          <div className="v2-trim-choice" role="radiogroup" aria-label="Use of the clip">
            <button type="button" role="radio" aria-checked={choice === "trim"} className={choice === "trim" ? "on" : ""} onClick={() => setChoice("trim")} data-autofocus>
              <Ic g="✂" size={16} /> Trim to {fmt(win)}
            </button>
            <button type="button" role="radio" aria-checked={choice === "full"} className={choice === "full" ? "on" : ""} onClick={() => setChoice("full")}>
              <Ic g="⛶" size={16} /> Keep full {fmt(totalSec)}
            </button>
          </div>
        )}
        <div className="v2-trim-preview">
          <video ref={video} src={url} muted playsInline preload="auto" onLoadedData={() => setLoaded(true)} onTimeUpdate={onTime} onEnded={() => setPlaying(false)} aria-label="Preview" />
          {trimming && <button type="button" className="v2-btn v2-trim-play" onClick={play} aria-label={playing ? "Stop preview" : "Play the trimmed part"}><Ic g={playing ? "❚❚" : "▶"} size={16} /> {playing ? "Stop" : "Play"}</button>}
        </div>
        {trimming ? (
          <>
            <div className="v2-trim-strip" ref={strip} onPointerDown={down} onPointerMove={drag} onPointerUp={up} onPointerCancel={up} aria-hidden="true">
              <div className="v2-trim-frames">{Array.from({ length: STRIP_FRAMES }, (_, i) => frames[i] ? <img key={i} src={frames[i]} alt="" draggable={false} /> : <span key={i} />)}</div>
              <div className="v2-trim-shade" style={{ left: 0, width: `${(inSec / totalSec) * 100}%` }} />
              <div className="v2-trim-shade" style={{ left: `${((inSec + win) / totalSec) * 100}%`, right: 0 }} />
              <div className="v2-trim-window" style={{ left: `${(inSec / totalSec) * 100}%`, width: `${(win / totalSec) * 100}%` }} />
            </div>
            <input type="range" className="v2-trim-range" aria-label="Trim start (seconds)" min={0} max={maxIn} step={0.05} value={inSec}
              aria-valuetext={`Uses ${fmt(inSec)} to ${fmt(inSec + win)} of ${fmt(totalSec)}`} onChange={(e) => move(Number(e.target.value))} {...(!upload ? { "data-autofocus": true } : {})} />
            <p className="v2-hint v2-trim-read" aria-live="polite">Uses {fmt(inSec)} – {fmt(inSec + win)} of {fmt(totalSec)}</p>
          </>
        ) : <p className="v2-hint">The whole clip is used and the shot is planned at {fmt(totalSec)} from now on.</p>}
        <div className="v2-modal-actions">
          {!upload && <button type="button" className="v2-btn" onClick={onFull}>Use full clip</button>}
          <button type="button" className="v2-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="v2-btn primary" onClick={() => (trimming ? onTrim(inSec) : onFull())}>{upload ? (trimming ? `Trim to ${fmt(win)}` : `Keep full ${fmt(totalSec)}`) : "Save trim"}</button>
        </div>
      </div>
    </div>,
    host,
  );
}
