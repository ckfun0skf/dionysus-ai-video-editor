/**
 * P91: synthetic convolution reverb spaces for `fx.reverbType` and `master.reverbType` (docs/v2/AUDIO_CLIP_FORMAT.md).
 * Each impulse response is generated deterministically (fixed seed per type): a pre-delay, an early-reflection
 * pattern, then a decorrelated stereo tail whose low, mid and high bands decay at their own rates (highs die first, as
 * air and walls absorb them). No files are downloaded; the IR is built once per type and sample rate and cached.
 */
import type { ReverbType } from "../domain/audioClip";

export interface IrSpec {
  /** Seconds of IR. */
  length: number;
  /** Seconds before the first reflection. */
  predelay: number;
  /** RT60 in seconds for the low (< 400 Hz), mid and high (> 3.5 kHz) bands. */
  rt60: [number, number, number];
  /** Early reflections: how many, over how many seconds after the pre-delay, and their level against the tail. */
  early: { count: number; span: number; level: number };
  /** Seconds for the tail to build up to full density. */
  buildup: number;
  seed: number;
}

export const IR_SPECS: Record<ReverbType, IrSpec> = {
  room: { length: 1.1, predelay: 0.004, rt60: [0.7, 0.55, 0.35], early: { count: 16, span: 0.04, level: 0.8 }, buildup: 0.02, seed: 101 },
  hall: { length: 3.4, predelay: 0.022, rt60: [2.8, 2.2, 1.3], early: { count: 20, span: 0.09, level: 0.45 }, buildup: 0.07, seed: 202 },
  church: { length: 5.8, predelay: 0.035, rt60: [5.0, 4.0, 2.2], early: { count: 24, span: 0.15, level: 0.35 }, buildup: 0.12, seed: 303 },
  plate: { length: 2.8, predelay: 0.001, rt60: [2.1, 2.1, 1.7], early: { count: 0, span: 0, level: 0 }, buildup: 0.008, seed: 404 },
};

/** Energy of each IR channel. The original noise impulse through a normalising ConvolverNode lands near this, so a
 *  typed reverb at the same `reverb` amount is about as loud as the classic one. */
const IR_ENERGY = 0.14;

/** mulberry32 (the same generator as render/audioClip's rng; kept local to avoid an import cycle). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole low-pass coefficient for a cutoff. */
const onePole = (hz: number, sr: number) => 1 - Math.exp((-2 * Math.PI * hz) / sr);

/** The stereo impulse response of a space, as raw samples (pure; used by impulseBuffer and the tests). */
export function impulseSamples(type: ReverbType, sampleRate: number): [Float32Array, Float32Array] {
  const s = IR_SPECS[type];
  const n = Math.max(1, Math.round(s.length * sampleRate));
  const pre = Math.round(s.predelay * sampleRate);
  const aLow = onePole(400, sampleRate), aHigh = onePole(3500, sampleRate);
  // Amplitude decay per sample for each band: 60 dB over rt60 seconds.
  const k = s.rt60.map((rt) => Math.exp(-6.907755 / (rt * sampleRate)));
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const rand = prng(s.seed * 2 + ch);
    const d = out[ch];
    let lp1 = 0, lp2 = 0;
    const env = [1, 1, 1];
    for (let i = pre; i < n; i++) {
      const w = rand() * 2 - 1;
      lp1 += aLow * (w - lp1);
      lp2 += aHigh * (w - lp2);
      const low = lp1, mid = lp2 - lp1, high = w - lp2;
      const tail = low * env[0] + mid * env[1] + high * env[2];
      env[0] *= k[0]; env[1] *= k[1]; env[2] *= k[2];
      const t = (i - pre) / sampleRate;
      const build = s.buildup > 0 ? Math.min(1, t / s.buildup) : 1;
      d[i] = tail * build * build;
    }
    // Early reflections: sparse, decaying, different on each side, each slightly smeared (a 3-tap kernel).
    if (s.early.count > 0) {
      for (let r = 0; r < s.early.count; r++) {
        const at = pre + Math.round(Math.pow(rand(), 1.4) * s.early.span * sampleRate);
        const amp = s.early.level * 8 * (1 - (at - pre) / Math.max(1, s.early.span * sampleRate) * 0.6) * (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5);
        for (const [o, g] of [[0, 1], [1, 0.5], [2, 0.25]] as const) if (at + o < n) d[at + o] += amp * g;
      }
    }
    // Fade out the last 8% so the IR ends at silence.
    const fade = Math.max(1, Math.round(n * 0.08));
    for (let i = n - fade; i < n; i++) d[i] *= (n - 1 - i) / fade;
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const g = e > 0 ? Math.sqrt(IR_ENERGY / e) : 0;
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return out;
}

const cache = new Map<string, [Float32Array, Float32Array]>();
/** An AudioBuffer of the space for a context (samples cached per type and rate). */
export function impulseBuffer(ctx: BaseAudioContext, type: ReverbType): AudioBuffer {
  const key = `${type}@${ctx.sampleRate}`;
  let ir = cache.get(key);
  if (!ir) { ir = impulseSamples(type, ctx.sampleRate); cache.set(key, ir); }
  const b = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
  b.getChannelData(0).set(ir[0]);
  b.getChannelData(1).set(ir[1]);
  return b;
}

/** A convolver for a space; the IR is already energy-normalised, so the node's own normalisation is off. */
export function spaceConvolver(ctx: BaseAudioContext, type: ReverbType): ConvolverNode {
  const c = ctx.createConvolver();
  c.normalize = false;
  c.buffer = impulseBuffer(ctx, type);
  return c;
}
