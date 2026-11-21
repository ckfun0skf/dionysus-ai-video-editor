import { describe, expect, it } from "vitest";
import { AUDIO_TEMPLATES, clipDuration, isFineGrid, paramSpecs, parseAudioClip, stepTime, stringifyAudioClip, type AudioClip } from "./audioClip";
import { AUDIO_CLIP_REFERENCE, audioClipPrompt } from "./audioClipPrompt";
import { SAMPLER_IDS, SAMPLER_PACKS } from "./samplerPacks";

const P91_TEMPLATES = ["film-cue-dminor"];
const base = (tracks: unknown[], extra: Record<string, unknown> = {}) => ({ format: "dionysus.audioclip/1", name: "T", tempo: 120, tracks, ...extra });

describe("audioclip P91: sampled instruments, reverb spaces, timing", () => {
  it("old clips are unchanged: templates round-trip exactly and use none of the new fields", () => {
    for (const t of AUDIO_TEMPLATES.filter((x) => !P91_TEMPLATES.includes(x.id))) {
      const r = parseAudioClip(stringifyAudioClip(t.clip));
      expect(r.ok, t.id).toBe(true);
      if (!r.ok) continue;
      expect(r.issues, t.id).toEqual([]);
      expect(r.clip, t.id).toEqual(t.clip);
      expect(r.clip.tempoMap, t.id).toBeUndefined();
      expect(r.clip.master, t.id).toBeUndefined();
      // Without a tempo map, step times are the original step * stepSec (bit-identical).
      expect(stepTime(r.clip, 7)).toBe(7 * (60 / r.clip.tempo / (r.clip.stepsPerBeat ?? 4)));
    }
  });

  it("the film cue template uses recorded instruments and a hall", () => {
    const t = AUDIO_TEMPLATES.find((x) => x.id === "film-cue-dminor")!;
    const r = parseAudioClip(stringifyAudioClip(t.clip));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    expect(r.clip.master).toEqual({ reverb: 0.35, reverbType: "hall" });
    expect(r.clip.tracks.map((x) => x.sampler)).toEqual(["strings", "cello", "piano"]);
    expect(isFineGrid(r.clip)).toBe(false);
  });

  it("validates sampler tracks", () => {
    const ok = parseAudioClip(base([{ id: "s", instrument: "sampler", sampler: "strings", notes: [{ step: 0, len: 8, pitch: "D3" }], params: { attack: 0.5, tone: 0.7 } }]));
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.clip.tracks[0]).toMatchObject({ instrument: "sampler", sampler: "strings", params: { attack: 0.5, tone: 0.7 } }); expect(ok.issues).toEqual([]); }
    const bad = parseAudioClip(base([{ id: "s", instrument: "sampler", sampler: "theremin", notes: [] }]));
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.path)).toContain("tracks[0].sampler");
    const stray = parseAudioClip(base([{ id: "p", instrument: "piano", sampler: "strings", notes: [] }]));
    expect(stray.ok).toBe(true);
    if (stray.ok) { expect(stray.clip.tracks[0].sampler).toBeUndefined(); expect(stray.issues[0].level).toBe("warning"); }
    expect(paramSpecs({ instrument: "sampler" }).map((p) => p.key)).toEqual(["attack", "release", "tone"]);
    expect(SAMPLER_IDS).toEqual(SAMPLER_PACKS.map((p) => p.id));
  });

  it("validates reverb spaces and the shared master reverb", () => {
    const r = parseAudioClip(base([{ id: "p", instrument: "piano", notes: [], fx: { reverb: 0.4, reverbType: "church" } }], { master: { reverb: 0.3, reverbType: "plate" } }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.clip.tracks[0].fx).toEqual({ reverb: 0.4, reverbType: "church" }); expect(r.clip.master).toEqual({ reverb: 0.3, reverbType: "plate" }); expect(r.issues).toEqual([]); }
    expect(parseAudioClip(base([{ id: "p", instrument: "piano", notes: [], fx: { reverb: 0.4, reverbType: "cave" } }])).ok).toBe(false);
    expect(parseAudioClip(base([{ id: "p", instrument: "piano", notes: [] }], { master: { reverbType: "cave" } })).ok).toBe(false);
    const w = parseAudioClip(base([{ id: "p", instrument: "piano", notes: [] }], { master: { reverb: 2, size: 1 } }));
    expect(w.ok).toBe(true);
    if (w.ok) { expect(w.clip.master).toEqual({ reverb: 1 }); expect(w.issues.map((i) => i.path)).toEqual(["master.reverb", "master.size"]); }
  });

  it("allows MIDI resolution and a tempo map", () => {
    const r = parseAudioClip(base([{ id: "p", instrument: "piano", notes: [{ step: 960, len: 1920, pitch: 60 }] }], { stepsPerBeat: 480, steps: 3840, tempoMap: [{ step: 1920, tempo: 60 }, { step: 960, tempo: 90 }, { step: 1920, tempo: 30 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    const c = r.clip;
    expect(c.stepsPerBeat).toBe(480);
    expect(c.tempoMap).toEqual([{ step: 960, tempo: 90 }, { step: 1920, tempo: 30 }]); // sorted; the later duplicate wins
    expect(c.tracks[0].notes![0].len).toBe(1920);
    // 2 beats at 120 (1 s) + 2 beats at 90 (1.333 s) + 4 beats at 30 (8 s).
    expect(stepTime(c, 960)).toBeCloseTo(1, 9);
    expect(stepTime(c, 1920)).toBeCloseTo(1 + 4 / 3, 9);
    expect(clipDuration(c)).toBeCloseTo(1 + 4 / 3 + 8, 9);
    expect(isFineGrid(c)).toBe(true);
    expect(parseAudioClip(base([], { tempoMap: [{ step: 0 }] })).issues.some((i) => i.path === "tempoMap[0]")).toBe(true);
  });

  it("a step-0 tempo map entry replaces the clip tempo", () => {
    const c: AudioClip = { format: "dionysus.audioclip/1", name: "x", tempo: 240, stepsPerBeat: 96, tempoMap: [{ step: 0, tempo: 300 }], tracks: [] };
    expect(stepTime(c, 96)).toBeCloseTo(0.2, 9);
  });

  it("the AI reference lists the packs, reverb spaces and timing fields", () => {
    for (const p of SAMPLER_PACKS) expect(AUDIO_CLIP_REFERENCE).toContain(`"${p.id}"`);
    for (const x of ['"sampler"', '"reverbType"', '"master"', '"tempoMap"', "1–960", "church", "VSCO-2-CE"]) expect(AUDIO_CLIP_REFERENCE).toContain(x);
    expect(audioClipPrompt({ name: "Cue", brief: "sad strings", specUrl: "https://x.test/a.md" })).toContain("Film cue (D minor)");
  });
});
