/** Waveform peaks and filmstrip frames (V2-066). Pure helpers are exported for tests. */
import { fromVideo as fromVideoDomain } from "../domain";
import { encodeWav } from "../render";
export const PEAKS_PER_SECOND = 50;
export const MAX_DECODE_BYTES = 200 * 1024 * 1024;
export const FILMSTRIP_FRAMES = 24;
export const FILMSTRIP_H = 48;

export interface Peaks { perSecond: number; data: Float32Array }
export interface Filmstrip { times: number[]; frames: string[]; aspect: number }

/** Max |sample| per bucket across channels, normalised to 0..1. */
export function computePeaks(channels: Float32Array[], sampleRate: number, perSecond = PEAKS_PER_SECOND): Peaks {
  const len = channels[0]?.length ?? 0;
  const size = Math.max(1, Math.round(sampleRate / perSecond));
  const n = Math.ceil(len / size);
  const data = new Float32Array(n);
  let max = 0;
  for (let b = 0; b < n; b += 1) {
    let m = 0;
    const end = Math.min(len, (b + 1) * size);
    for (const ch of channels) for (let i = b * size; i < end; i += 1) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    data[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < n; b += 1) data[b] /= max;
  return { perSecond, data };
}

/** Peaks for `count` bars covering a clip's used source span (speed/reverse aware). */
export function clipBars(peaks: Peaks, sourceInSec: number, durationSec: number, speed: number, reverse: boolean, count: number): number[] {
  const span = durationSec * speed;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const f0 = i / count, f1 = (i + 1) / count;
    const a = sourceInSec + span * (reverse ? 1 - f1 : f0), b = sourceInSec + span * (reverse ? 1 - f0 : f1);
    let m = 0;
    for (let k = Math.floor(a * peaks.perSecond); k < Math.max(Math.floor(a * peaks.perSecond) + 1, Math.ceil(b * peaks.perSecond)); k += 1) m = Math.max(m, peaks.data[k] ?? 0);
    out.push(m);
  }
  return out;
}

/** Index of the filmstrip frame nearest to source time `t` (seconds). */
export function nearestFrame(times: number[], t: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i += 1) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return best;
}

export async function decodePeaks(blob: Blob): Promise<Peaks | undefined> {
  if (blob.size > MAX_DECODE_BYTES) return undefined;
  const Ctx = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctx) return undefined;
  const ctx = new Ctx(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  return computePeaks(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate);
}

export async function extractFilmstrip(blob: Blob, count = FILMSTRIP_FRAMES): Promise<Filmstrip | undefined> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = url;
  const wait = (ev: "loadeddata" | "seeked") => new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("filmstrip timeout")), 8000);
    v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    v.addEventListener("error", () => { clearTimeout(t); rej(new Error("filmstrip error")); }, { once: true });
  });
  try {
    await wait("loadeddata");
    const dur = v.duration;
    if (!isFinite(dur) || !v.videoWidth) return undefined;
    const aspect = v.videoWidth / v.videoHeight;
    const c = document.createElement("canvas");
    c.height = FILMSTRIP_H * 2; c.width = Math.round(c.height * aspect);
    const g = c.getContext("2d");
    if (!g) return undefined;
    const times: number[] = [], frames: string[] = [];
    const n = Math.max(1, Math.min(count, Math.ceil(dur)));
    for (let i = 0; i < n; i += 1) {
      const t = Math.min(dur - 0.05, ((i + 0.5) / n) * dur);
      v.currentTime = t;
      await wait("seeked");
      g.drawImage(v, 0, 0, c.width, c.height);
      times.push(t);
      frames.push(c.toDataURL("image/jpeg", 0.6));
    }
    return { times, frames, aspect };
  } finally {
    v.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/** P18: whether a video file has an audio track (head and tail bytes; undefined = can't tell, treated as maybe). */
export async function probeVideoAudio(blob: Blob): Promise<boolean | undefined> {
  const HEAD = 4 * 1024 * 1024, TAIL = 4 * 1024 * 1024;
  const part = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
  try {
    if (blob.size <= HEAD + TAIL) return fromVideoDomain.detectAudioTrack(await part(blob));
    const head = fromVideoDomain.detectAudioTrack(await part(blob.slice(0, HEAD)));
    if (head) return true;
    const tail = fromVideoDomain.detectAudioTrack(await part(blob.slice(blob.size - TAIL)));
    return tail ?? head;
  } catch { return undefined; }
}

type OfflineLike = new (channels: number, length: number, rate: number) => OfflineAudioContext;
/**
 * P18: decode a video's audio track with Web Audio and cut `inSec`..`outSec` to a WAV. iOS Safari (webkit prefix and
 * the callback form of decodeAudioData) and Android Chrome decode MP4/AAC; throws when the browser can't decode it.
 */
export async function extractAudioWav(blob: Blob, inSec: number, outSec: number): Promise<{ wav: Blob; seconds: number }> {
  if (blob.size > MAX_DECODE_BYTES) throw new Error("video too large to decode");
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineLike; webkitOfflineAudioContext?: OfflineLike };
  const Ctx = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctx) throw new Error("no Web Audio");
  const ctx = new Ctx(2, 1, 44100);
  const data = await blob.arrayBuffer();
  const buf: AudioBuffer = await new Promise((res, rej) => {
    try { const p = ctx.decodeAudioData(data, res, rej); if (p && typeof (p as Promise<AudioBuffer>).then === "function") (p as Promise<AudioBuffer>).then(res, rej); } catch (e) { rej(e); }
  });
  const rate = buf.sampleRate, a = Math.max(0, Math.floor(inSec * rate)), b = Math.min(buf.length, Math.ceil(outSec * rate));
  if (b <= a) throw new Error("empty audio span");
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice(a, b));
  return { wav: encodeWav(chans, rate), seconds: (b - a) / rate };
}

/** P19: read a picked file in chunks to report upload progress (0-1); returns an in-memory File with the same name and type. */
export async function readFileWithProgress(f: File, progress: (x: number) => void): Promise<File> {
  const total = f.size || 1;
  if (typeof f.stream !== "function") { progress(1); return f; }
  const reader = f.stream().getReader();
  const parts: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.byteLength; progress(Math.min(1, got / total));
  }
  progress(1);
  return new File(parts, f.name, { type: f.type, lastModified: f.lastModified });
}
