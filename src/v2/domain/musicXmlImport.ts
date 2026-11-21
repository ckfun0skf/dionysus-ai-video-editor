/**
 * P91: MusicXML (score-partwise, uncompressed text) import for the Audio editor (docs/v2/AUDIO_CLIP_FORMAT.md,
 * "MusicXML import"). Parts become tracks; divisions, notes, rests, chords, ties, backup and forward, tempo from
 * <sound tempo> (or a metronome mark), dynamics (pp…ff, <sound dynamics>, <note dynamics>) and transposing instruments
 * are read; the part's MIDI program, or its instrument name, picks the built-in instrument. Repeats are not expanded.
 * A compressed .mxl is unzipped by the UI (persistence's ZIP reader) before it gets here.
 */
import { AUDIO_CLIP_FORMAT, MAX_DURATION, stepTime, type AudioClip, type ClipNote, type ClipTrack, type TempoChange } from "./audioClip";
import { gmInstrument, type InstrumentChoice } from "./midiImport";
import { child, childText, kids, parseXml, type XmlNode } from "./xmlLite";

export class MusicXmlError extends Error {}

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DYN: Record<string, number> = { pppp: 0.15, ppp: 0.22, pp: 0.3, p: 0.42, mp: 0.55, mf: 0.68, f: 0.8, ff: 0.9, fff: 0.97, ffff: 1, sf: 0.88, sfz: 0.9, sffz: 0.95, fz: 0.88, rf: 0.85, rfz: 0.85, fp: 0.8, sfp: 0.85 };
const round2 = (v: number) => Math.round(v * 100) / 100;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** An instrument or part name → the closest built-in instrument (undefined: no guess). */
export function instrumentByName(name: string): InstrumentChoice | "drums" | undefined {
  const n = name.toLowerCase();
  const S = (sampler: Extract<InstrumentChoice, { instrument: "sampler" }>["sampler"]): InstrumentChoice => ({ instrument: "sampler", sampler });
  if (/drum|percussion|kit|snare|cymbal/.test(n) && !/timp/.test(n)) return "drums";
  if (/timp/.test(n)) return S("timpani");
  if (/pizz/.test(n)) return S("pizzicato");
  if (/glock|celest|bells|music box|vibra|xylo|crotal/.test(n)) return S("glockenspiel");
  if (/harp|guitar|lute|mandolin|koto/.test(n)) return S("harp");
  if (/piano|keyboard|harpsichord|klavier|clavier/.test(n)) return S("piano");
  if (/cello|violoncell|contrabass|double bass|bass viol/.test(n)) return S("cello");
  if (/violin|fiddle/.test(n) && !/ensemble|violins|section/.test(n)) return S("violin");
  if (/string|violins|viola|ensemble|choir|voice|vocal|soprano|alto|tenor|baritone|chorus/.test(n)) return S("strings");
  if (/horn|trumpet|trombone|tuba|brass|cornet|flugel|euphon|sax|bassoon/.test(n)) return S("horn");
  if (/flute|piccolo|recorder|clarinet|oboe|english horn|cor anglais|whistle|pan ?pipe/.test(n)) return S("flute");
  if (/organ|synth|pad/.test(n)) return { instrument: "pad" };
  if (/bass/.test(n)) return { instrument: "bass" };
  return undefined;
}

interface PartInfo { name: string; instrument?: string; program?: number; channel?: number }

