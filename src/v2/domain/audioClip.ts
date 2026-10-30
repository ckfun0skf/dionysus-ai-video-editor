/**
 * P4A-3: `dionysus.audioclip/1`, a small deterministic music and sound-effect document (docs/v2/AUDIO_CLIP_FORMAT.md).
 * An audio asset made in the Audio editor (or pasted from an AI) keeps this JSON next to its rendered WAV; the WAV is
 * what the timeline, the storyboard and export play. Pure data + parse/validate; rendering lives in render/audioClip.
 */
export const AUDIO_CLIP_FORMAT = "dionysus.audioclip/1" as const;

export const SYNTHS = ["piano", "pad", "bass", "pluck", "lead"] as const;
export type SynthId = (typeof SYNTHS)[number];
export const DRUMS = ["kick", "snare", "hat", "openhat", "clap", "tom"] as const;
export type DrumId = (typeof DRUMS)[number];
export const SFX = ["whoosh", "impact", "riser", "beep", "glitch", "wind", "rain"] as const;
export type SfxId = (typeof SFX)[number];
export type Instrument = SynthId | "drums" | "noise" | "sfx";
export const INSTRUMENTS: readonly Instrument[] = [...SYNTHS, "drums", "noise", "sfx"];

/** A note on the step grid: `step` from 0, `len` in steps; `pitch` is a MIDI number or a name like "C4" / "F#3" (drums: a drum name). */
export interface ClipNote { step: number; len?: number; pitch: number | string; vel?: number }
/** A timed event for noise and sfx tracks, in seconds from the clip start. */
export interface ClipEvent { t: number; dur: number; vel?: number }
export interface ClipFx { reverb?: number; delay?: number; delayTime?: number; filter?: { type: "lowpass" | "highpass" | "bandpass"; cutoff: number; q?: number } }

export interface ClipTrack {
  id: string;
  name?: string;
  instrument: Instrument;
  /** sfx tracks: which generator. */
  sfx?: SfxId;
  notes?: ClipNote[];
  events?: ClipEvent[];
  volume?: number;
  pan?: number;
  mute?: boolean;
  fx?: ClipFx;
  params?: Record<string, number | string>;
}

export interface AudioClip {
  format: typeof AUDIO_CLIP_FORMAT;
  name: string;
  /** Beats per minute (40–240). */
  tempo: number;
  /** Grid steps per beat (default 4 = sixteenth notes). */
  stepsPerBeat?: number;
  /** Length of the step grid in steps (default 16). */
  steps?: number;
  /** Clip length in seconds; default: the grid length (`steps / stepsPerBeat` beats at `tempo`), or the last event's end. */
  duration?: number;
  /** Seed for every random choice (noise, rain drops, glitches); same seed + same JSON = same audio. */
  seed?: number;
  /** Output gain 0–1 (default 0.8). */
  volume?: number;
  tracks: ClipTrack[];
}

/** Param sliders: per instrument kind, with ranges and defaults (used by the renderer, the SFX designer and the doc). */
export interface ParamSpec { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string; description: string }
const P = (key: string, label: string, min: number, max: number, step: number, def: number, description: string, unit?: string): ParamSpec => ({ key, label, min, max, step, default: def, description, ...(unit ? { unit } : {}) });

