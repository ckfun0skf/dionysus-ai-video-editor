import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  AUDIO_TEMPLATES, DRUMS, INSTRUMENTS, SFX, clipDuration, gridSteps, midiOf, newAudioClip, noteName, paramSpecs, paramValue, parseAudioClip, stepSec, stringifyAudioClip,
  type AudioClip, type ClipIssue, type ClipNote, type ClipTrack, type Instrument, type SfxId,
} from "../domain";
import { bufferToWav, renderAudioClip } from "../render";
import { Confirm } from "./CodeEditor";
import { ClipIssues } from "./HtmlImport";
import { Ic as Icon } from "./Icon";
import { saveFile } from "./saveFile";
import { Sheet } from "./Sheet";

/**
 * P4A-3: the Audio editor for `dionysus.audioclip/1` clips (styled like the Code editor). Tracks on a touch step grid
 * (synths and drums) or as timed events (noise and SFX, with a slider designer), mix and fx, a rendered preview with
 * loop, undo/redo, templates, and .json import/export plus WAV export. Saving hands the clip back; the caller renders
 * the WAV and stores a new version.
 */
type Tab = "pattern" | "sound" | "mix" | "clip";
const TABS: { id: Tab; label: string }[] = [{ id: "pattern", label: "Pattern" }, { id: "sound", label: "Sound" }, { id: "mix", label: "Mix" }, { id: "clip", label: "Clip" }];
const INST_LABEL: Record<Instrument, string> = { piano: "Piano", pad: "Pad", bass: "Bass", pluck: "Pluck", lead: "Lead", drums: "Drums", noise: "Noise", sfx: "SFX" };
const SFX_LABEL: Record<SfxId, string> = { whoosh: "Whoosh", impact: "Impact", riser: "Riser", beep: "Beep", glitch: "Glitch", wind: "Wind", rain: "Rain" };
const LENS = [1, 2, 4, 8, 16];
const DEFAULT_OCTAVE: Partial<Record<Instrument, number>> = { bass: 2, pad: 3, piano: 4, pluck: 4, lead: 4 };
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
export const AUDIO_JSON_ACCEPT = ".json,application/json";
const fileBase = (name: string) => (name.trim() || "audio").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "audio";
export const toHtmlIssues = (issues: ClipIssue[]) => issues.map((i) => ({ level: i.level, message: i.message, code: i.path || "clip" }));
const trackLabel = (t: ClipTrack) => t.name || (t.instrument === "sfx" ? SFX_LABEL[t.sfx ?? "whoosh"] : INST_LABEL[t.instrument]);

/** Undo history for the clip; `key` coalesces a burst of edits (a slider drag) into one step. */
function useHistory(start: AudioClip) {
  const [s, setS] = useState({ past: [] as AudioClip[], now: start, future: [] as AudioClip[], key: "", at: 0 });
  const commit = useCallback((next: AudioClip | ((c: AudioClip) => AudioClip), key = "") => setS((h) => {
    const n = typeof next === "function" ? next(h.now) : next;
    if (n === h.now) return h;
    const t = Date.now();
    const merge = key !== "" && key === h.key && t - h.at < 800;
    return { past: merge ? h.past : [...h.past.slice(-99), h.now], now: n, future: [], key, at: t };
  }), []);
  const undo = useCallback(() => setS((h) => (h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future], key: "", at: 0 } : h)), []);
  const redo = useCallback(() => setS((h) => (h.future.length ? { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1), key: "", at: 0 } : h)), []);
  return { clip: s.now, commit, undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0 };
}

