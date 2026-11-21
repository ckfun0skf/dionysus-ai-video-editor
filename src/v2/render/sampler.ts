/**
 * P91: sampled instruments for `dionysus.audioclip/1` ("instrument": "sampler"). Loads the built-in packs from
 * public/samples/<pack>/manifest.json (docs/v2/AUDIO_CLIP_FORMAT.md), fetches and decodes only the recordings a clip's
 * notes need, once (cached per file and sample rate), and plays notes by pitch-shifting the nearest recording with
 * playbackRate. Sustained packs loop a crossfaded region; decaying packs ring and are damped on release.
 */
import { midiOf, paramValue, type AudioClip, type ClipTrack } from "../domain/audioClip";
import { parseSamplerManifest, pickZone, samplerPack, velocityGain, type SamplerManifest, type SamplerZone } from "../domain/samplerPacks";

/** A decoded recording ready to play: `offset` skips leading silence (decoder padding), `loop` is in buffer seconds. */
export interface LoadedZone { zone: SamplerZone; buffer: AudioBuffer; offset: number; loop?: [number, number] }
export interface LoadedPack { manifest: SamplerManifest; zones: Map<number, LoadedZone> }
/** Everything a clip's sampler tracks need, by pack id. */
export type SampleBank = Map<string, LoadedPack>;

export interface SampleLoader {
  /** Base URL of the samples folder (default: `<app base>/samples/`). */
  base?: string;
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Decode compressed audio at a sample rate (default: an OfflineAudioContext's decodeAudioData). */
  decode?: (data: ArrayBuffer, sampleRate: number) => Promise<AudioBuffer>;
}

/** URL of the built-in samples folder, relative to the app's base (import.meta.env.BASE_URL under Vite). */
export function samplesBaseUrl(base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/", href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base.endsWith("/") ? base : `${base}/`}samples/`, href).href;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
const decodeCtxs = new Map<number, OfflineAudioContext>();
function decodeContext(sampleRate: number): OfflineAudioContext {
  let c = decodeCtxs.get(sampleRate);
  if (!c) {
    const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
    const Ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
    if (!Ctor) throw new Error("This browser can't decode audio (no OfflineAudioContext).");
    c = new Ctor(1, 1, sampleRate);
    decodeCtxs.set(sampleRate, c);
  }
  return c;
}
/** decodeAudioData with both the promise and the old callback form (older Safari). */
function defaultDecode(data: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  const ctx = decodeContext(sampleRate);
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, (e) => reject(e ?? new Error("decode failed")));
    if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}
const defaultFetch: NonNullable<SampleLoader["fetch"]> = (url) => globalThis.fetch(url);

/** Seconds of leading near-silence (encoder/decoder padding) before the recording's onset, minus 2 ms of lead-in. */
export function onsetOffset(ch: Float32Array, sampleRate: number, threshold = 1e-3, maxSec = 0.12): number {
  const max = Math.min(ch.length, Math.round(maxSec * sampleRate));
  for (let i = 0; i < max; i++) if (Math.abs(ch[i]) > threshold) return Math.max(0, i - Math.round(0.002 * sampleRate)) / sampleRate;
  return 0;
}

/**
 * Bake an equal-power crossfade into the end of a loop region so playback can jump from `end` back to `start` without
 * a click: the last `xf` samples before `end` fade into the samples just before `start`. Returns new channel data cut
 * at `end` (sample indices).
 */
export function crossfadeLoop(src: Float32Array, start: number, end: number, xf: number): Float32Array {
  const out = src.slice(0, end);
  const n = Math.max(1, Math.min(xf, start, end - start));
  for (let i = 0; i < n; i++) {
    const a = (i + 1) / n;
    const j = end - n + i;
    out[j] = src[j] * Math.cos((a * Math.PI) / 2) + src[start - n + i] * Math.sin((a * Math.PI) / 2);
  }
  return out;
}

function prepare(decoded: AudioBuffer, zone: SamplerZone, kind: SamplerManifest["kind"], makeBuffer: (ch: number, len: number, sr: number) => AudioBuffer): LoadedZone {
  const sr = decoded.sampleRate;
  const offset = onsetOffset(decoded.getChannelData(0), sr);
  if (kind !== "sustain" || zone.loopStart === undefined || zone.loopEnd === undefined) return { zone, buffer: decoded, offset };
  const s = Math.round((offset + zone.loopStart) * sr), e = Math.min(decoded.length, Math.round((offset + zone.loopEnd) * sr));
  if (e - s < Math.round(0.1 * sr) || s < 2) return { zone, buffer: decoded, offset };
  const xf = Math.round(Math.min(0.3, (e - s) / 3 / sr, s / sr) * sr);
  const b = makeBuffer(decoded.numberOfChannels, e, sr);
  for (let c = 0; c < decoded.numberOfChannels; c++) b.getChannelData(c).set(crossfadeLoop(decoded.getChannelData(c), s, e, xf));
  return { zone, buffer: b, offset, loop: [s / sr, e / sr] };
}

const manifests = new Map<string, Promise<SamplerManifest>>();
const zones = new Map<string, Promise<LoadedZone>>();
/** Settled loads, so the editor can tell synchronously whether a render will have to wait. */
const loadedManifests = new Map<string, SamplerManifest>();
const loadedZones = new Set<string>();
const manifestUrl = (id: string, base: string) => new URL(`${id}/manifest.json`, base).href;
const zoneKey = (id: string, file: string, base: string, sr: number) => `${new URL(`${id}/${file}`, base).href}@${sr}`;

function loadManifest(id: string, base: string, f: NonNullable<SampleLoader["fetch"]>): Promise<SamplerManifest> {
  const url = manifestUrl(id, base);
  let p = manifests.get(url);
  if (!p) {
    p = f(url).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); const m = parseSamplerManifest(await r.json(), id); loadedManifests.set(url, m); return m; });
    p.catch(() => manifests.delete(url));
    manifests.set(url, p);
  }
  return p;
}

