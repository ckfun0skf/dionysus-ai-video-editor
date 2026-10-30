/**
 * P4A-3: renders a `dionysus.audioclip/1` document with Web Audio in an OfflineAudioContext. Deterministic: every random
 * value comes from a seeded generator, so the same JSON gives the same samples (the Audio editor preview, the stored
 * WAV and export all use this). See docs/v2/AUDIO_CLIP_FORMAT.md.
 */
import { clipDuration, DRUMS, midiHz, midiOf, paramValue, stepSec, type AudioClip, type ClipTrack, type DrumId } from "../domain/audioClip";

export const CLIP_SAMPLE_RATE = 48000;
/** Seconds added after the clip so reverb and delay tails are not cut (the WAV is this much longer). */
export const tailSec = (c: AudioClip) => (c.tracks.some((t) => !t.mute && (t.fx?.reverb || t.fx?.delay)) ? 1.5 : 0.1);

/** mulberry32: a small fast seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded noise: 0 white, 1 pink (Kellet), 2 brown. */
export function noiseSamples(n: number, color: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    if (color === 0) out[i] = w * 0.5;
    else if (color === 1) {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; out[i] = last * 3.5; }
  }
  return out;
}

type Ctx = BaseAudioContext;
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

function noiseBuffer(ctx: Ctx, sec: number, color: number, rand: () => number): AudioBuffer {
  const n = Math.max(1, Math.ceil(sec * ctx.sampleRate));
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  b.getChannelData(0).set(noiseSamples(n, color, rand));
  return b;
}
/** A seeded exponential-decay stereo impulse for the reverb. */
function impulse(ctx: Ctx, sec: number, rand: () => number): AudioBuffer {
  const n = Math.ceil(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  return b;
}
/** Linear attack, hold, exponential-ish release on a gain param. */
function envelope(g: AudioParam, t0: number, peak: number, attack: number, hold: number, release: number) {
  const a = Math.max(0.002, attack), r = Math.max(0.01, release);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + a);
  g.setValueAtTime(peak, t0 + Math.max(a, hold));
  g.setTargetAtTime(0, t0 + Math.max(a, hold), r / 4);
  return t0 + Math.max(a, hold) + r * 1.5;
}

interface Voice { ctx: Ctx; out: AudioNode; rand: () => number }

const SYNTH: Record<string, { waves: OscillatorType[]; attack: number; decay?: number; release: number; cutoff: number; octave?: number }> = {
  piano: { waves: ["triangle", "sine"], attack: 0.004, decay: 1.4, release: 0.25, cutoff: 5000 },
  pad: { waves: ["sawtooth", "sawtooth"], attack: 0.8, release: 1.5, cutoff: 1800 },
  bass: { waves: ["sawtooth", "square"], attack: 0.006, release: 0.12, cutoff: 700 },
  pluck: { waves: ["sawtooth", "triangle"], attack: 0.002, decay: 0.45, release: 0.15, cutoff: 3500 },
  lead: { waves: ["sawtooth", "square"], attack: 0.02, release: 0.2, cutoff: 3200 },
};

function synthNote(v: Voice, t: ClipTrack, t0: number, len: number, midi: number, vel: number) {
  const s = SYNTH[t.instrument];
  const { ctx } = v;
  const atk = paramValue(t, "attack"), rel = paramValue(t, "release");
  const attack = atk >= 0 ? atk : s.attack, release = rel >= 0 ? rel : s.release;
  const tone = paramValue(t, "tone"), detune = paramValue(t, "detune");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  const cut = s.cutoff * Math.pow(2, (tone - 0.6) * 4);
  f.Q.value = t.instrument === "bass" ? 4 : 0.8;
  const g = ctx.createGain();
  f.connect(g).connect(v.out);
  const hz = midiHz(midi);
  let end: number;
  if (s.decay) {
    // Struck/plucked: decays while held.
    const a = Math.max(0.002, attack);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vel, t0 + a);
    g.gain.setTargetAtTime(0, t0 + a, s.decay / 3);
    const off = t0 + Math.max(len, a);
    g.gain.setTargetAtTime(0, off, release / 4);
    end = Math.min(t0 + a + s.decay * 2, off + release * 1.5);
    f.frequency.setValueAtTime(Math.min(18000, cut * 2), t0);
    f.frequency.setTargetAtTime(cut, t0, 0.08);
  } else {
    end = envelope(g.gain, t0, vel, attack, len, release);
    f.frequency.value = Math.min(18000, cut);
  }
  s.waves.forEach((w, i) => {
    const o = ctx.createOscillator();
    o.type = w;
    o.frequency.value = hz * (t.instrument === "piano" && i === 1 ? 2 : 1);
    o.detune.value = s.waves.length > 1 && t.instrument !== "piano" ? (i ? detune : -detune) : 0;
    const og = ctx.createGain();
    og.gain.value = (i ? 0.35 : 0.5) * (t.instrument === "piano" && i === 1 ? 0.3 : 1);
    o.connect(og).connect(f);
    if (t.instrument === "lead") {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = 6;
      lfo.connect(lg).connect(o.detune); lfo.start(t0 + 0.15); lfo.stop(end);
    }
    o.start(t0); o.stop(end);
  });
}

