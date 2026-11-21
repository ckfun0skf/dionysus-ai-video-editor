import { describe, expect, it } from "vitest";
import { gmDrum, gmInstrument, MidiError, midiToAudioClip, parseMidi } from "./midiImport";
import { parseAudioClip, stepTime } from "./audioClip";

/** Hand-built Standard MIDI File bytes. */
const vlq = (n: number) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A track from [delta, ...bytes] events (end-of-track appended). */
const trk = (events: number[][]) => { const body = [...events.flatMap(([d, ...b]) => [...vlq(d), ...b]), 0, 0xff, 0x2f, 0]; return [...text("MTrk"), ...u32(body.length), ...body]; };
const smf = (format: number, tpq: number, tracks: number[][]) => new Uint8Array([...text("MThd"), ...u32(6), 0, format, 0, tracks.length, (tpq >> 8) & 0xff, tpq & 0xff, ...tracks.flat()]);
const name = (s: string) => [0xff, 0x03, s.length, ...text(s)];
const tempo = (us: number) => [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];

const song = smf(1, 480, [
  trk([[0, ...name("Song")], [0, ...tempo(500000)], [1920, ...tempo(1000000)]]),
  trk([
    [0, ...name("Keys")], [0, 0xc0, 0], [0, 0xb0, 7, 127],
    [0, 0x90, 60, 100], [0, 64, 80], // running status: E4 without a status byte
    [480, 0x90, 60, 0], // note-on velocity 0 = note-off
    [480, 0x80, 64, 0],
    [0, 0xb0, 64, 127], [0, 0x90, 67, 90], [240, 0x80, 67, 0], [240, 0xb0, 64, 0], // released at 1200, pedal up at 1440
    [0, 0xf0, 2, 0x7e, 0xf7], // a sysex in between is skipped
  ]),
  trk([[0, 0x99, 36, 110], [240, 0x89, 36, 0], [240, 0x99, 38, 100], [240, 0x89, 38, 0], [0, 0x99, 81, 60], [10, 0x89, 81, 0]]),
]);

describe("MIDI import (P91)", () => {
  it("parses tracks, running status, note-on velocity 0 and tempo", () => {
    const m = parseMidi(song);
    expect(m.format).toBe(1);
    expect(m.ticksPerQuarter).toBe(480);
    expect(m.tracks.length).toBe(3);
    const notes = m.tracks[1].events.filter((e) => e.type === "note");
    expect(notes.map((e) => e.type === "note" && [e.tick, e.key, e.on])).toEqual([[0, 60, true], [0, 64, true], [480, 60, false], [960, 64, false], [960, 67, true], [1200, 67, false]]);
    expect(m.tracks[0].events.filter((e) => e.type === "tempo").map((e) => e.type === "tempo" && [e.tick, e.microsPerQuarter])).toEqual([[0, 500000], [1920, 1000000]]);
  });

  it("turns a file into a clip with exact timing, a tempo map, sustain pedal and drums", () => {
    const { clip, warnings } = midiToAudioClip(parseMidi(song));
    expect(clip.name).toBe("Song");
    expect(clip.tempo).toBe(120);
    expect(clip.stepsPerBeat).toBe(480);
    expect(clip.tempoMap).toEqual([{ step: 1920, tempo: 60 }]);
    const keys = clip.tracks.find((t) => t.id === "keys")!;
    expect(keys).toMatchObject({ instrument: "sampler", sampler: "piano", name: "Keys", volume: 0.85 });
    expect(keys.notes).toEqual([
      { step: 0, len: 480, pitch: 60, vel: 0.79 },
      { step: 0, len: 960, pitch: 64, vel: 0.63 },
      { step: 960, len: 480, pitch: 67, vel: 0.71 }, // held by the pedal from 1200 to 1440
    ]);
    const drums = clip.tracks.find((t) => t.instrument === "drums")!;
    expect(drums.notes!.map((n) => [n.step, n.pitch])).toEqual([[0, "kick"], [480, "snare"]]);
    expect(warnings.join(" ")).toContain("1 drum hit");
    // Tempo map: 120 BPM for 4 beats (2 s), then 60 BPM.
    expect(stepTime(clip, 1920)).toBeCloseTo(2, 9);
    expect(stepTime(clip, 2400)).toBeCloseTo(3, 9);
    // The result is a valid clip.
    const r = parseAudioClip(clip);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    if (r.ok) expect(r.issues).toEqual([]);
  });

  it("keeps a first tempo outside 40–240 BPM exact through the tempo map", () => {
    const fast = smf(0, 96, [trk([[0, ...tempo(200000)], [0, 0x90, 60, 64], [96, 0x80, 60, 0]])]); // 300 BPM
    const { clip } = midiToAudioClip(parseMidi(fast), { name: "Fast" });
    expect(clip.tempo).toBe(240);
    expect(clip.tempoMap).toEqual([{ step: 0, tempo: 300 }]);
    expect(stepTime(clip, 96)).toBeCloseTo(0.2, 9);
    expect(clip.name).toBe("Fast");
  });

  it("divides very fine resolutions down to 960 steps per beat", () => {
    const fine = smf(0, 1920, [trk([[0, 0x90, 60, 64], [1920, 0x80, 60, 0]])]);
    const { clip } = midiToAudioClip(parseMidi(fine));
    expect(clip.stepsPerBeat).toBe(960);
    expect(clip.tracks[0].notes).toEqual([{ step: 0, len: 960, pitch: 60, vel: 0.5 }]);
  });

  it("rejects files that are not MIDI or have no notes", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow(MidiError);
    expect(() => midiToAudioClip(parseMidi(smf(0, 96, [trk([[0, ...tempo(500000)]])])))).toThrow(/no notes/);
  });

  it("maps GM programs and drum keys to the closest built-in instruments", () => {
    expect(gmInstrument(0)).toEqual({ instrument: "sampler", sampler: "piano" });
    expect(gmInstrument(42)).toEqual({ instrument: "sampler", sampler: "cello" });
    expect(gmInstrument(48)).toEqual({ instrument: "sampler", sampler: "strings" });
    expect(gmInstrument(60)).toEqual({ instrument: "sampler", sampler: "horn" });
    expect(gmInstrument(73)).toEqual({ instrument: "sampler", sampler: "flute" });
    expect(gmInstrument(47)).toEqual({ instrument: "sampler", sampler: "timpani" });
    expect(gmInstrument(33)).toEqual({ instrument: "bass" });
    expect(gmInstrument(81)).toEqual({ instrument: "lead" });
    expect(gmDrum(36)).toBe("kick");
    expect(gmDrum(42)).toBe("hat");
    expect(gmDrum(81)).toBeUndefined();
  });
});