/** A new track of an instrument with a short starter pattern. */
export function newTrack(inst: Instrument, ids: string[], sfx: SfxId = "whoosh"): ClipTrack {
  let n = 1;
  const base = inst === "sfx" ? sfx : inst;
  while (ids.includes(`${base}${n}`)) n++;
  const id = `${base}${n}`;
  if (inst === "sfx") return { id, instrument: "sfx", sfx, volume: 0.8, events: [{ t: 0, dur: sfx === "impact" ? 1.5 : sfx === "beep" ? 0.4 : 1.2 }] };
  if (inst === "noise") return { id, instrument: "noise", volume: 0.4, events: [{ t: 0, dur: 2 }] };
  if (inst === "drums") return { id, instrument: "drums", volume: 0.8, notes: [{ step: 0, pitch: "kick" }, { step: 4, pitch: "snare" }, { step: 8, pitch: "kick" }, { step: 12, pitch: "snare" }] };
  return { id, instrument: inst, volume: 0.7, notes: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Preview: renders the clip (debounced) and plays it with an AudioBufferSource.

function usePreview(clip: AudioClip) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const id = setTimeout(() => {
      renderAudioClip(clip).then((b) => { if (live) { setBuffer(b); setErr(""); } }, (e) => { if (live) { setBuffer(null); setErr(e instanceof Error ? e.message : String(e)); } }).finally(() => { if (live) setBusy(false); });
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [clip]);
  return { buffer, err, busy };
}

function Waveform({ buffer, seconds, t }: { buffer: AudioBuffer | null; seconds: number; t: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    const w = (c.width = c.clientWidth * (devicePixelRatio || 1) || 600), h = (c.height = c.clientHeight * (devicePixelRatio || 1) || 120);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#5ad1c8";
    if (!buffer) return;
    const d = buffer.getChannelData(0), e = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : d;
    const per = Math.max(1, Math.floor(d.length / w));
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = x * per, end = Math.min(d.length, i + per); i < end; i += 4) m = Math.max(m, Math.abs(d[i]), Math.abs(e[i]));
      const bh = Math.max(1, m * h * 0.95);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }, [buffer]);
  const len = buffer?.duration || seconds;
  return (
    <div className="v2-ae-wave">
      <canvas ref={ref} aria-label="Waveform" role="img" />
      <span className="v2-ae-clipend" style={{ left: `${Math.min(100, (seconds / Math.max(0.01, len)) * 100)}%` }} aria-hidden />
      <span className="v2-ae-playhead" style={{ left: `${Math.min(100, (t / Math.max(0.01, len)) * 100)}%` }} aria-hidden />
    </div>
  );
}