/** Which zones (by pack) a clip's unmuted sampler notes play. */
export function neededZones(c: AudioClip, manifestOf: (id: string) => SamplerManifest): Map<string, Set<number>> {
  const need = new Map<string, Set<number>>();
  for (const t of c.tracks) {
    if (t.mute || t.instrument !== "sampler" || !t.sampler) continue;
    const m = manifestOf(t.sampler);
    const set = need.get(t.sampler) ?? new Set<number>();
    for (const n of t.notes ?? []) { const midi = midiOf(n.pitch); if (midi !== undefined) { const i = pickZone(m, midi, n.vel ?? 0.8); if (i >= 0) set.add(i); } }
    need.set(t.sampler, set);
  }
  return need;
}

const packIds = (c: AudioClip) => [...new Set(c.tracks.filter((t) => !t.mute && t.instrument === "sampler" && t.sampler).map((t) => t.sampler!))];
/** Whether a clip plays sampled instruments. */
export const clipUsesSamples = (c: AudioClip) => packIds(c).length > 0;
/** Whether every recording a clip needs is already loaded (the editor shows "Loading instruments…" otherwise). */
export function clipSamplesReady(c: AudioClip, sampleRate: number, base = samplesBaseUrl()): boolean {
  const ids = packIds(c);
  if (!ids.length) return true;
  if (!ids.every((id) => loadedManifests.has(manifestUrl(id, base)))) return false;
  const need = neededZones(c, (id) => loadedManifests.get(manifestUrl(id, base))!);
  return [...need.entries()].every(([id, set]) => [...set].every((i) => loadedZones.has(zoneKey(id, loadedManifests.get(manifestUrl(id, base))!.zones[i].file, base, sampleRate))));
}

/**
 * Fetch and decode what a clip's sampler tracks need. Rejects with a readable message naming the instrument when a
 * manifest or a recording can't be loaded.
 */
