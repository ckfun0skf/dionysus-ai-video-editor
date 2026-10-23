/** Waveform peaks and filmstrip frames (V2-066). Pure helpers are exported for tests. */
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