function drum(v: Voice, t0: number, d: DrumId, vel: number) {
  const { ctx, out, rand } = v;
  const g = ctx.createGain();
  g.connect(out);
  const tone = (f0: number, f1: number, dec: number, type: OscillatorType = "sine", lvl = 1) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dec * 0.6);
    og.gain.setValueAtTime(vel * lvl, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    o.connect(og).connect(g); o.start(t0); o.stop(t0 + dec + 0.02);
  };
  const noise = (dec: number, type: BiquadFilterType, freq: number, lvl: number, at = t0) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dec + 0.02, 0, rand);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(vel * lvl, at); ng.gain.exponentialRampToValueAtTime(0.0001, at + dec);
    src.connect(f).connect(ng).connect(g); src.start(at); src.stop(at + dec + 0.02);
  };
  switch (d) {
    case "kick": tone(150, 42, 0.45, "sine", 1.1); break;
    case "snare": tone(190, 140, 0.12, "triangle", 0.5); noise(0.2, "bandpass", 1800, 0.8); break;
    case "hat": noise(0.05, "highpass", 7500, 0.5); break;
    case "openhat": noise(0.32, "highpass", 7000, 0.45); break;
    case "clap": for (const k of [0, 0.012, 0.024]) noise(0.12, "bandpass", 1300, 0.6, t0 + k); break;
    case "tom": tone(160, 95, 0.35, "sine", 0.9); break;
  }
}

function noiseEvent(v: Voice, t: ClipTrack, t0: number, dur: number, vel: number) {
  const { ctx } = v;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur + 0.05, Math.round(paramValue(t, "color")), v.rand);
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 200 * Math.pow(80, paramValue(t, "tone"));
  const g = ctx.createGain();
  const a = Math.min(paramValue(t, "attack"), dur / 2), r = Math.min(paramValue(t, "release"), dur / 2);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel, t0 + Math.max(0.005, a));
  g.gain.setValueAtTime(vel, t0 + dur - Math.max(0.005, r)); g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(f).connect(g).connect(v.out); src.start(t0); src.stop(t0 + dur + 0.01);
}

