/**
 * P91: Standard MIDI File (type 0 and 1) import for the Audio editor (docs/v2/AUDIO_CLIP_FORMAT.md, "MIDI import").
 * parseMidi reads the bytes (no dependency): header, tracks, delta times, running status, meta events (tempo, names,
 * end of track), sysex, and channel messages. midiToAudioClip turns the result into a `dionysus.audioclip/1` clip:
 * one track per MIDI track and channel, MIDI ticks as steps (exact timing), tempo changes as a tempo map, GM programs
 * mapped to the closest built-in sampled instrument (or a synth), channel 10 to the drum kit, sustain pedal folded into
 * note lengths.
 */
import { AUDIO_CLIP_FORMAT, MAX_DURATION, stepTime, type AudioClip, type ClipNote, type ClipTrack, type DrumId, type SynthId, type TempoChange } from "./audioClip";
import type { SamplerId } from "./samplerPacks";

export interface MidiNoteEvent { type: "note"; tick: number; channel: number; key: number; velocity: number; on: boolean }
export interface MidiCcEvent { type: "cc"; tick: number; channel: number; controller: number; value: number }
export interface MidiProgramEvent { type: "program"; tick: number; channel: number; program: number }
export interface MidiTempoEvent { type: "tempo"; tick: number; microsPerQuarter: number }
export interface MidiNameEvent { type: "name"; tick: number; text: string }
export type MidiEvent = MidiNoteEvent | MidiCcEvent | MidiProgramEvent | MidiTempoEvent | MidiNameEvent;
export interface MidiTrack { events: MidiEvent[] }
export interface MidiFile {
  format: number;
  /** Ticks per quarter note. SMPTE files are converted to ticks at 120 BPM. */
  ticksPerQuarter: number;
  tracks: MidiTrack[];
}

export class MidiError extends Error {}