export async function loadClipSamples(c: AudioClip, sampleRate: number, loader: SampleLoader = {}): Promise<SampleBank> {
  const bank: SampleBank = new Map();
  const ids = packIds(c);
  if (!ids.length) return bank;
  const base = loader.base ?? samplesBaseUrl(), f = loader.fetch ?? defaultFetch, decode = loader.decode ?? defaultDecode;
  const label = (id: string) => samplerPack(id)?.name ?? id;
  const mans = new Map<string, SamplerManifest>();
  await Promise.all(ids.map(async (id) => {
    try { mans.set(id, await loadManifest(id, base, f)); } catch (e) { throw new Error(`Couldn't load the "${label(id)}" instrument (${e instanceof Error ? e.message : String(e)}).`); }
  }));
  const need = neededZones(c, (id) => mans.get(id)!);
  const makeBuffer = (ch: number, len: number, sr: number) => decodeContextOr(sr).createBuffer(ch, len, sr);
  await Promise.all([...need.entries()].map(async ([id, set]) => {
    const m = mans.get(id)!;
    const pack: LoadedPack = { manifest: m, zones: new Map() };
    bank.set(id, pack);
    await Promise.all([...set].map(async (i) => {
      const zone = m.zones[i];
      const url = new URL(`${id}/${zone.file}`, base).href;
      const key = zoneKey(id, zone.file, base, sampleRate);
      let p = zones.get(key);
      if (!p) {
        p = (async () => {
          const r = await f(url);
          if (!r.ok) throw new Error(`${zone.file}: HTTP ${r.status}`);
          const lz = prepare(await decode(await r.arrayBuffer(), sampleRate), zone, m.kind, makeBuffer);
          loadedZones.add(key);
          return lz;
        })();
        p.catch(() => zones.delete(key));
        zones.set(key, p);
      }
      try { pack.zones.set(i, await p); } catch (e) { throw new Error(`Couldn't load the "${label(id)}" instrument (${e instanceof Error ? e.message : String(e)}).`); }
    }));
  }));
  return bank;
}
/** A context to allocate loop buffers in (tests inject their own decode, which also brings buffers). */
let bufferFactory: ((ch: number, len: number, sr: number) => AudioBuffer) | undefined;
function decodeContextOr(sr: number) {
  return bufferFactory ? { createBuffer: bufferFactory } : decodeContext(sr);
}
/** Tests: allocate loop buffers without an AudioContext. */
export function setSampleBufferFactory(f: typeof bufferFactory) { bufferFactory = f; }
/** Tests: forget every cached manifest and recording. */
export function clearSampleCache() { manifests.clear(); zones.clear(); loadedManifests.clear(); loadedZones.clear(); }

/** Seconds a sampler track's notes may ring past their end (release), for the render tail. */
export const SAMPLER_TAIL = 1.5;

/** Play one note of a sampler track into `out`. Returns nothing; missing zones (not loaded) are skipped. */
export function samplerNote(ctx: BaseAudioContext, out: AudioNode, t: ClipTrack, bank: SampleBank | undefined, t0: number, len: number, midi: number, vel: number) {
  const pack = bank?.get(t.sampler ?? "");
  if (!pack) return;
  const m = pack.manifest;
  const zi = pickZone(m, midi, vel);
  const lz = pack.zones.get(zi);
  if (!lz) return;
  const z = lz.zone;
  const atkP = paramValue(t, "attack"), relP = paramValue(t, "release"), tone = paramValue(t, "tone");
  const attack = Math.max(0.002, atkP >= 0 ? atkP : m.attack), release = Math.max(0.02, relP >= 0 ? relP : m.release);
  const rate = Math.pow(2, (midi - z.root) / 12 + (z.tune ?? 0) / 1200);
  const level = m.gain * (z.gain ?? 1) * velocityGain(vel, z.velHi);
  const src = ctx.createBufferSource();
  src.buffer = lz.buffer;
  src.playbackRate.value = rate;
  const looped = m.kind === "sustain" && !!lz.loop;
  if (looped) { src.loop = true; src.loopStart = lz.loop![0]; src.loopEnd = lz.loop![1]; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + attack);
  const off = t0 + Math.max(len, attack);
  g.gain.setValueAtTime(level, off);
  g.gain.setTargetAtTime(0, off, release / 4);
  const ringEnd = looped ? Infinity : t0 + (lz.buffer.duration - lz.offset) / rate;
  const end = Math.min(ringEnd, off + release * 1.5);
  let node: AudioNode = src;
  if (tone < 0.999) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 200 * Math.pow(100, tone);
    f.Q.value = 0.7;
    node.connect(f); node = f;
  }
  node.connect(g).connect(out);
  src.start(t0, lz.offset);
  src.stop(Math.max(t0 + 0.01, end) + 0.01);
}