function sfxEvent(v: Voice, t: ClipTrack, t0: number, dur: number, vel: number) {
  const { ctx, rand } = v;
  const p = (k: string) => paramValue(t, k);
  const g = ctx.createGain(); g.connect(v.out);
  const end = t0 + dur;
  const noiseSrc = (color: number, len = dur) => { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, len + 0.05, color, rand); return s; };
  switch (t.sfx ?? "whoosh") {
    case "whoosh": {
      const s = noiseSrc(1), f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.4;
      const c = 300 * Math.pow(12, p("tone")), sw = 1 + p("sweep") * 5, pk = t0 + dur * p("peak");
      f.frequency.setValueAtTime(c / sw, t0); f.frequency.exponentialRampToValueAtTime(c * sw, pk); f.frequency.exponentialRampToValueAtTime(c / sw, end);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vel * 1.6, pk); g.gain.exponentialRampToValueAtTime(0.0001, end);
      s.connect(f).connect(g); s.start(t0); s.stop(end + 0.02); break;
    }
    case "impact": {
      const tail = Math.min(p("tail"), dur);
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(p("pitch") * 2.5, t0); o.frequency.exponentialRampToValueAtTime(p("pitch"), t0 + 0.12);
      const og = ctx.createGain(); og.gain.setValueAtTime(vel, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + tail);
      o.connect(og).connect(g); o.start(t0); o.stop(t0 + tail + 0.02);
      const s = noiseSrc(2, tail), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2500;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(vel * p("punch") * 1.5, t0); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.6, tail));
      s.connect(f).connect(ng).connect(g); s.start(t0); s.stop(t0 + tail + 0.02); break;
    }
    case "riser": {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(p("pitch"), t0); o.frequency.exponentialRampToValueAtTime(Math.max(p("pitch") + 1, p("pitchEnd")), end);
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(400, t0); f.frequency.exponentialRampToValueAtTime(9000, end);
      const og = ctx.createGain(); og.gain.value = 0.35 * (1 - p("noise") * 0.6);
      o.connect(og).connect(f); o.start(t0); o.stop(end + 0.02);
      const s = noiseSrc(0), ng = ctx.createGain(); ng.gain.value = p("noise") * 0.6;
      s.connect(ng).connect(f); s.start(t0); s.stop(end + 0.02);
      f.connect(g);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vel, end - 0.02); g.gain.linearRampToValueAtTime(0, end); break;
    }
    case "beep": {
      const n = Math.round(p("count")), gap = p("gap"), each = Math.max(0.02, (dur - gap * (n - 1)) / n);
      for (let i = 0; i < n; i++) {
        const s0 = t0 + i * (each + gap), o = ctx.createOscillator(), og = ctx.createGain();
        o.type = (["sine", "square", "triangle", "sawtooth"] as OscillatorType[])[Math.round(p("wave"))];
        o.frequency.value = p("pitch");
        og.gain.setValueAtTime(0, s0); og.gain.linearRampToValueAtTime(vel * (o.type === "sine" ? 0.8 : 0.35), s0 + 0.005);
        og.gain.setValueAtTime(vel * (o.type === "sine" ? 0.8 : 0.35), s0 + each - 0.01); og.gain.linearRampToValueAtTime(0, s0 + each);
        o.connect(og).connect(g); o.start(s0); o.stop(s0 + each + 0.01);
      }
      break;
    }
    case "glitch": {
      const count = Math.max(1, Math.round(p("density") * dur)), chaos = p("chaos");
      for (let i = 0; i < count; i++) {
        const s0 = t0 + rand() * dur * 0.95, len = 0.01 + rand() * 0.06 * (0.3 + chaos);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = rand() < 0.5 ? "square" : "sawtooth";
        o.frequency.value = p("pitch") * Math.pow(2, (rand() * 2 - 1) * chaos * 2);
        og.gain.setValueAtTime(vel * 0.3, s0); og.gain.setValueAtTime(0, s0 + len);
        o.connect(og).connect(g); o.start(s0); o.stop(s0 + len + 0.005);
      }
      break;
    }
    case "wind": {
      const s = noiseSrc(2), f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.9;
      const c = 250 * Math.pow(8, p("tone")); f.frequency.value = c;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = p("rate"); lg.gain.value = c * 0.6 * p("gust");
      lfo.connect(lg).connect(f.frequency); lfo.start(t0); lfo.stop(end + 0.02);
      const amp = ctx.createGain(), alfo = ctx.createOscillator(), ag = ctx.createGain();
      amp.gain.value = 1; alfo.frequency.value = p("rate") * 0.7; ag.gain.value = 0.5 * p("gust");
      alfo.connect(ag).connect(amp.gain); alfo.start(t0); alfo.stop(end + 0.02);
      const fade = Math.min(0.8, dur / 3);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vel * 1.4, t0 + fade); g.gain.setValueAtTime(vel * 1.4, end - fade); g.gain.linearRampToValueAtTime(0, end);
      s.connect(f).connect(amp).connect(g); s.start(t0); s.stop(end + 0.02); break;
    }
    case "rain": {
      const s = noiseSrc(1), f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 400 + 3000 * p("tone");
      const hg = ctx.createGain(); hg.gain.value = p("hiss") * 0.7;
      s.connect(f).connect(hg).connect(g); s.start(t0); s.stop(end + 0.02);
      const drops = Math.round(dur * (5 + 120 * p("density")));
      for (let i = 0; i < drops; i++) {
        const s0 = t0 + rand() * dur, o = ctx.createOscillator(), og = ctx.createGain();
        o.frequency.setValueAtTime(1800 + rand() * 3500, s0); o.frequency.exponentialRampToValueAtTime(600, s0 + 0.02);
        og.gain.setValueAtTime(vel * (0.04 + rand() * 0.12), s0); og.gain.exponentialRampToValueAtTime(0.0001, s0 + 0.03);
        o.connect(og).connect(g); o.start(s0); o.stop(s0 + 0.035);
      }
      const fade = Math.min(0.5, dur / 3);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + fade); g.gain.setValueAtTime(1, end - fade); g.gain.linearRampToValueAtTime(0, end); break;
    }
  }
}