/** Parse a Standard MIDI File. Throws MidiError on a file that isn't one. */
export function parseMidi(bytes: Uint8Array): MidiFile {
  let p = 0;
  const need = (n: number) => { if (p + n > bytes.length) throw new MidiError("The MIDI file ends too early."); };
  const u8 = () => { need(1); return bytes[p++]; };
  const u16 = () => { need(2); const v = (bytes[p] << 8) | bytes[p + 1]; p += 2; return v; };
  const u32 = () => { need(4); const v = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0; p += 4; return v; };
  const str4 = () => { need(4); const s = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]); p += 4; return s; };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const b = u8(); v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) return v; } throw new MidiError("Bad variable-length number in the MIDI file."); };

  if (bytes.length < 14 || str4() !== "MThd") throw new MidiError("Not a MIDI file (no MThd header).");
  const hlen = u32();
  const format = u16(), ntracks = u16(), division = u16();
  p += Math.max(0, hlen - 6);
  if (format > 2) throw new MidiError(`Unsupported MIDI format ${format}.`);
  let ticksPerQuarter = division;
  if (division & 0x8000) {
    // SMPTE: -frames per second (high byte, two's complement) × ticks per frame. Express as ticks per quarter at 120 BPM.
    const fps = 256 - (division >> 8), tpf = division & 0xff;
    ticksPerQuarter = Math.max(1, Math.round((fps * tpf) / 2));
  }
  if (!ticksPerQuarter) throw new MidiError("The MIDI file's time division is 0.");
  const tracks: MidiTrack[] = [];
  const dec = new TextDecoder("latin1");
  for (let ti = 0; ti < ntracks && p + 8 <= bytes.length; ti++) {
    const id = str4(), len = u32();
    const end = Math.min(bytes.length, p + len);
    if (id !== "MTrk") { p = end; ti--; continue; }
    const events: MidiEvent[] = [];
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let b = u8();
      if (b === 0xff) {
        const type = u8(), l = vlq();
        need(l);
        const data = bytes.subarray(p, p + l);
        p += l;
        if (type === 0x2f) break;
        if (type === 0x51 && l >= 3) events.push({ type: "tempo", tick, microsPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (type === 0x03 || type === 0x04) events.push({ type: "name", tick, text: dec.decode(data).replace(/\0/g, "").trim() });
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { const l = vlq(); need(l); p += l; continue; }
      if (b < 0x80) {
        // Running status: this byte is the first data byte of a message with the previous status.
        if (!status) throw new MidiError("MIDI data without a status byte.");
        p--; b = status;
      } else if (b < 0xf0) status = b;
      else continue; // system common/real-time inside a file: no data we use
      const kind = b & 0xf0, channel = b & 0x0f;
      const d1 = u8();
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : u8();
      if (kind === 0x90 || kind === 0x80) events.push({ type: "note", tick, channel, key: d1 & 0x7f, velocity: d2 & 0x7f, on: kind === 0x90 && d2 > 0 });
      else if (kind === 0xb0) events.push({ type: "cc", tick, channel, controller: d1, value: d2 });
      else if (kind === 0xc0) events.push({ type: "program", tick, channel, program: d1 & 0x7f });
    }
    p = end;
    tracks.push({ events });
  }
  if (!tracks.length) throw new MidiError("The MIDI file has no tracks.");
  return { format, ticksPerQuarter, tracks };
}

/** What a GM program plays as: a built-in sampled instrument, or a synth where no recording fits. */
export type InstrumentChoice = { instrument: "sampler"; sampler: SamplerId } | { instrument: SynthId };
const S = (sampler: SamplerId): InstrumentChoice => ({ instrument: "sampler", sampler });
const Y = (instrument: SynthId): InstrumentChoice => ({ instrument });

/** General MIDI program (0–127) → the closest built-in instrument. */
export function gmInstrument(program: number): InstrumentChoice {
  const p = Math.max(0, Math.min(127, Math.round(program)));
  if (p <= 5 || p === 7) return S("piano");
  if (p === 6 || p === 12 || p === 15) return S("harp");
  if (p <= 14) return S("glockenspiel");
  if (p <= 23) return Y("pad"); // organs, accordion, harmonica
  if (p <= 28) return S("harp"); // nylon/steel/jazz/clean/muted guitar
  if (p <= 31) return Y("lead"); // overdriven/distortion guitar, harmonics
  if (p === 32) return S("pizzicato"); // acoustic bass
  if (p <= 39) return Y("bass");
  if (p === 40) return S("violin");
  if (p === 42 || p === 43) return S("cello");
  if (p === 45) return S("pizzicato");
  if (p === 46) return S("harp");
  if (p === 47) return S("timpani");
  if (p <= 55) return S("strings"); // viola, tremolo, ensembles, synth strings, choir, orchestra hit
  if (p <= 67) return S("horn"); // brass and saxophones
  if (p === 70) return S("horn"); // bassoon
  if (p <= 79) return S("flute"); // oboe, english horn, clarinet, piccolo, flute, recorder, pan flute, …
  if (p <= 87) return Y("lead");
  if (p <= 103) return Y("pad");
  if (p === 110) return S("violin"); // fiddle
  if (p === 111 || p === 109) return S("flute"); // shanai, bagpipe
  if (p === 108 || p === 112) return S("glockenspiel"); // kalimba, tinkle bell
  if (p <= 107) return S("harp"); // sitar, banjo, shamisen, koto
  if (p === 116 || p === 117) return S("timpani"); // taiko, melodic tom
  return Y("pluck");
}

/** General MIDI percussion key (channel 10) → the built-in drum kit, or undefined (skipped). */
export function gmDrum(key: number): DrumId | undefined {
  if (key === 35 || key === 36) return "kick";
  if (key === 38 || key === 40 || key === 37) return "snare";
  if (key === 39) return "clap";
  if (key === 42 || key === 44 || key === 51 || key === 53 || key === 59 || key === 54 || key === 70) return "hat";
  if (key === 46 || key === 49 || key === 52 || key === 55 || key === 57) return "openhat";
  if ([41, 43, 45, 47, 48, 50].includes(key)) return "tom";
  return undefined;
}

export interface MidiImportResult { clip: AudioClip; warnings: string[] }

const MAX_SPB = 960;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Convert a parsed MIDI file to an audio clip. Timing is exact: steps are MIDI ticks (divided down if the file's
 * resolution is above 960 per quarter), the first tempo is "tempo" and later changes go into "tempoMap".
 */
export function midiToAudioClip(midi: MidiFile, opts: { name?: string } = {}): MidiImportResult {
  const warnings: string[] = [];
  const div = Math.max(1, Math.ceil(midi.ticksPerQuarter / MAX_SPB));
  const spb = Math.max(1, Math.round(midi.ticksPerQuarter / div));
  const step = (tick: number) => Math.round(tick / div);
  // Tempo map (from any track; type 1 keeps it in track 0).
  const tempos = new Map<number, number>();
  for (const tr of midi.tracks) for (const e of tr.events) if (e.type === "tempo" && e.microsPerQuarter > 0) tempos.set(step(e.tick), Math.round((60_000_000 / e.microsPerQuarter) * 1000) / 1000);
  const changes = [...tempos.entries()].sort((a, b) => a[0] - b[0]);
  const first = changes.length && changes[0][0] === 0 ? changes[0][1] : 120;
  const tempo = Math.min(240, Math.max(40, Math.round(first * 1000) / 1000));
  let tempoMap: TempoChange[] | undefined = changes.filter(([s, t], i) => !(s === 0 && t === tempo) && !(i > 0 && changes[i - 1][1] === t)).map(([s, t]) => ({ step: s, tempo: Math.min(1000, Math.max(10, t)) }));
  if (!tempoMap.length) tempoMap = undefined;
  let fileName = "";
  const tracks: ClipTrack[] = [];
  const used = new Set<string>();
  let lastStep = 0, skippedDrums = 0;
  midi.tracks.forEach((tr, ti) => {
    const trackName = tr.events.find((e): e is MidiNameEvent => e.type === "name" && e.tick === 0)?.text ?? "";
    if (ti === 0 && midi.format === 1 && trackName && !tr.events.some((e) => e.type === "note")) fileName = trackName;
    const channels = [...new Set(tr.events.filter((e): e is MidiNoteEvent => e.type === "note").map((e) => e.channel))].sort((a, b) => a - b);
    for (const ch of channels) {
      const evs = tr.events.filter((e) => "channel" in e && e.channel === ch) as (MidiNoteEvent | MidiCcEvent | MidiProgramEvent)[];
      // Program and pan/volume: the first values (before or at the first note).
      const program = (midi.tracks.flatMap((t) => t.events).find((e): e is MidiProgramEvent => e.type === "program" && e.channel === ch && e.tick <= (evs.find((x) => x.type === "note")?.tick ?? 0)) ?? evs.find((e): e is MidiProgramEvent => e.type === "program"))?.program ?? 0;
      const cc = (n: number) => evs.find((e): e is MidiCcEvent => e.type === "cc" && e.controller === n)?.value;
      // Notes with sustain pedal (CC64 ≥ 64): a note released while the pedal is down rings until the pedal lifts
      // or the same key is struck again on this channel.
      const open = new Map<number, { tick: number; vel: number }[]>();
      const held: { key: number; start: number; vel: number; releasedAt: number }[] = [];
      const notes: { key: number; start: number; end: number; vel: number }[] = [];
      let pedal = false;
      const closeHeld = (tick: number, key?: number) => {
        for (let i = held.length - 1; i >= 0; i--) if (key === undefined || held[i].key === key) { const h = held[i]; notes.push({ key: h.key, start: h.start, end: Math.max(h.releasedAt, tick), vel: h.vel }); held.splice(i, 1); }
      };
      const sorted = [...evs].sort((a, b) => a.tick - b.tick || (a.type === "note" && !a.on ? -1 : 0) - (b.type === "note" && !b.on ? -1 : 0));
      for (const e of sorted) {
        if (e.type === "cc" && e.controller === 64) {
          const down = e.value >= 64;
          if (pedal && !down) closeHeld(e.tick);
          pedal = down;
        } else if (e.type === "note") {
          if (e.on) {
            closeHeld(e.tick, e.key);
            const list = open.get(e.key) ?? [];
            list.push({ tick: e.tick, vel: e.velocity });
            open.set(e.key, list);
          } else {
            const list = open.get(e.key);
            const n = list?.shift();
            if (!n) continue;
            if (pedal) held.push({ key: e.key, start: n.tick, vel: n.vel, releasedAt: e.tick });
            else notes.push({ key: e.key, start: n.tick, end: e.tick, vel: n.vel });
          }
        }
      }
      const endTick = Math.max(0, ...tr.events.map((e) => e.tick));
      closeHeld(endTick);
      for (const [key, list] of open) for (const n of list) notes.push({ key, start: n.tick, end: Math.max(n.tick + midi.ticksPerQuarter, endTick), vel: n.vel });
      notes.sort((a, b) => a.start - b.start || a.key - b.key);
      const drums = ch === 9;
      const out: ClipNote[] = [];
      for (const n of notes) {
        const s = step(n.start), len = Math.max(1, step(n.end) - s);
        if (drums) {
          const d = gmDrum(n.key);
          if (!d) { skippedDrums++; continue; }
          out.push({ step: s, pitch: d, vel: round2(n.vel / 127) });
          lastStep = Math.max(lastStep, s + spb);
        } else {
          out.push({ step: s, ...(len !== 1 ? { len } : {}), pitch: n.key, vel: round2(n.vel / 127) });
          lastStep = Math.max(lastStep, s + len);
        }
      }
      if (!out.length) continue;
      const choice: InstrumentChoice | { instrument: "drums" } = drums ? { instrument: "drums" } : gmInstrument(program);
      const label = choice.instrument === "sampler" ? choice.sampler : choice.instrument;
      let id = (trackName || label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `track${tracks.length + 1}`;
      if (used.has(id)) { let k = 2; while (used.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
      used.add(id);
      const vol = cc(7), pan = cc(10);
      tracks.push({
        id, name: trackName || (drums ? "Drums" : `${label[0].toUpperCase()}${label.slice(1)}${channels.length > 1 ? ` (ch ${ch + 1})` : ""}`), ...choice,
        notes: out, volume: round2(vol === undefined ? 0.7 : Math.max(0.05, (vol / 127) * 0.85)), ...(pan !== undefined && pan !== 64 ? { pan: round2(Math.max(-1, Math.min(1, (pan - 64) / 63))) } : {}),
      } as ClipTrack);
    }
  });
  if (!tracks.length) throw new MidiError("The MIDI file has no notes.");
  if (skippedDrums) warnings.push(`${skippedDrums} drum hit${skippedDrums > 1 ? "s" : ""} on keys the built-in kit doesn't have were skipped.`);
  const clip: AudioClip = { format: AUDIO_CLIP_FORMAT, name: opts.name || fileName || "MIDI import", tempo, ...(tempoMap ? { tempoMap } : {}), stepsPerBeat: spb, steps: Math.max(1, lastStep), master: { reverb: 0.25, reverbType: "hall" }, tracks };
  if (first !== tempo && !tempoMap?.some((c) => c.step === 0)) clip.tempoMap = [{ step: 0, tempo: Math.min(1000, Math.max(10, first)) }, ...(tempoMap ?? [])];
  const sec = stepTime(clip, clip.steps!);
  if (sec > MAX_DURATION) { warnings.push(`The piece is ${Math.round(sec)} s long; only the first ${MAX_DURATION} s are kept.`); clip.duration = MAX_DURATION; }
  return { clip, warnings };
}