function PreviewPanel({ clip, undo, redo, canUndo, canRedo }: { clip: AudioClip; commit?: unknown; undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; mobile?: boolean }) {
  const { buffer, err, busy } = usePreview(clip);
  const seconds = clipDuration(clip);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [t, setT] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const stop = useCallback(() => { try { srcRef.current?.stop(); } catch { /* already stopped */ } srcRef.current = null; setPlaying(false); }, []);
  const start = useCallback((b: AudioBuffer, from = 0) => {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (ctxRef.current ??= new AC());
    void ctx.resume?.();
    try { srcRef.current?.stop(); } catch { /* */ }
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = loop;
    s.loopStart = 0; s.loopEnd = Math.min(b.duration, seconds);
    s.connect(ctx.destination);
    const at = ctx.currentTime;
    s.start(at, from);
    srcRef.current = s;
    setPlaying(true);
    s.onended = () => { if (srcRef.current === s) { srcRef.current = null; setPlaying(false); setT(0); } };
    (s as unknown as { _t0: number })._t0 = at - from;
  }, [loop, seconds]);
  // Re-start on a new render while playing, so edits are heard on the next pass.
  const last = useRef<AudioBuffer | null>(null);
  useEffect(() => { if (buffer && buffer !== last.current && srcRef.current) start(buffer, Math.min(t, seconds - 0.01)); last.current = buffer; }, [buffer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (srcRef.current) { srcRef.current.loop = loop; } }, [loop]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const s = srcRef.current, ctx = ctxRef.current;
      if (s && ctx) {
        const el = ctx.currentTime - (s as unknown as { _t0: number })._t0;
        setT(loop ? el % Math.max(0.01, Math.min(s.buffer?.duration ?? seconds, seconds)) : Math.min(el, s.buffer?.duration ?? seconds));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, seconds]);
  useEffect(() => () => { try { srcRef.current?.stop(); } catch { /* */ } void ctxRef.current?.close?.(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === " " && buffer) { e.preventDefault(); if (srcRef.current) stop(); else start(buffer, 0); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [undo, redo, buffer, start, stop]);
  return (
    <div className="v2-ce-preview v2-ae-preview">
      <Waveform buffer={buffer} seconds={seconds} t={t} />
      <div className="v2-ce-transport">
        <button type="button" className="v2-btn v2-ce-icon primary" aria-label={playing ? "Stop preview" : "Play preview"} disabled={!buffer} onClick={() => (playing ? stop() : buffer && start(buffer, 0))}><Icon g={playing ? "❚❚" : "▶"} /></button>
        <button type="button" className={`v2-btn v2-ce-icon ${loop ? "is-on" : ""}`} aria-label="Loop" aria-pressed={loop} title="Loop the preview" onClick={() => setLoop(!loop)}><Icon g="anim-loop" /></button>
        <span className="v2-ce-time" aria-live="off">{busy ? "Rendering…" : `${fmt(t)} / ${fmt(seconds)}`}</span>
        <span className="v2-ae-spacer" />
        <button type="button" className="v2-btn v2-ce-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Icon g="↶" /></button>
        <button type="button" className="v2-btn v2-ce-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Icon g="↷" /></button>
      </div>
      {err && <p className="v2-ce-error" role="alert">Preview unavailable: {err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Pattern: step grid (synths, drums) or events (noise, sfx)

function StepGrid({ clip, track, set }: { clip: AudioClip; track: ClipTrack; set: (t: ClipTrack, key?: string) => void }) {
  const drums = track.instrument === "drums";
  const [octave, setOctave] = useState(DEFAULT_OCTAVE[track.instrument] ?? 4);
  const [len, setLen] = useState(track.instrument === "pad" ? 8 : track.instrument === "bass" ? 2 : 1);
  useEffect(() => { setOctave(DEFAULT_OCTAVE[track.instrument] ?? 4); }, [track.id, track.instrument]);
  const steps = gridSteps(clip), spb = clip.stepsPerBeat ?? 4;
  const rows: { key: string; label: string; match: (n: ClipNote) => boolean; pitch: string | number }[] = drums
    ? DRUMS.map((d) => ({ key: d, label: d, match: (n: ClipNote) => n.pitch === d, pitch: d }))
    : Array.from({ length: 13 }, (_, i) => { const m = (octave + 1) * 12 + 12 - i; return { key: String(m), label: noteName(m), match: (n: ClipNote) => midiOf(n.pitch) === m, pitch: noteName(m) }; });
  const notes = track.notes ?? [];
  const at = (row: typeof rows[number], s: number) => notes.findIndex((n) => row.match(n) && s >= n.step && s < n.step + (drums ? 1 : n.len ?? 1));
  const toggle = (row: typeof rows[number], s: number) => {
    const i = at(row, s);
    const next = i >= 0 ? notes.filter((_, j) => j !== i) : [...notes, { step: s, pitch: row.pitch, ...(drums || len === 1 ? {} : { len: Math.min(len, steps - s) }) }].sort((a, b) => a.step - b.step);
    set({ ...track, notes: next });
  };
  const outOfOctave = drums ? 0 : notes.filter((n) => !rows.some((r) => r.match(n))).length;
  return (
    <div className="v2-ae-pattern">
      <div className="v2-ae-gridbar">
        {!drums && (
          <span className="v2-ae-oct" role="group" aria-label="Octave">
            <button type="button" className="v2-btn v2-ce-icon" aria-label="Octave down" disabled={octave <= 0} onClick={() => setOctave(octave - 1)}><Icon g="－" /></button>
            <span className="v2-ae-octval">Oct {octave}</span>
            <button type="button" className="v2-btn v2-ce-icon" aria-label="Octave up" disabled={octave >= 7} onClick={() => setOctave(octave + 1)}><Icon g="＋" /></button>
          </span>
        )}
        {!drums && (
          <span className="v2-ce-seg" role="group" aria-label="Note length">
            {LENS.map((l) => <button key={l} type="button" className={`v2-btn v2-ae-len ${len === l ? "is-active" : ""}`} aria-pressed={len === l} aria-label={`Note length ${l} step${l > 1 ? "s" : ""}`} onClick={() => setLen(l)}>{l === 1 ? "1/16" : l === 2 ? "1/8" : l === 4 ? "1/4" : l === 8 ? "1/2" : "1 bar"}</button>)}
          </span>
        )}
        <button type="button" className="v2-btn" disabled={!notes.length} onClick={() => set({ ...track, notes: [] })}>Clear</button>
      </div>
      {outOfOctave > 0 && <p className="v2-ce-hint">{outOfOctave} note{outOfOctave > 1 ? "s are" : " is"} in another octave.</p>}
      <div className="v2-ae-grid" role="grid" aria-label={`${trackLabel(track)} steps`} style={{ ["--ae-steps" as string]: steps }}>
        {rows.map((row) => (
          <div key={row.key} role="row" className={`v2-ae-row ${!drums && /#/.test(row.label) ? "is-sharp" : ""}`}>
            <span role="rowheader" className="v2-ae-rowhead">{row.label}</span>
            {Array.from({ length: steps }, (_, s) => {
              const i = at(row, s), n = i >= 0 ? notes[i] : undefined, head = n && n.step === s;
              return (
                <button key={s} type="button" role="gridcell" aria-selected={!!n} aria-label={`${row.label} step ${s + 1}${n ? (head ? " on" : " held") : ""}`}
                  className={`v2-ae-cell ${n ? (head ? "is-on" : "is-held") : ""} ${s % spb === 0 ? "is-beat" : ""} ${n && (n.vel ?? 1) < 0.6 ? "is-soft" : ""}`} onClick={() => toggle(row, s)} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsEditor({ clip, track, set }: { clip: AudioClip; track: ClipTrack; set: (t: ClipTrack, key?: string) => void }) {
  const events = track.events ?? [];
  const total = Math.max(clipDuration(clip), ...events.map((e) => e.t + e.dur));
  const put = (i: number, k: "t" | "dur", v: number) => set({ ...track, events: events.map((e, j) => (j === i ? { ...e, [k]: Math.max(k === "dur" ? 0.05 : 0, Math.round(v * 100) / 100) } : e)) }, `ev-${track.id}-${i}-${k}`);
  return (
    <div className="v2-ae-pattern">
      <div className="v2-ae-lane" aria-hidden>
        {events.map((e, i) => <span key={i} className="v2-ae-event" style={{ left: `${(e.t / total) * 100}%`, width: `${Math.max(1, (e.dur / total) * 100)}%` }}>{i + 1}</span>)}
      </div>
      <ul className="v2-ae-events">
        {events.map((e, i) => (
          <li key={i} className="v2-ae-evrow">
            <b>{i + 1}</b>
            <Slider label="Start" unit="s" min={0} max={Math.max(10, Math.ceil(total))} step={0.05} value={e.t} onChange={(v) => put(i, "t", v)} />
            <Slider label="Length" unit="s" min={0.05} max={Math.max(10, Math.ceil(total))} step={0.05} value={e.dur} onChange={(v) => put(i, "dur", v)} />
            <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove event ${i + 1}`} disabled={events.length <= 1} onClick={() => set({ ...track, events: events.filter((_, j) => j !== i) })}><Icon g="🗑" /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="v2-btn v2-ae-add" onClick={() => { const lastEnd = events.reduce((m, e) => Math.max(m, e.t + e.dur), 0); set({ ...track, events: [...events, { t: Math.round(lastEnd * 100) / 100, dur: events[events.length - 1]?.dur ?? 1 }] }); }}><Icon g="＋" /> Add event</button>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; hint?: string }) {
  const shown = step >= 1 ? String(Math.round(value)) : value.toFixed(step >= 0.05 ? 2 : 2);
  return (
    <label className="v2-ae-slider" title={hint}>
      <span className="v2-ae-slabel"><span>{label}</span><output>{shown}{unit ? ` ${unit}` : ""}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sound (instrument + params = the SFX designer), Mix, Clip

function SoundTab({ track, set }: { track: ClipTrack; set: (t: ClipTrack, key?: string) => void }) {
  const specs = paramSpecs(track);
  const synth = !["drums", "noise", "sfx"].includes(track.instrument);
  const changeInst = (inst: Instrument) => {
    if (inst === track.instrument) return;
    const evented = (i: Instrument) => i === "sfx" || i === "noise";
    const base = newTrack(inst, [], track.sfx ?? "whoosh");
    const keep = evented(inst) === evented(track.instrument) && (inst === "drums") === (track.instrument === "drums");
    set({ ...track, instrument: inst, sfx: inst === "sfx" ? track.sfx ?? "whoosh" : undefined, params: undefined, notes: evented(inst) ? undefined : keep ? track.notes : base.notes, events: evented(inst) ? (keep ? track.events : base.events) : undefined });
  };
  return (
    <div className="v2-ce-panel">
      <span className="v2-ce-label">Instrument</span>
      <div className="v2-tp-chips" role="radiogroup" aria-label="Instrument">
        {INSTRUMENTS.map((i) => <button key={i} type="button" role="radio" aria-checked={track.instrument === i} className={`v2-chip ${track.instrument === i ? "is-active" : ""}`} onClick={() => changeInst(i)}>{INST_LABEL[i]}</button>)}
      </div>
      {track.instrument === "sfx" && <>
        <span className="v2-ce-label">Sound effect</span>
        <div className="v2-tp-chips" role="radiogroup" aria-label="Sound effect">
          {SFX.map((s) => <button key={s} type="button" role="radio" aria-checked={track.sfx === s} className={`v2-chip ${track.sfx === s ? "is-active" : ""}`} onClick={() => set({ ...track, sfx: s, params: undefined })}>{SFX_LABEL[s]}</button>)}
        </div>
      </>}
      {specs.length > 0 && <span className="v2-ce-label">{track.instrument === "sfx" ? "Designer" : "Shape"}</span>}
      <div className="v2-ae-sliders">
        {specs.map((p) => {
          const v = paramValue(track, p.key);
          const auto = p.default === -1;
          return (
            <Slider key={p.key} label={auto && v < 0 ? `${p.label} (auto)` : p.label} hint={p.description} unit={p.unit} min={auto ? -0.01 : p.min} max={p.max} step={p.step} value={v}
              onChange={(nv) => set({ ...track, params: { ...track.params, [p.key]: auto && nv < 0 ? -1 : nv } }, `p-${track.id}-${p.key}`)} />
          );
        })}
      </div>
      {synth && <p className="v2-ce-hint">Attack and Release at the far left use the instrument's own envelope.</p>}
      {track.instrument === "drums" && <p className="v2-ce-hint">The kit has kick, snare, hat, open hat, clap and tom; place them on the Pattern grid.</p>}
      {specs.length > 0 && <button type="button" className="v2-btn v2-ae-reset" disabled={!track.params} onClick={() => set({ ...track, params: undefined })}>Reset sound</button>}
    </div>
  );
}

function MixTab({ track, set }: { track: ClipTrack; set: (t: ClipTrack, key?: string) => void }) {
  const fx = track.fx ?? {};
  const setFx = (next: typeof fx, key: string) => { const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== 0)); set({ ...track, fx: Object.keys(clean).length ? clean : undefined }, key); };
  const f = fx.filter;
  return (
    <div className="v2-ce-panel">
      <div className="v2-ae-sliders">
        <Slider label="Volume" min={0} max={1} step={0.01} value={track.volume ?? 0.8} onChange={(v) => set({ ...track, volume: v }, `vol-${track.id}`)} />
        <Slider label="Pan" min={-1} max={1} step={0.01} value={track.pan ?? 0} onChange={(v) => set({ ...track, pan: Math.abs(v) < 0.02 ? undefined : v }, `pan-${track.id}`)} hint="Left −1 … right 1" />
        <Slider label="Reverb" min={0} max={1} step={0.01} value={fx.reverb ?? 0} onChange={(v) => setFx({ ...fx, reverb: v }, `rv-${track.id}`)} />
        <Slider label="Delay" min={0} max={0.95} step={0.01} value={fx.delay ?? 0} onChange={(v) => setFx({ ...fx, delay: v }, `dl-${track.id}`)} hint="Echo feedback and level" />
        {!!fx.delay && <Slider label="Delay time" unit="s" min={0.02} max={2} step={0.01} value={fx.delayTime ?? 0.25} onChange={(v) => setFx({ ...fx, delayTime: v }, `dt-${track.id}`)} />}
      </div>
      <span className="v2-ce-label">Filter</span>
      <div className="v2-ce-seg" role="radiogroup" aria-label="Filter">
        {(["off", "lowpass", "highpass", "bandpass"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={(f?.type ?? "off") === k} className={`v2-btn ${(f?.type ?? "off") === k ? "is-active" : ""}`}
            onClick={() => setFx({ ...fx, filter: k === "off" ? undefined : { type: k, cutoff: f?.cutoff ?? (k === "highpass" ? 400 : 2000) } } as typeof fx, "")}>{k === "off" ? "Off" : k === "lowpass" ? "Low-pass" : k === "highpass" ? "High-pass" : "Band-pass"}</button>
        ))}
      </div>
      {f && <div className="v2-ae-sliders">
        <Slider label="Cutoff" unit="Hz" min={0} max={1} step={0.001} value={Math.log(f.cutoff / 20) / Math.log(1000)} onChange={(v) => setFx({ ...fx, filter: { ...f, cutoff: Math.round(20 * Math.pow(1000, v)) } }, `fc-${track.id}`)} hint={`${f.cutoff} Hz`} />
      </div>}
      {f && <p className="v2-ce-hint">Cutoff {f.cutoff} Hz</p>}
      <label className="v2-ce-switch"><input type="checkbox" checked={!!track.mute} onChange={(e) => set({ ...track, mute: e.target.checked || undefined })} /><span>Mute this track</span></label>
    </div>
  );
}

function ClipTab({ clip, commit, onImport, issues }: { clip: AudioClip; commit: (c: AudioClip, key?: string) => void; onImport: (f: File) => void; issues: ClipIssue[] }) {
  const [wavMsg, setWavMsg] = useState("");
  const exportWav = async () => {
    setWavMsg("Rendering…");
    try { const b = await renderAudioClip(clip); await saveFile(bufferToWav(b), `${fileBase(clip.name)}.wav`); setWavMsg(""); }
    catch (e) { setWavMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="v2-ce-panel">
      <label className="v2-ce-field"><span>Name</span><input type="text" value={clip.name} onChange={(e) => commit({ ...clip, name: e.target.value }, "name")} /></label>
      <div className="v2-ae-sliders">
        <Slider label="Tempo" unit="BPM" min={40} max={240} step={1} value={clip.tempo} onChange={(v) => commit({ ...clip, tempo: v }, "tempo")} />
        <Slider label="Grid length" unit="steps" min={4} max={64} step={4} value={gridSteps(clip)} onChange={(v) => commit({ ...clip, steps: v }, "steps")} hint={`${(gridSteps(clip) * stepSec(clip)).toFixed(2)} s at this tempo`} />
        <Slider label="Duration" unit="s" min={0} max={30} step={0.1} value={clip.duration ?? 0} onChange={(v) => { const { duration: _d, ...rest } = clip; commit(v > 0 ? { ...rest, duration: v } : (rest as AudioClip), "dur"); }} hint="0 = the grid length" />
        <Slider label="Master volume" min={0} max={1} step={0.01} value={clip.volume ?? 0.8} onChange={(v) => commit({ ...clip, volume: v }, "mvol")} />
        <Slider label="Seed" min={0} max={999} step={1} value={clip.seed ?? 1} onChange={(v) => commit({ ...clip, seed: v }, "seed")} hint="Changes noise, rain and glitch randomness (same seed = same sound)" />
      </div>
      <p className="v2-ce-hint">Length {clipDuration(clip).toFixed(2)} s{clip.duration ? "" : " (from the grid)"}. One step is {(stepSec(clip) * 1000).toFixed(0)} ms.</p>
      <span className="v2-ce-label">Files</span>
      <div className="v2-ce-export">
        <label className="v2-btn" title="Load a dionysus.audioclip/1 .json file">Import .json
          <input type="file" hidden accept={AUDIO_JSON_ACCEPT} aria-label="Import audio clip JSON" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
        </label>
        <button type="button" className="v2-btn" onClick={() => void saveFile(new Blob([stringifyAudioClip(clip)], { type: "application/json" }), `${fileBase(clip.name)}.audioclip.json`)}>Export .json</button>
        <button type="button" className="v2-btn" onClick={() => void exportWav()}>Export WAV</button>
      </div>
      {wavMsg && <span className="v2-muted" role="status">{wavMsg}</span>}
      <ClipIssues issues={toHtmlIssues(issues)} testId="v2-ae-issues" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function TemplateList({ onPick }: { onPick: (c: AudioClip) => void }) {
  return (
    <ul className="v2-ce-samples">
      {AUDIO_TEMPLATES.map((t) => (
        <li key={t.id}>
          <button type="button" className="v2-ce-sample" onClick={() => onPick(structuredClone(t.clip))}>
            <span className="v2-ce-sampleicon"><Icon g={t.clip.tracks.some((x) => x.instrument === "sfx") ? "effect" : "♫"} /></span>
            <span><b>{t.name}</b><span className="v2-muted">{t.description}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AddTrackList({ onPick }: { onPick: (i: Instrument, s?: SfxId) => void }) {
  return (
    <div className="v2-ae-addlist">
      <span className="v2-ce-label">Instruments</span>
      <div className="v2-tp-chips">{INSTRUMENTS.filter((i) => i !== "sfx").map((i) => <button key={i} type="button" className="v2-chip" onClick={() => onPick(i)}>{INST_LABEL[i]}</button>)}</div>
      <span className="v2-ce-label">Sound effects</span>
      <div className="v2-tp-chips">{SFX.map((s) => <button key={s} type="button" className="v2-chip" onClick={() => onPick("sfx", s)}>{SFX_LABEL[s]}</button>)}</div>
    </div>
  );
}

export function AudioEditor({ source, mobile, onSave, onClose, create }: {
  /** The clip JSON to edit (undefined: a new clip from the Lo-fi beat template). */ source?: string;
  mobile: boolean; onSave: (clip: AudioClip) => Promise<void> | void; onClose: () => void;
  /** A new clip (Add Audio → Create): the primary action adds it to the timeline. */ create?: boolean;
}) {
  const start = useMemo(() => {
    if (source === undefined) return { clip: newAudioClip(), issues: [] as ClipIssue[] };
    const r = parseAudioClip(source);
    return r.ok ? { clip: r.clip, issues: r.issues } : { clip: newAudioClip(), issues: r.issues };
  }, [source]);
  const h = useHistory(start.clip);
  const { clip, commit } = h;
  const [issues, setIssues] = useState<ClipIssue[]>(start.issues);
  const [sel, setSel] = useState(start.clip.tracks[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("pattern");
  const [templates, setTemplates] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; body: string; ok: string; run: () => void } | null>(null);
  const baseline = useMemo(() => stringifyAudioClip(start.clip), [start]);
  const dirty = stringifyAudioClip(clip) !== baseline;
  const track = clip.tracks.find((t) => t.id === sel) ?? clip.tracks[0];
  const canSave = (create || dirty) && clip.tracks.length > 0 && !saving;

  const setTrack = (t: ClipTrack, key?: string) => commit((c) => ({ ...c, tracks: c.tracks.map((x) => (x.id === t.id ? t : x)) }), key);
  const ask = (title: string, body: string, ok: string, run: () => void) => (dirty ? setConfirm({ title, body, ok, run }) : run());
  const load = (c: AudioClip, iss: ClipIssue[] = []) => { commit(c); setIssues(iss); setSel(c.tracks[0]?.id ?? ""); setTab("pattern"); };
  const pickTemplate = (c: AudioClip) => { setTemplates(false); ask(`Load "${c.name}"?`, "This replaces the tracks you're editing (Undo brings them back).", "Replace", () => load(c)); };
  const importFile = async (f: File) => {
    const r = parseAudioClip(await f.text());
    if (!r.ok) { setIssues(r.issues); setTab("clip"); return; }
    ask(`Import "${r.clip.name}"?`, "This replaces the tracks you're editing (Undo brings them back).", "Import", () => load(r.clip, r.issues));
  };
  const addTrack = (i: Instrument, s?: SfxId) => { setAdding(false); const t = newTrack(i, clip.tracks.map((x) => x.id), s); commit({ ...clip, tracks: [...clip.tracks, t] }); setSel(t.id); setTab(i === "sfx" ? "sound" : "pattern"); };
  const removeTrack = (id: string) => { const rest = clip.tracks.filter((t) => t.id !== id); commit({ ...clip, tracks: rest }); setSel(rest[0]?.id ?? ""); };
  const save = async () => {
    if (!canSave) return;
    setSaving("Rendering…");
    try { await onSave(clip); } catch (e) { setSaving(""); setIssues([{ path: "", level: "error", message: `Couldn't render the clip: ${e instanceof Error ? e.message : String(e)}` }]); return; }
    setSaving("");
  };
  const close = () => ask("Discard your changes?", "Your edits to this audio clip will be lost.", "Discard", onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const onDrop = (e: DragEvent) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void importFile(f); } };

  const panel: ReactNode = !track ? (
    <div className="v2-ce-panel"><p className="v2-ce-empty">No tracks. Add one to start.</p><AddTrackList onPick={addTrack} /></div>
  ) : tab === "pattern" ? (
    <div className="v2-ce-panel">{track.instrument === "sfx" || track.instrument === "noise" ? <EventsEditor clip={clip} track={track} set={setTrack} /> : <StepGrid clip={clip} track={track} set={setTrack} />}</div>
  ) : tab === "sound" ? <SoundTab track={track} set={setTrack} />
    : tab === "mix" ? <MixTab track={track} set={setTrack} />
    : null;

  const tracks = (
    <div className="v2-ae-tracks" role="listbox" aria-label="Tracks">
      {clip.tracks.map((t) => (
        <span key={t.id} className={`v2-ae-track ${track?.id === t.id ? "is-active" : ""} ${t.mute ? "is-muted" : ""}`}>
          <button type="button" role="option" aria-selected={track?.id === t.id} className="v2-ae-trackbtn" onClick={() => { setSel(t.id); if (tab === "clip") setTab("pattern"); }}>
            <Icon g={t.instrument === "sfx" ? "effect" : t.instrument === "drums" ? "▤" : t.instrument === "noise" ? "⤓" : "♫"} size={16} />
            <span>{trackLabel(t)}</span>
          </button>
          {track?.id === t.id && clip.tracks.length > 1 && <button type="button" className="v2-btn v2-ce-icon v2-ae-trackdel" aria-label={`Remove track ${trackLabel(t)}`} onClick={() => removeTrack(t.id)}><Icon g="✕" size={16} /></button>}
        </span>
      ))}
      <button type="button" className="v2-btn v2-ae-addtrack" aria-haspopup="dialog" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon g="＋" /> Track</button>
    </div>
  );

  return (
    <div className={`v2-code-editor v2-ce v2-ae ${mobile ? "is-mobile" : ""}`} role="dialog" aria-modal="true" aria-label="Audio editor" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={onDrop}>
      <header className="v2-ce-bar">
        {mobile && <button type="button" className="v2-btn v2-ce-icon" aria-label="Cancel" title="Cancel" onClick={close}><Icon g="✕" /></button>}
        <span className="v2-ce-title">
          <b>{clip.name || "Audio clip"}</b>
          <span className="v2-muted">{saving || (create ? "New audio clip" : dirty ? "Edited — save makes a new version" : "Audio clip")}</span>
        </span>
        <button type="button" className="v2-btn v2-ce-samplesbtn" aria-label="Templates" title="Start from a template" aria-haspopup="dialog" aria-expanded={templates} onClick={() => setTemplates(!templates)}>
          <Icon g="template" /><span>Templates</span>
        </button>
        {!mobile && <button type="button" className="v2-btn" onClick={close}>Cancel</button>}
        <button type="button" className="v2-btn primary" disabled={!canSave} title={create ? "Render and add this audio to the timeline at the playhead (undoable)" : dirty ? "Render and save as a new version (undoable)" : "No changes"} onClick={() => void save()}>{create ? (mobile ? "Add" : "Add to timeline") : "Save"}</button>
        {templates && !mobile && <div className="v2-ce-popover" role="dialog" aria-label="Templates"><TemplateList onPick={pickTemplate} /></div>}
      </header>
      <div className="v2-ce-main">
        {mobile && <section className="v2-ce-side" aria-label="Preview"><PreviewPanel {...h} mobile /></section>}
        <section className="v2-ce-work">
          {tracks}
          {adding && !mobile && <div className="v2-ae-addpop" role="dialog" aria-label="Add track"><AddTrackList onPick={addTrack} /></div>}
          <div role="tablist" aria-label="Editor tabs" className="v2-ce-tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`v2-ce-tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}{t.id === "clip" && issues.some((i) => i.level === "error") && <span className="v2-ce-dot" aria-label="has errors" />}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="v2-ce-body" aria-label={TABS.find((t) => t.id === tab)!.label}>
            {tab === "clip" ? <ClipTab clip={clip} commit={commit} onImport={(f) => void importFile(f)} issues={issues} /> : panel}
          </div>
        </section>
        {!mobile && (
          <section className="v2-ce-side" aria-label="Preview">
            <PreviewPanel {...h} mobile={false} />
            <p className="v2-ce-hint">Space plays or stops. Every edit re-renders the preview; Save renders the same audio for the timeline and export.</p>
          </section>
        )}
      </div>
      {templates && mobile && <Sheet label="Templates" onClose={() => setTemplates(false)} snaps={[0.5, 0.75]} initial={0}><TemplateList onPick={pickTemplate} /></Sheet>}
      {adding && mobile && <Sheet label="Add track" onClose={() => setAdding(false)} snaps={[0.45, 0.7]} initial={0}><AddTrackList onPick={addTrack} /></Sheet>}
      {confirm && <Confirm title={confirm.title} body={confirm.body} ok={confirm.ok} onCancel={() => setConfirm(null)} onOk={() => { const r = confirm.run; setConfirm(null); r(); }} />}
    </div>
  );
}

/** Paste box + .json picker for an AI-written clip (the storyboard's json audio source); `onAdd` gets the parsed clip. */
export function AudioClipImport({ onAdd, busy, label = "Add as new version" }: { onAdd: (clip: AudioClip) => Promise<void> | void; busy?: boolean; label?: string }) {
  const [text, setText] = useState("");
  const [fileIssues, setFileIssues] = useState<ClipIssue[] | null>(null);
  const r = useMemo(() => (text.trim() ? parseAudioClip(text) : undefined), [text]);
  const load = async (f: File | undefined) => { if (!f) return; setFileIssues(null); setText(await f.text()); };
  const add = async () => { if (r?.ok) { await onAdd(r.clip); setText(""); } };
  const issues = fileIssues ?? r?.issues ?? [];
  return (
    <div className="v2-html-import" data-testid="v2-audio-import">
      <textarea aria-label="Paste the AI's reply or the audio clip JSON" placeholder={'Paste the AI\'s reply (the ```json block is picked out) or the dionysus.audioclip/1 JSON'}
        spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="v2-html-import-actions">
        {typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function" && <button className="v2-btn" onClick={() => void navigator.clipboard.readText().then(setText, () => undefined)}>Paste</button>}
        <label className="v2-btn" title="Import a dionysus.audioclip/1 .json file">Choose file…
          <input type="file" hidden accept={AUDIO_JSON_ACCEPT} aria-label="Import audio clip JSON file" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="v2-btn is-primary" data-testid="v2-audio-import-add" disabled={!r?.ok || busy} title={r && !r.ok ? "Fix the errors first" : "Render it and add as a new version (undoable)"} onClick={() => void add()}>{label}</button>
      </div>
      <ClipIssues issues={toHtmlIssues(issues)} testId="v2-audio-import-issues" />
      {r?.ok && !r.issues.length && <span className="v2-muted">Valid "{r.clip.name}" · {r.clip.tracks.length} track{r.clip.tracks.length > 1 ? "s" : ""} · {clipDuration(r.clip).toFixed(1)} s</span>}
    </div>
  );
}