export const SYNTH_PARAMS: ParamSpec[] = [
  P("attack", "Attack", 0, 2, 0.01, -1, "Seconds to full level (-1 = the instrument's own).", "s"),
  P("release", "Release", 0, 4, 0.01, -1, "Seconds to fade after the note (-1 = the instrument's own).", "s"),
  P("tone", "Tone", 0, 1, 0.01, 0.6, "Brightness: low-pass cutoff of the voice."),
  P("detune", "Detune", 0, 50, 1, 8, "Cents between the voice's oscillators (pad, lead).", "ct"),
];
export const NOISE_PARAMS: ParamSpec[] = [
  P("color", "Colour", 0, 2, 1, 1, "0 white, 1 pink, 2 brown."),
  P("tone", "Tone", 0, 1, 0.01, 0.5, "Low-pass cutoff (dark to bright)."),
  P("attack", "Attack", 0, 4, 0.01, 0.2, "Fade-in seconds.", "s"),
  P("release", "Release", 0, 4, 0.01, 0.4, "Fade-out seconds.", "s"),
];
export const SFX_PARAMS: Record<SfxId, ParamSpec[]> = {
  whoosh: [P("tone", "Tone", 0, 1, 0.01, 0.55, "Centre brightness."), P("sweep", "Sweep", 0, 1, 0.01, 0.7, "How far the band moves."), P("peak", "Peak at", 0.1, 0.9, 0.01, 0.6, "Where the loudest point falls (fraction of the event).")],
  impact: [P("pitch", "Pitch", 30, 200, 1, 60, "Body frequency.", "Hz"), P("punch", "Punch", 0, 1, 0.01, 0.7, "Noise crack at the hit."), P("tail", "Tail", 0.1, 4, 0.01, 1.2, "Decay seconds.", "s")],
  riser: [P("pitch", "Start", 40, 800, 1, 120, "Start frequency.", "Hz"), P("pitchEnd", "End", 200, 4000, 10, 1600, "End frequency.", "Hz"), P("noise", "Noise", 0, 1, 0.01, 0.4, "Noise mixed in.")],
  beep: [P("pitch", "Pitch", 200, 3000, 10, 880, "Tone frequency.", "Hz"), P("count", "Beeps", 1, 6, 1, 2, "Beeps in the event."), P("gap", "Gap", 0.02, 0.5, 0.01, 0.08, "Silence between beeps.", "s"), P("wave", "Wave", 0, 3, 1, 0, "0 sine, 1 square, 2 triangle, 3 saw.")],
  glitch: [P("density", "Density", 1, 40, 1, 14, "Bursts per second."), P("pitch", "Pitch", 100, 4000, 10, 900, "Mean burst frequency.", "Hz"), P("chaos", "Chaos", 0, 1, 0.01, 0.6, "Spread of pitch and length.")],
  wind: [P("tone", "Tone", 0, 1, 0.01, 0.35, "Brightness of the gusts."), P("gust", "Gusts", 0, 1, 0.01, 0.5, "How much the level and band move."), P("rate", "Gust rate", 0.05, 2, 0.01, 0.25, "Gusts per second.", "Hz")],
  rain: [P("density", "Drops", 0, 1, 0.01, 0.6, "Drop density."), P("tone", "Tone", 0, 1, 0.01, 0.6, "Hiss brightness."), P("hiss", "Hiss", 0, 1, 0.01, 0.5, "Background hiss level.")],
};
export const paramSpecs = (t: Pick<ClipTrack, "instrument" | "sfx">): ParamSpec[] =>
  t.instrument === "sfx" ? SFX_PARAMS[t.sfx ?? "whoosh"] : t.instrument === "noise" ? NOISE_PARAMS : t.instrument === "drums" ? [] : SYNTH_PARAMS;
export const paramValue = (t: ClipTrack, key: string): number => {
  const v = t.params?.[key];
  const spec = paramSpecs(t).find((p) => p.key === key);
  return typeof v === "number" && Number.isFinite(v) ? (spec ? Math.min(spec.max, Math.max(spec.min === 0 && spec.default === -1 ? -1 : spec.min, v)) : v) : spec?.default ?? 0;
};

