/**
 * Audio effects (P3B-11): turns an `audioFx` registry preset (data only, see presets/define.ts AudioFxData) and an
 * amount 0–1 into a Web Audio node chain. The same builder runs on the preview AudioContext (Player) and on the
 * export OfflineAudioContext (export/encode.ts mixAudio), so what you hear while editing is what gets exported.
 * The reverb impulse is generated from a fixed seed, never Math.random, so every render is identical.
 */
import type { AudioFxData } from "../registry";
import { getPreset } from "../registry";

export interface FxChain { input: AudioNode; output: AudioNode; dispose(): void }

/** The chain description of a preset id (`id@N` accepted); undefined for unknown ids. */
export function audioFxData(id: string | undefined): AudioFxData | undefined {
  return getPreset("audioFx", id?.split("@")[0])?.data as AudioFxData | undefined;
}

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stereo reverb impulse samples: decaying seeded noise, `(1 - t/len)^decay`. Pure, for tests and both contexts. */
export function impulseSamples(sampleRate: number, seconds: number, decay: number): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  out.forEach((ch, c) => { const rnd = seeded(0x5eed + c); for (let i = 0; i < n; i++) ch[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, decay); });
  return out;
}

/** Soft-clip curve for `drive` 0–1 (0 = straight line). */
export function driveCurve(drive: number, size = 1024): Float32Array {
  const k = drive * 40, c = new Float32Array(size);
  for (let i = 0; i < size; i++) { const x = (i / (size - 1)) * 2 - 1; c[i] = k ? ((1 + k) * x) / (1 + k * Math.abs(x)) : x; }
  return c;
}

/** Filter cutoff at `amount`: log-interpolated from fully open (`open` Hz) to the preset's cutoff. */
export const cutoffAt = (open: number, target: number, amount: number) => open * Math.pow(target / open, Math.max(0, Math.min(1, amount)));

/**
 * The resolved settings at `amount` (exported for tests): what each node is set to. Mixes scale linearly with amount;
 * filters glide from open; makeup glides from 1.
 */
export function fxSettings(d: AudioFxData, amount: number) {
  const a = Math.max(0, Math.min(1, amount));
  return {
    highpass: d.highpass !== undefined ? cutoffAt(20, d.highpass, a) : undefined,
    lowpass: d.lowpass !== undefined ? cutoffAt(20000, d.lowpass, a) : undefined,
    peak: d.peak ? { freq: d.peak.freq, gainDb: d.peak.gainDb * a, q: d.peak.q ?? 1 } : undefined,
    drive: d.drive !== undefined ? d.drive * a : undefined,
    ringMod: d.ringMod ? { freq: d.ringMod.freq, mix: d.ringMod.mix * a } : undefined,
    echo: d.echo ? { time: d.echo.time, feedback: d.echo.feedback, mix: d.echo.mix * a } : undefined,
    reverb: d.reverb ? { ...d.reverb, mix: d.reverb.mix * a, preDelay: d.reverb.preDelay ?? 0 } : undefined,
    makeup: 1 + ((d.makeup ?? 1) - 1) * a,
  };
}

/** Build the chain for preset data at `amount` on any (offline or live) context. Oscillators start at `startAt`. */
export function buildFxChain(ctx: BaseAudioContext, d: AudioFxData, amount: number, startAt = 0): FxChain {
  const s = fxSettings(d, amount);
  const nodes: AudioNode[] = [];
  const oscs: OscillatorNode[] = [];
  const mk = <N extends AudioNode>(n: N) => { nodes.push(n); return n; };
  const input = mk(ctx.createGain());
  let cur: AudioNode = input;
  const biquad = (type: BiquadFilterType, freq: number, q?: number, gain?: number) => {
    const f = mk(ctx.createBiquadFilter()); f.type = type; f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q; if (gain !== undefined) f.gain.value = gain;
    cur.connect(f); cur = f;
  };
  if (s.highpass !== undefined) biquad("highpass", s.highpass, 0.707);
  if (s.lowpass !== undefined) biquad("lowpass", s.lowpass, 0.707);
  if (s.peak && s.peak.gainDb) biquad("peaking", s.peak.freq, s.peak.q, s.peak.gainDb);
  if (s.drive) { const w = mk(ctx.createWaveShaper()); w.curve = driveCurve(s.drive); cur.connect(w); cur = w; }
  /** dry + wet·mix into a new sum node; `wet` receives `cur`. */
  const parallel = (mix: number, wet: (from: AudioNode) => AudioNode, dryLevel = 1) => {
    const sum = mk(ctx.createGain());
    const dry = mk(ctx.createGain()); dry.gain.value = dryLevel; cur.connect(dry).connect(sum);
    const w = mk(ctx.createGain()); w.gain.value = mix; wet(cur).connect(w).connect(sum);
    cur = sum;
  };
  if (s.ringMod && s.ringMod.mix) {
    const m = s.ringMod.mix;
    parallel(m, (from) => {
      const ring = mk(ctx.createGain()); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = s.ringMod!.freq; osc.connect(ring.gain); osc.start(startAt); oscs.push(osc);
      from.connect(ring); return ring;
    }, 1 - m);
  }
  if (s.echo && s.echo.mix) {
    parallel(s.echo.mix, (from) => {
      const delay = mk(ctx.createDelay(2)); delay.delayTime.value = s.echo!.time;
      const fb = mk(ctx.createGain()); fb.gain.value = s.echo!.feedback;
      from.connect(delay); delay.connect(fb).connect(delay); return delay;
    });
  }
  if (s.reverb && s.reverb.mix) {
    const r = s.reverb;
    parallel(r.mix, (from) => {
      const conv = mk(ctx.createConvolver());
      const [l, rr] = impulseSamples(ctx.sampleRate, r.seconds, r.decay);
      const buf = ctx.createBuffer(2, l.length, ctx.sampleRate); buf.copyToChannel(l, 0); buf.copyToChannel(rr, 1);
      conv.buffer = buf;
      if (r.preDelay) { const pd = mk(ctx.createDelay(1)); pd.delayTime.value = r.preDelay; from.connect(pd).connect(conv); } else from.connect(conv);
      return conv;
    }, 1 - r.mix * 0.4);
  }
  const output = mk(ctx.createGain()); output.gain.value = s.makeup; cur.connect(output);
  return {
    input, output,
    dispose() { for (const o of oscs) { try { o.stop(); } catch { /* not started */ } o.disconnect(); } for (const n of nodes) n.disconnect(); },
  };
}

/** A clip's effect key (preset + amount) — the preview rebuilds its chain only when this changes. */
export const fxKey = (fx: { preset: string; amount: number } | undefined) => (fx && audioFxData(fx.preset) && fx.amount > 0 ? `${fx.preset}:${fx.amount}` : "");
