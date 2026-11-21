import { describe, expect, it } from "vitest";
import { clearSampleCache, clipSamplesReady, crossfadeLoop, loadClipSamples, neededZones, onsetOffset, samplerNote, samplesBaseUrl, setSampleBufferFactory, type SampleLoader } from "./sampler";
import { impulseSamples, IR_SPECS } from "./reverb";
import { tailSec } from "./audioClip";
import { AUDIO_TEMPLATES, type AudioClip } from "../domain/audioClip";
import { SAMPLER_PACK_FORMAT, type SamplerManifest } from "../domain/samplerPacks";

/** A minimal AudioBuffer stand-in (jsdom and node have none). */
function fakeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return { sampleRate, length: channels[0].length, numberOfChannels: channels.length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] } as unknown as AudioBuffer;
}
const SR = 1000;
const MANIFEST: SamplerManifest = {
  format: SAMPLER_PACK_FORMAT, id: "strings", name: "Strings", kind: "sustain", attack: 0.01, release: 0.5, gain: 0.5,
  zones: [
    { file: "s_C3_p.mp3", root: 48, lo: 36, hi: 53, velLo: 1, velHi: 80, loopStart: 1, loopEnd: 2 },
    { file: "s_C3_f.mp3", root: 48, lo: 36, hi: 53, velLo: 81, velHi: 127, loopStart: 1, loopEnd: 2 },
    { file: "s_G3_p.mp3", root: 55, lo: 54, hi: 86, velLo: 1, velHi: 80 },
  ],
};
function loader(log: string[], fail?: string): SampleLoader {
  return {
    base: "https://app.test/samples/",
    fetch: async (url) => {
      log.push(url);
      if (fail && url.endsWith(fail)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, json: async () => MANIFEST, arrayBuffer: async () => new TextEncoder().encode(url).buffer as ArrayBuffer };
    },
    // 20 ms of silence (decoder padding), then a 3 s ramp.
    decode: async (_d, sr) => fakeBuffer([Float32Array.from({ length: 3 * sr + 20 }, (_, i) => (i < 20 ? 0 : 0.1 + (i % 7) / 10))], sr),
  };
}
const clip = (notes: { step: number; pitch: string; vel?: number }[], mute = false): AudioClip => ({ format: "dionysus.audioclip/1", name: "x", tempo: 120, tracks: [{ id: "s", instrument: "sampler", sampler: "strings", notes, ...(mute ? { mute } : {}) }] });