/** Track chain: voices → filter? → pan → volume → (dry + reverb + delay) → master. */
function trackChain(ctx: Ctx, t: ClipTrack, master: AudioNode, rand: () => number): AudioNode {
  const input = ctx.createGain();
  let node: AudioNode = input;
  if (t.fx?.filter) { const f = ctx.createBiquadFilter(); f.type = t.fx.filter.type; f.frequency.value = t.fx.filter.cutoff; f.Q.value = t.fx.filter.q ?? 0.8; node.connect(f); node = f; }
  const pan = ctx.createStereoPanner(); pan.pan.value = t.pan ?? 0;
  const vol = ctx.createGain(); vol.gain.value = t.volume ?? 0.8;
  node.connect(pan).connect(vol);
  vol.connect(master);
  if (t.fx?.reverb) {
    const c = ctx.createConvolver(); c.buffer = impulse(ctx, 2.2, rand);
    const w = ctx.createGain(); w.gain.value = t.fx.reverb * 0.6;
    vol.connect(c).connect(w).connect(master);
  }
  if (t.fx?.delay) {
    const d = ctx.createDelay(2); d.delayTime.value = t.fx.delayTime ?? 0.25;
    const fb = ctx.createGain(); fb.gain.value = t.fx.delay * 0.7;
    const w = ctx.createGain(); w.gain.value = t.fx.delay * 0.6;
    vol.connect(d); d.connect(fb).connect(d); d.connect(w).connect(master);
  }
  return input;
}

/** Schedule the whole clip into a context (offline or live) starting at `at` seconds. */
export function scheduleClip(ctx: Ctx, c: AudioClip, dest: AudioNode = ctx.destination, at = 0) {
  const master = ctx.createGain(); master.gain.value = c.volume ?? 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -6; comp.ratio.value = 4;
  master.connect(comp).connect(dest);
  const ss = stepSec(c), dur = clipDuration(c);
  for (const t of c.tracks) {
    if (t.mute) continue;
    const rand = rng(((c.seed ?? 1) ^ hashStr(t.id)) >>> 0);
    const v: Voice = { ctx, out: trackChain(ctx, t, master, rand), rand };
    if (t.instrument === "sfx" || t.instrument === "noise") {
      for (const e of t.events ?? []) { if (e.t >= dur) continue; (t.instrument === "sfx" ? sfxEvent : noiseEvent)(v, t, at + e.t, Math.min(e.dur, dur - e.t), Math.max(1e-4, e.vel ?? 1)); }
      continue;
    }
    for (const n of t.notes ?? []) {
      const t0 = n.step * ss;
      if (t0 >= dur) continue;
      if (t.instrument === "drums") { if (DRUMS.includes(n.pitch as DrumId)) drum(v, at + t0, n.pitch as DrumId, Math.max(1e-4, n.vel ?? 0.9)); continue; }
      const m = midiOf(n.pitch);
      if (m !== undefined) synthNote(v, t, at + t0, (n.len ?? 1) * ss, m, (n.vel ?? 0.8) * 0.6);
    }
  }
}

export type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
/** Render to a stereo AudioBuffer (clip length + tail). */
export async function renderAudioClip(c: AudioClip, opts: { sampleRate?: number; Offline?: OfflineCtor; tail?: boolean } = {}): Promise<AudioBuffer> {
  const sr = opts.sampleRate ?? CLIP_SAMPLE_RATE;
  const Ctor = opts.Offline ?? (globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor }).OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext;
  if (!Ctor) throw new Error("This browser can't render audio (no OfflineAudioContext).");
  const sec = clipDuration(c) + (opts.tail === false ? 0 : tailSec(c));
  const ctx = new Ctor(2, Math.max(1, Math.ceil(sec * sr)), sr);
  scheduleClip(ctx, c);
  return ctx.startRendering();
}

/** 16-bit PCM WAV of interleaved channels. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const nc = channels.length, n = channels[0]?.length ?? 0, bytes = n * nc * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let ch = 0; ch < nc; ch++) { const s = Math.max(-1, Math.min(1, channels[ch][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buf], { type: "audio/wav" });
}
export const bufferToWav = (b: AudioBuffer) => encodeWav(Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)), b.sampleRate);

/** Render a clip to a WAV blob plus its length in seconds. */
export async function audioClipWav(c: AudioClip, opts?: { Offline?: OfflineCtor }): Promise<{ wav: Blob; seconds: number; buffer: AudioBuffer }> {
  const buffer = await renderAudioClip(c, opts);
  return { wav: bufferToWav(buffer), seconds: buffer.duration, buffer };
}