const NOTE = /^([A-Ga-g])([#b]?)(-?\d)$/;
const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
/** MIDI number for a pitch (60 = C4), or undefined. */
export function midiOf(p: number | string): number | undefined {
  if (typeof p === "number") return Number.isFinite(p) && p >= 0 && p <= 127 ? Math.round(p) : undefined;
  const m = NOTE.exec(p.trim());
  if (!m) return undefined;
  const n = SEMI[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return n >= 0 && n <= 127 ? n : undefined;
}
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export const stepsPerBeat = (c: AudioClip) => c.stepsPerBeat ?? 4;
export const gridSteps = (c: AudioClip) => c.steps ?? 16;
export const stepSec = (c: AudioClip) => 60 / c.tempo / stepsPerBeat(c);
/** The clip's length in seconds. */
export function clipDuration(c: AudioClip): number {
  if (c.duration && c.duration > 0) return c.duration;
  const grid = gridSteps(c) * stepSec(c);
  const ev = Math.max(0, ...c.tracks.flatMap((t) => (t.events ?? []).map((e) => e.t + e.dur)));
  return Math.max(grid, ev) || 1;
}

export interface ClipIssue { path: string; message: string; level: "error" | "warning" }
export type ParseResult = { ok: true; clip: AudioClip; issues: ClipIssue[] } | { ok: false; issues: ClipIssue[] };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Strip a ```json fence or text around the first {…} so a pasted AI reply imports as is. */
export function extractJson(text: string): string {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1] : text;
  const a = body.indexOf("{"), b = body.lastIndexOf("}");
  return a >= 0 && b > a ? body.slice(a, b + 1) : body.trim();
}

/** Parse and validate; values out of range are clamped with a warning, unknown ids are errors. */
export function parseAudioClip(input: string | unknown): ParseResult {
  const issues: ClipIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, level: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, level: "warning" });
  let raw: unknown = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(extractJson(input)); } catch (e) { return { ok: false, issues: [{ path: "", message: `Not valid JSON: ${e instanceof Error ? e.message : e}`, level: "error" }] }; }
  }
  if (!isObj(raw)) return { ok: false, issues: [{ path: "", message: "The audio clip must be a JSON object.", level: "error" }] };
  if (raw.format !== AUDIO_CLIP_FORMAT) err("format", `"format" must be "${AUDIO_CLIP_FORMAT}".`);
  const rng = (path: string, v: unknown, a: number, b: number, def: number | undefined, label: string): number | undefined => {
    if (v === undefined) return def;
    if (!num(v)) { err(path, `${label} must be a number.`); return def; }
    if (v < a || v > b) { warn(path, `${label} ${v} is outside ${a}–${b}; clamped.`); return clamp(v, a, b); }
    return v;
  };
  const tempo = rng("tempo", raw.tempo, 40, 240, 120, '"tempo"')!;
  const spb = rng("stepsPerBeat", raw.stepsPerBeat, 1, 8, undefined, '"stepsPerBeat"');
  const steps = rng("steps", raw.steps, 1, 256, undefined, '"steps"');
  const duration = rng("duration", raw.duration, 0.05, 120, undefined, '"duration"');
  const seed = rng("seed", raw.seed, 0, 2 ** 31, undefined, '"seed"');
  const volume = rng("volume", raw.volume, 0, 1, undefined, '"volume"');
  if (!Array.isArray(raw.tracks) || !raw.tracks.length) err("tracks", '"tracks" must be a non-empty array.');
  const ids = new Set<string>();
  const tracks: ClipTrack[] = (Array.isArray(raw.tracks) ? raw.tracks : []).flatMap((t: unknown, i: number): ClipTrack[] => {
    const p = `tracks[${i}]`;
    if (!isObj(t)) { err(p, "A track must be an object."); return []; }
    const inst = t.instrument as Instrument;
    if (!INSTRUMENTS.includes(inst)) { err(`${p}.instrument`, `Unknown instrument "${String(t.instrument)}". Use one of: ${INSTRUMENTS.join(", ")}.`); return []; }
    let id = typeof t.id === "string" && t.id.trim() ? t.id.trim() : `t${i + 1}`;
    if (ids.has(id)) { warn(`${p}.id`, `Duplicate track id "${id}"; renamed.`); id = `${id}-${i + 1}`; }
    ids.add(id);
    const out: ClipTrack = { id, instrument: inst };
    if (typeof t.name === "string" && t.name.trim()) out.name = t.name.trim();
    if (inst === "sfx") {
      if (!SFX.includes(t.sfx as SfxId)) err(`${p}.sfx`, `An sfx track needs "sfx": one of ${SFX.join(", ")}.`);
      else out.sfx = t.sfx as SfxId;
    } else if (t.sfx !== undefined) warn(`${p}.sfx`, '"sfx" only applies to instrument "sfx"; ignored.');
    const v = rng(`${p}.volume`, t.volume, 0, 1, undefined, "volume"); if (v !== undefined) out.volume = v;
    const pan = rng(`${p}.pan`, t.pan, -1, 1, undefined, "pan"); if (pan !== undefined) out.pan = pan;
    if (t.mute === true) out.mute = true;
    const usesEvents = inst === "sfx" || inst === "noise";
    if (usesEvents) {
      if (t.notes !== undefined) warn(`${p}.notes`, `${inst} tracks play "events" (seconds), not "notes"; notes ignored.`);
      if (!Array.isArray(t.events) || !t.events.length) err(`${p}.events`, `A ${inst} track needs "events": [{ "t": seconds, "dur": seconds }].`);
      out.events = (Array.isArray(t.events) ? t.events : []).flatMap((e: unknown, j: number) => {
        const q = `${p}.events[${j}]`;
        if (!isObj(e) || !num(e.t) || !num(e.dur)) { err(q, 'An event needs numbers "t" and "dur" (seconds).'); return []; }
        const ev: ClipEvent = { t: clamp(e.t, 0, 120), dur: clamp(e.dur, 0.01, 120) };
        const vel = rng(`${q}.vel`, e.vel, 0, 1, undefined, "vel"); if (vel !== undefined) ev.vel = vel;
        return [ev];
      });
    } else {
      if (t.events !== undefined) warn(`${p}.events`, `${inst} tracks play "notes" on the step grid, not "events"; events ignored.`);
      if (!Array.isArray(t.notes)) err(`${p}.notes`, `A ${inst} track needs "notes": [{ "step", "pitch", "len"? , "vel"? }] (may be empty).`);
      out.notes = (Array.isArray(t.notes) ? t.notes : []).flatMap((n: unknown, j: number) => {
        const q = `${p}.notes[${j}]`;
        if (!isObj(n) || !num(n.step) || n.step < 0) { err(q, 'A note needs "step" (a whole number from 0).'); return []; }
        let pitch: number | string;
        if (inst === "drums") {
          if (!DRUMS.includes(n.pitch as DrumId)) { err(`${q}.pitch`, `Drum notes use "pitch": one of ${DRUMS.join(", ")}.`); return []; }
          pitch = n.pitch as string;
        } else {
          const m = midiOf(n.pitch as number | string);
          if (m === undefined) { err(`${q}.pitch`, `"pitch" must be a MIDI number (0–127) or a note name like "C4" or "F#3".`); return []; }
          pitch = typeof n.pitch === "string" ? (n.pitch as string) : m;
        }
        const note: ClipNote = { step: Math.round(n.step), pitch };
        const len = rng(`${q}.len`, n.len, 0.25, 256, undefined, "len"); if (len !== undefined && len !== 1) note.len = len;
        const vel = rng(`${q}.vel`, n.vel, 0, 1, undefined, "vel"); if (vel !== undefined) note.vel = vel;
        return [note];
      });
    }
    if (t.fx !== undefined) {
      if (!isObj(t.fx)) err(`${p}.fx`, '"fx" must be an object { reverb?, delay?, delayTime?, filter? }.');
      else {
        const fx: ClipFx = {};
        const rv = rng(`${p}.fx.reverb`, t.fx.reverb, 0, 1, undefined, "reverb"); if (rv) fx.reverb = rv;
        const dl = rng(`${p}.fx.delay`, t.fx.delay, 0, 0.95, undefined, "delay"); if (dl) fx.delay = dl;
        const dt = rng(`${p}.fx.delayTime`, t.fx.delayTime, 0.02, 2, undefined, "delayTime"); if (dt !== undefined) fx.delayTime = dt;
        const f = t.fx.filter;
        if (f !== undefined) {
          if (!isObj(f) || !["lowpass", "highpass", "bandpass"].includes(f.type as string) || !num(f.cutoff)) err(`${p}.fx.filter`, '"filter" must be { "type": "lowpass" | "highpass" | "bandpass", "cutoff": Hz, "q"? }.');
          else fx.filter = { type: f.type as "lowpass", cutoff: clamp(f.cutoff, 20, 20000), ...(num(f.q) ? { q: clamp(f.q, 0.1, 30) } : {}) };
        }
        for (const k of Object.keys(t.fx)) if (!["reverb", "delay", "delayTime", "filter"].includes(k)) warn(`${p}.fx.${k}`, `Unknown fx "${k}"; ignored (reverb, delay, delayTime, filter).`);
        if (Object.keys(fx).length) out.fx = fx;
      }
    }
    if (t.params !== undefined) {
      if (!isObj(t.params)) err(`${p}.params`, '"params" must be an object of numbers.');
      else {
        const specs = paramSpecs(out);
        const params: Record<string, number> = {};
        for (const [k, val] of Object.entries(t.params)) {
          const s = specs.find((x) => x.key === k);
          if (!s) { warn(`${p}.params.${k}`, `Unknown param "${k}" for ${inst}${out.sfx ? ` ${out.sfx}` : ""}; ignored${specs.length ? ` (${specs.map((x) => x.key).join(", ")})` : ""}.`); continue; }
          const lo = s.default === -1 ? -1 : s.min;
          const c = rng(`${p}.params.${k}`, val, lo, s.max, undefined, k); if (c !== undefined) params[k] = c;
        }
        if (Object.keys(params).length) out.params = params;
      }
    }
    for (const k of Object.keys(t)) if (!["id", "name", "instrument", "sfx", "notes", "events", "volume", "pan", "mute", "fx", "params"].includes(k)) warn(`${p}.${k}`, `Unknown track field "${k}"; ignored.`);
    return [out];
  });
  for (const k of Object.keys(raw)) if (!["format", "name", "tempo", "stepsPerBeat", "steps", "duration", "seed", "volume", "tracks"].includes(k)) warn(k, `Unknown field "${k}"; ignored.`);
  if (issues.some((i) => i.level === "error")) return { ok: false, issues };
  const clip: AudioClip = { format: AUDIO_CLIP_FORMAT, name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Audio clip", tempo, ...(spb !== undefined ? { stepsPerBeat: Math.round(spb) } : {}), ...(steps !== undefined ? { steps: Math.round(steps) } : {}), ...(duration !== undefined ? { duration } : {}), ...(seed !== undefined ? { seed: Math.round(seed) } : {}), ...(volume !== undefined ? { volume } : {}), tracks };
  return { ok: true, clip, issues };
}

export const stringifyAudioClip = (c: AudioClip) => `${JSON.stringify(c, null, 2)}\n`;

/** Built-in starting points (the editor's Templates; also the doc's examples). */
export const AUDIO_TEMPLATES: { id: string; name: string; description: string; clip: AudioClip }[] = [
  { id: "ambient-pad", name: "Ambient pad", description: "Slow evolving chords with reverb and soft noise.", clip: {
    format: AUDIO_CLIP_FORMAT, name: "Ambient pad", tempo: 70, steps: 32, seed: 7, tracks: [
      { id: "pad", name: "Pad", instrument: "pad", volume: 0.7, fx: { reverb: 0.6, filter: { type: "lowpass", cutoff: 2400 } }, params: { attack: 1.2, release: 2 },
        notes: [{ step: 0, len: 16, pitch: "C3" }, { step: 0, len: 16, pitch: "G3" }, { step: 0, len: 16, pitch: "E4" }, { step: 16, len: 16, pitch: "A2" }, { step: 16, len: 16, pitch: "E3" }, { step: 16, len: 16, pitch: "C4" }] },
      { id: "air", name: "Air", instrument: "noise", volume: 0.15, params: { color: 1, tone: 0.3, attack: 2, release: 2 }, events: [{ t: 0, dur: 6.86 }] },
    ] } },
  { id: "tension-riser", name: "Tension riser", description: "A 4-second riser into an impact.", clip: {
    format: AUDIO_CLIP_FORMAT, name: "Tension riser", tempo: 120, duration: 5.5, seed: 3, tracks: [
      { id: "rise", name: "Riser", instrument: "sfx", sfx: "riser", volume: 0.7, fx: { reverb: 0.3 }, params: { pitch: 90, pitchEnd: 1800, noise: 0.5 }, events: [{ t: 0, dur: 4 }] },
      { id: "hit", name: "Impact", instrument: "sfx", sfx: "impact", volume: 0.9, fx: { reverb: 0.4 }, params: { pitch: 50, punch: 0.8, tail: 1.4 }, events: [{ t: 4, dur: 1.5 }] },
    ] } },
  { id: "lofi-beat", name: "Lo-fi beat", description: "A relaxed 2-bar beat with keys and bass.", clip: {
    format: AUDIO_CLIP_FORMAT, name: "Lo-fi beat", tempo: 84, steps: 32, seed: 11, volume: 0.8, tracks: [
      { id: "drums", name: "Drums", instrument: "drums", volume: 0.8, fx: { filter: { type: "lowpass", cutoff: 6000 } },
        notes: [0, 10, 16, 26].map((s) => ({ step: s, pitch: "kick" })).concat([4, 12, 20, 28].map((s) => ({ step: s, pitch: "snare" })), Array.from({ length: 16 }, (_, i) => ({ step: i * 2, pitch: "hat", vel: i % 2 ? 0.45 : 0.7 }))) },
      { id: "keys", name: "Keys", instrument: "piano", volume: 0.55, fx: { reverb: 0.35 },
        notes: [{ step: 0, len: 8, pitch: "D4" }, { step: 0, len: 8, pitch: "F4" }, { step: 0, len: 8, pitch: "A4" }, { step: 8, len: 8, pitch: "C4" }, { step: 8, len: 8, pitch: "E4" }, { step: 8, len: 8, pitch: "G4" }, { step: 16, len: 8, pitch: "Bb3" }, { step: 16, len: 8, pitch: "D4" }, { step: 16, len: 8, pitch: "F4" }, { step: 24, len: 8, pitch: "A3" }, { step: 24, len: 8, pitch: "C4" }, { step: 24, len: 8, pitch: "E4" }] },
      { id: "bass", name: "Bass", instrument: "bass", volume: 0.7, notes: [{ step: 0, len: 6, pitch: "D2" }, { step: 8, len: 6, pitch: "C2" }, { step: 16, len: 6, pitch: "Bb1" }, { step: 24, len: 6, pitch: "A1" }] },
    ] } },
  { id: "notification", name: "Notification", description: "A short bright two-note chime.", clip: {
    format: AUDIO_CLIP_FORMAT, name: "Notification", tempo: 150, steps: 8, tracks: [
      { id: "chime", name: "Chime", instrument: "pluck", volume: 0.8, fx: { reverb: 0.25, delay: 0.25, delayTime: 0.15 }, notes: [{ step: 0, len: 2, pitch: "E5" }, { step: 2, len: 4, pitch: "B5" }] },
    ] } },
  { id: "whoosh", name: "Whoosh", description: "A fast air pass for transitions.", clip: {
    format: AUDIO_CLIP_FORMAT, name: "Whoosh", tempo: 120, duration: 1.2, seed: 5, tracks: [
      { id: "whoosh", name: "Whoosh", instrument: "sfx", sfx: "whoosh", volume: 0.85, pan: 0, fx: { reverb: 0.15 }, params: { tone: 0.6, sweep: 0.8, peak: 0.55 }, events: [{ t: 0, dur: 1.1 }] },
    ] } },
];

export const newAudioClip = (): AudioClip => structuredClone(AUDIO_TEMPLATES.find((t) => t.id === "lofi-beat")!.clip);