describe("sampler engine (P91)", () => {
  it("skips leading silence and bakes a click-free loop crossfade", () => {
    expect(onsetOffset(Float32Array.from([0, 0, 0, 0, 0.5, 1]), 1000)).toBe(0.002);
    expect(onsetOffset(new Float32Array(10), 1000)).toBe(0);
    const src = Float32Array.from({ length: 100 }, (_, i) => i);
    const out = crossfadeLoop(src, 40, 80, 10);
    expect(out.length).toBe(80);
    expect(out[69]).toBe(69); // untouched before the fade
    // At the loop end the signal has faded into what precedes the loop start, so the jump 79 → 40 is continuous.
    expect(out[79]).toBeCloseTo(src[39], 6);
    expect(Math.abs(out[70] - src[70])).toBeLessThan(5); // the fade starts gently
  });

  it("loads only the recordings a clip needs, once, and reports readiness", async () => {
    clearSampleCache();
    setSampleBufferFactory((ch, len, sr) => fakeBuffer(Array.from({ length: ch }, () => new Float32Array(len)), sr));
    const log: string[] = [];
    const c = clip([{ step: 0, pitch: "C3", vel: 0.5 }, { step: 4, pitch: "D3", vel: 0.4 }, { step: 8, pitch: "A3", vel: 0.3 }]);
    expect(clipSamplesReady(c, SR, "https://app.test/samples/")).toBe(false);
    const bank = await loadClipSamples(c, SR, loader(log));
    expect(log).toEqual(["https://app.test/samples/strings/manifest.json", "https://app.test/samples/strings/s_C3_p.mp3", "https://app.test/samples/strings/s_G3_p.mp3"]);
    const pack = bank.get("strings")!;
    expect([...pack.zones.keys()].sort()).toEqual([0, 2]);
    const z0 = pack.zones.get(0)!;
    expect(z0.offset).toBeCloseTo(0.018, 6);
    expect(z0.loop![0]).toBeCloseTo(1.018, 6);
    expect(z0.loop![1]).toBeCloseTo(2.018, 6);
    expect(pack.zones.get(2)!.loop).toBeUndefined(); // no loop points: plays out
    expect(clipSamplesReady(c, SR, "https://app.test/samples/")).toBe(true);
    // Cached: a second load fetches nothing; a louder note needs the other layer.
    await loadClipSamples(c, SR, loader(log));
    expect(log.length).toBe(3);
    await loadClipSamples(clip([{ step: 0, pitch: "C3", vel: 1 }]), SR, loader(log));
    expect(log.slice(3)).toEqual(["https://app.test/samples/strings/s_C3_f.mp3"]);
    // Muted tracks load nothing.
    expect((await loadClipSamples(clip([{ step: 0, pitch: "C3" }], true), SR, loader(log))).size).toBe(0);
    expect(neededZones(c, () => MANIFEST).get("strings")).toEqual(new Set([0, 2]));
  });

  it("names the instrument when a recording can't be loaded", async () => {
    clearSampleCache();
    await expect(loadClipSamples(clip([{ step: 0, pitch: "C3", vel: 0.5 }]), SR, loader([], "s_C3_p.mp3"))).rejects.toThrow(/"Strings" instrument \(s_C3_p.mp3: HTTP 404\)/);
    clearSampleCache();
    await expect(loadClipSamples(clip([{ step: 0, pitch: "C3" }]), SR, loader([], "manifest.json"))).rejects.toThrow(/"Strings" instrument \(HTTP 404\)/);
  });

  it("plays a note: nearest recording, pitch shift, loop and envelope", async () => {
    clearSampleCache();
    setSampleBufferFactory((ch, len, sr) => fakeBuffer(Array.from({ length: ch }, () => new Float32Array(len)), sr));
    const c = clip([{ step: 0, pitch: "D3", vel: 0.5 }]);
    const bank = await loadClipSamples(c, SR, loader([]));
    const calls: string[] = [];
    const param = (name: string) => ({ value: 0, setValueAtTime: (v: number, t: number) => calls.push(`${name}.set(${v.toFixed(3)},${t})`), linearRampToValueAtTime: (v: number, t: number) => calls.push(`${name}.ramp(${v.toFixed(3)},${t})`), setTargetAtTime: (v: number, t: number, k: number) => calls.push(`${name}.target(${v},${t},${k})`) });
    const node = () => ({ connect: (n: unknown) => n });
    const src = { ...node(), buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param("rate"), start: (t: number, o: number) => calls.push(`start(${t},${o.toFixed(3)})`), stop: (t: number) => calls.push(`stop(${t.toFixed(2)})`) };
    const ctx = { createBufferSource: () => src, createGain: () => ({ ...node(), gain: param("gain") }), createBiquadFilter: () => ({ ...node(), type: "", frequency: param("f"), Q: param("q") }) } as unknown as BaseAudioContext;
    samplerNote(ctx, {} as AudioNode, c.tracks[0], bank, 1, 2, 50, 0.5);
    expect(src.playbackRate.value).toBeCloseTo(Math.pow(2, 2 / 12), 9);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(1.018, 6);
    expect(calls).toContain("start(1,0.018)");
    expect(calls).toContain("stop(3.76)"); // off at 3 s + release 0.5 × 1.5 + 10 ms
    expect(calls.some((x) => x.startsWith("gain.ramp("))).toBe(true);
  });

  it("builds the samples URL from the app base", () => {
    expect(samplesBaseUrl("/dionysus/", "https://h.test/dionysus/index.html")).toBe("https://h.test/dionysus/samples/");
    expect(samplesBaseUrl("./", "https://h.test/a/b/")).toBe("https://h.test/a/b/samples/");
  });
});

describe("reverb spaces (P91)", () => {
  it("impulse responses are deterministic, stereo-decorrelated, energy-normalised and decay", () => {
    for (const type of ["room", "hall", "church", "plate"] as const) {
      const [l, r] = impulseSamples(type, 8000);
      const [l2] = impulseSamples(type, 8000);
      expect(l.length).toBe(Math.round(IR_SPECS[type].length * 8000));
      expect(Array.from(l.subarray(0, 500))).toEqual(Array.from(l2.subarray(0, 500)));
      let el = 0, er = 0, cross = 0;
      for (let i = 0; i < l.length; i++) { el += l[i] * l[i]; er += r[i] * r[i]; cross += l[i] * r[i]; }
      expect(el).toBeCloseTo(0.14, 6);
      expect(er).toBeCloseTo(0.14, 6);
      expect(Math.abs(cross / Math.sqrt(el * er))).toBeLessThan(0.5);
      const q = Math.floor(l.length / 4);
      const energy = (a: number, b: number) => { let e = 0; for (let i = a; i < b; i++) e += l[i] * l[i]; return e; };
      expect(energy(0, q)).toBeGreaterThan(energy(3 * q, 4 * q) * 10);
      expect(l[l.length - 1]).toBe(0);
    }
  });

  it("render tails: old clips keep the original rule; spaces and recorded instruments extend it", () => {
    for (const t of AUDIO_TEMPLATES.filter((x) => x.id !== "film-cue-dminor")) expect(tailSec(t.clip)).toBe(t.clip.tracks.some((x) => x.fx?.reverb || x.fx?.delay) ? 1.5 : 0.1);
    expect(tailSec(AUDIO_TEMPLATES.find((x) => x.id === "film-cue-dminor")!.clip)).toBe(IR_SPECS.hall.length);
    const c = clip([{ step: 0, pitch: "C3" }]);
    expect(tailSec(c)).toBe(1.5);
    expect(tailSec({ ...c, tracks: [{ ...c.tracks[0], instrument: "piano", fx: { reverb: 0.3, reverbType: "church" } }] })).toBe(IR_SPECS.church.length);
  });
});