/** Convert MusicXML text to an audio clip (throws MusicXmlError on files it can't read). */
export function musicXmlToAudioClip(text: string, opts: { name?: string } = {}): { clip: AudioClip; warnings: string[] } {
  let root: XmlNode;
  try { root = parseXml(text); } catch (e) { throw new MusicXmlError(`Not readable as XML: ${e instanceof Error ? e.message : String(e)}`); }
  if (root.name === "score-timewise") throw new MusicXmlError("score-timewise MusicXML isn't supported; export the score as (partwise) MusicXML.");
  if (root.name !== "score-partwise") throw new MusicXmlError(`Not a MusicXML score (root element <${root.name}>).`);
  const warnings: string[] = [];
  const info = new Map<string, PartInfo>();
  for (const sp of kids(child(root, "part-list"), "score-part")) {
    const mi = child(sp, "midi-instrument");
    const prog = Number(childText(mi, "midi-program")), chan = Number(childText(mi, "midi-channel"));
    info.set(sp.attrs.id ?? "", {
      name: childText(sp, "part-name") ?? "", instrument: childText(child(sp, "score-instrument"), "instrument-name"),
      ...(Number.isFinite(prog) && prog >= 1 ? { program: prog - 1 } : {}), ...(Number.isFinite(chan) && chan >= 1 ? { channel: chan } : {}),
    });
  }
  const parts = kids(root, "part");
  if (!parts.length) throw new MusicXmlError("The score has no parts.");
  // One step resolution for the whole score: the least common multiple of every <divisions>, capped at 960.
  let spb = 1;
  const visit = (n: XmlNode) => { for (const c of n.children) { if (c.name === "divisions") { const d = Math.round(Number(c.text.trim())); if (d > 0) spb = (spb * d) / gcd(spb, d); } else visit(c); } };
  for (const p of parts) visit(p);
  if (spb > 960) { warnings.push("Very fine note divisions were rounded to 960 steps per beat."); spb = 960; }

  const tempos = new Map<number, number>();
  const tracks: ClipTrack[] = [];
  const used = new Set<string>();
  let lastStep = 0, repeats = false, unpitched = 0;
  const title = childText(child(root, "work"), "work-title") || childText(root, "movement-title") || "";
  parts.forEach((part, pi) => {
    const pinfo = info.get(part.attrs.id ?? "") ?? { name: "" };
    let divisions = 1, transpose = 0, vel = 0.68, pos = 0;
    const notes: { key: number; start: number; end: number; vel: number }[] = [];
    const openTies = new Map<number, number>(); // midi → index in notes
    let lastStart = 0;
    const ticks = (dur: number) => (dur * spb) / divisions;
    const setTempo = (bpm: number) => { if (bpm > 0 && !tempos.has(Math.round(pos))) tempos.set(Math.round(pos), bpm); };
    const sound = (s: XmlNode | undefined) => {
      if (!s) return;
      const tp = Number(s.attrs.tempo); if (Number.isFinite(tp) && tp > 0) setTempo(tp);
      const dy = Number(s.attrs.dynamics); if (Number.isFinite(dy) && dy > 0) vel = Math.min(1, (dy / 100) * 90 / 127);
    };
    for (const measure of kids(part, "measure")) {
      const mStart = pos;
      let mMax = pos;
      for (const el of measure.children) {
        if (el.name === "attributes") {
          const d = Number(childText(el, "divisions")); if (d > 0) divisions = d;
          const tr = child(el, "transpose");
          if (tr) transpose = (Number(childText(tr, "chromatic")) || 0) + 12 * (Number(childText(tr, "octave-change")) || 0);
        } else if (el.name === "direction") {
          for (const dt of kids(el, "direction-type")) {
            const dyn = child(dt, "dynamics");
            if (dyn) for (const k of dyn.children) if (DYN[k.name] !== undefined) vel = DYN[k.name];
            const met = child(dt, "metronome");
            const pm = Number(childText(met, "per-minute"));
            if (met && pm > 0 && !child(el, "sound")?.attrs.tempo) {
              const unit = childText(met, "beat-unit") ?? "quarter";
              const f = ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 } as Record<string, number>)[unit] ?? 1;
              setTempo(pm * f * (child(met, "beat-unit-dot") ? 1.5 : 1));
            }
          }
          sound(child(el, "sound"));
        } else if (el.name === "sound") sound(el);
        else if (el.name === "backup") pos -= ticks(Number(childText(el, "duration")) || 0);
        else if (el.name === "forward") pos += ticks(Number(childText(el, "duration")) || 0);
        else if (el.name === "barline") { if (child(el, "repeat")) repeats = true; }
        else if (el.name === "note") {
          if (child(el, "grace")) continue;
          const isChord = !!child(el, "chord");
          const start = isChord ? lastStart : pos;
          const len = ticks(Number(childText(el, "duration")) || 0);
          if (!isChord) { lastStart = pos; pos += len; }
          const pitch = child(el, "pitch");
          if (child(el, "rest") || child(el, "cue")) { mMax = Math.max(mMax, pos); continue; }
          if (!pitch) { if (child(el, "unpitched")) unpitched++; mMax = Math.max(mMax, pos); continue; }
          const stepName = (childText(pitch, "step") ?? "C").toUpperCase();
          const key = (Number(childText(pitch, "octave")) + 1) * 12 + (STEP_SEMI[stepName] ?? 0) + Math.round(Number(childText(pitch, "alter")) || 0) + transpose;
          if (!Number.isFinite(key) || key < 0 || key > 127) continue;
          const nd = Number(el.attrs.dynamics);
          const v = Number.isFinite(nd) && nd > 0 ? Math.min(1, (nd / 100) * 90 / 127) : vel;
          const tieTypes = [...kids(el, "tie"), ...kids(child(el, "notations"), "tied")].map((t) => t.attrs.type);
          const tieStop = tieTypes.includes("stop"), tieStart = tieTypes.includes("start");
          const prev = openTies.get(key);
          if (tieStop && prev !== undefined && Math.abs(notes[prev].end - start) < 1e-6 * spb + 0.5) {
            notes[prev].end = start + len;
            if (!tieStart) openTies.delete(key);
          } else {
            notes.push({ key, start, end: start + len, vel: v });
            if (tieStart) openTies.set(key, notes.length - 1); else openTies.delete(key);
          }
          mMax = Math.max(mMax, pos, start + len);
        }
        mMax = Math.max(mMax, pos);
      }
      pos = Math.max(mMax, mStart);
    }
    lastStep = Math.max(lastStep, Math.round(pos)); // trailing rests count
    const out: ClipNote[] = notes.sort((a, b) => a.start - b.start || a.key - b.key).map((n) => {
      const s = Math.round(n.start), l = Math.max(1, Math.round(n.end) - s);
      lastStep = Math.max(lastStep, s + l);
      return { step: s, ...(l !== 1 ? { len: l } : {}), pitch: n.key, vel: round2(n.vel) };
    });
    if (!out.length) return;
    const byName = instrumentByName(`${pinfo.instrument ?? ""} ${pinfo.name}`);
    const choice: InstrumentChoice = pinfo.program !== undefined && pinfo.channel !== 10 ? gmInstrument(pinfo.program) : byName && byName !== "drums" ? byName : { instrument: "sampler", sampler: "piano" };
    const label = pinfo.name || pinfo.instrument || `Part ${pi + 1}`;
    let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `part${pi + 1}`;
    if (used.has(id)) { let k = 2; while (used.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
    used.add(id);
    tracks.push({ id, name: label, ...choice, notes: out, volume: 0.7 } as ClipTrack);
  });
  if (!tracks.length) throw new MusicXmlError("The score has no pitched notes.");
  if (repeats) warnings.push("Repeats are played once, as written (they are not expanded).");
  if (unpitched) warnings.push(`${unpitched} unpitched percussion note${unpitched > 1 ? "s were" : " was"} skipped.`);
  const changes = [...tempos.entries()].sort((a, b) => a[0] - b[0]);
  const first = changes.length && changes[0][0] === 0 ? changes[0][1] : changes.length ? changes[0][1] : 120;
  const tempo = Math.min(240, Math.max(40, Math.round(first * 1000) / 1000));
  const map: TempoChange[] = [];
  for (const [s, t] of changes) {
    const prev = map.length ? map[map.length - 1].tempo : first;
    if (s === 0 || (map.length === 0 && t === first)) { if (t !== tempo) map.push({ step: 0, tempo: Math.min(1000, Math.max(10, t)) }); continue; }
    if (t !== prev) map.push({ step: s, tempo: Math.min(1000, Math.max(10, t)) });
  }
  const clip: AudioClip = { format: AUDIO_CLIP_FORMAT, name: opts.name || title || "MusicXML import", tempo, ...(map.length ? { tempoMap: map } : {}), stepsPerBeat: spb, steps: Math.max(1, lastStep), master: { reverb: 0.25, reverbType: "hall" }, tracks };
  const sec = stepTime(clip, clip.steps!);
  if (sec > MAX_DURATION) { warnings.push(`The piece is ${Math.round(sec)} s long; only the first ${MAX_DURATION} s are kept.`); clip.duration = MAX_DURATION; }
  return { clip, warnings };
}
