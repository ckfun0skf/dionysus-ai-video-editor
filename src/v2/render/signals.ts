/**
 * P38 (item 5): computed signals for code clips' `inputs`. Code clips never get raw samples or pixels: the host
 * analyses audio once per file (rms, peak, 8 bands, onset, envelope per 1/60 s) and pictures per frame (luma, average
 * colour, motion, a 16-bin luma histogram from a 32×18 thumbnail) and passes only these numbers as ctx.inputs.
 */
export const SIGNAL_FPS = 60;
export const BAND_COUNT = 8;
/** Band edges in Hz (log-spaced): sub, bass, low-mid, mid, upper-mid, presence, brilliance, air. */
export const BAND_EDGES = [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000];
export const HIST_BINS = 16;
export const SCENE_W = 32, SCENE_H = 18;

export interface BeatSignal { rms: number; peak: number; bands: number[]; onset: number; envelope: number }
export interface SceneSignal { luma: number; avgColor: [number, number, number]; motion: number; histogram: number[] }
export const SILENT: BeatSignal = { rms: 0, peak: 0, bands: new Array(BAND_COUNT).fill(0), onset: 0, envelope: 0 };
export const BLACK: SceneSignal = { luma: 0, avgColor: [0, 0, 0], motion: 0, histogram: [1, ...new Array(HIST_BINS - 1).fill(0)] };

export interface AudioFeatures { fps: number; frames: number; rms: Float32Array; peak: Float32Array; bands: Float32Array; onset: Float32Array; envelope: Float32Array }

const N = 1024;
/** In-place radix-2 FFT (re, im of length N). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k], ui = im[i + k], xr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, xi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + xr; im[i + k] = ui + xi; re[i + k + len / 2] = ur - xr; im[i + k + len / 2] = ui - xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);

/** Analyse mono samples once: one value set per 1/fps s. Pure and deterministic (same file → same numbers). */
export function analyzeAudio(samples: Float32Array, rate: number, fps = SIGNAL_FPS): AudioFeatures {
  const hop = rate / fps, frames = Math.max(1, Math.ceil(samples.length / hop));
  const rms = new Float32Array(frames), peak = new Float32Array(frames), bands = new Float32Array(frames * BAND_COUNT), onset = new Float32Array(frames), envelope = new Float32Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const binHz = rate / N, prevMag = new Float64Array(N / 2), flux = new Float32Array(frames);
  const edges = BAND_EDGES.map((hz) => Math.min(N / 2, Math.max(1, Math.round(hz / binHz))));
  const release = Math.exp(-1 / (0.25 * fps));
  let env = 0;
  for (let f = 0; f < frames; f += 1) {
    const c = Math.round(f * hop), a = Math.max(0, c - N / 2);
    let sq = 0, pk = 0, cnt = 0;
    for (let i = Math.round(c); i < Math.min(samples.length, Math.round(c + hop)); i += 1) { const v = samples[i]; sq += v * v; pk = Math.max(pk, Math.abs(v)); cnt += 1; }
    rms[f] = clamp01(Math.sqrt(sq / Math.max(1, cnt)) * Math.SQRT2);
    peak[f] = clamp01(pk);
    for (let i = 0; i < N; i += 1) { const v = samples[a + i] ?? 0; re[i] = v * win[i]; im[i] = 0; }
    fft(re, im);
    let fl = 0;
    for (let k = 1; k < N / 2; k += 1) { const m = Math.hypot(re[k], im[k]) / (N / 4); if (m > prevMag[k]) fl += m - prevMag[k]; prevMag[k] = m; }
    flux[f] = fl;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      let s = 0; const lo = edges[b], hi = Math.max(lo + 1, edges[b + 1]);
      for (let k = lo; k < hi; k += 1) s += (re[k] * re[k] + im[k] * im[k]) / ((N / 4) * (N / 4));
      bands[f * BAND_COUNT + b] = clamp01(Math.sqrt(s / (hi - lo)) * 4);
    }
    env = Math.max(rms[f], env * release);
    envelope[f] = env;
  }
  // Onset: spectral flux above its recent (0.5 s) average, scaled 0..1.
  const span = Math.max(1, Math.round(fps / 2));
  let sum = 0;
  for (let f = 0; f < frames; f += 1) {
    sum += flux[f]; if (f >= span) sum -= flux[f - span];
    const mean = sum / Math.min(f + 1, span);
    onset[f] = clamp01((flux[f] - mean * 1.5) / (mean * 1.5 + 1e-3));
  }
  return { fps, frames, rms, peak, bands, onset, envelope };
}

/** The beat signal at `sec` seconds into the analysed file (silence outside it). */
export function beatAt(a: AudioFeatures, sec: number): BeatSignal {
  const f = Math.floor(sec * a.fps);
  if (!(f >= 0 && f < a.frames)) return SILENT;
  return { rms: a.rms[f], peak: a.peak[f], bands: Array.from(a.bands.subarray(f * BAND_COUNT, (f + 1) * BAND_COUNT)), onset: a.onset[f], envelope: a.envelope[f] };
}

/** Several sources playing together (a mix or a track): energies add, peaks and onsets take the loudest. */
export function mixBeats(parts: { beat: BeatSignal; gain: number }[]): BeatSignal {
  if (!parts.length) return SILENT;
  const pow = (k: "rms" | "envelope") => clamp01(Math.sqrt(parts.reduce((s, p) => s + (p.beat[k] * p.gain) ** 2, 0)));
  return {
    rms: pow("rms"), envelope: pow("envelope"),
    peak: clamp01(Math.max(...parts.map((p) => p.beat.peak * p.gain))),
    onset: Math.max(...parts.map((p) => p.beat.onset)),
    bands: Array.from({ length: BAND_COUNT }, (_, b) => clamp01(Math.sqrt(parts.reduce((s, p) => s + (p.beat.bands[b] * p.gain) ** 2, 0)))),
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Scene numbers from a 32×18 RGBA thumbnail; motion = mean luma change from `prev` (the previous frame's thumbnail). */
export function sceneFrom(rgba: Uint8ClampedArray, prev?: Uint8ClampedArray): SceneSignal {
  const px = rgba.length / 4;
  if (!px) return BLACK;
  let r = 0, g = 0, b = 0, l = 0, m = 0;
  const hist = new Array(HIST_BINS).fill(0);
  for (let i = 0; i < rgba.length; i += 4) {
    const y = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; l += y;
    hist[Math.min(HIST_BINS - 1, Math.floor(y * HIST_BINS))] += 1;
    if (prev && prev.length === rgba.length) m += Math.abs(y - (0.2126 * prev[i] + 0.7152 * prev[i + 1] + 0.0722 * prev[i + 2]) / 255);
  }
  return { luma: r3(l / px), avgColor: [r3(r / px / 255), r3(g / px / 255), r3(b / px / 255)], motion: r3(clamp01((m / px) * 4)), histogram: hist.map((h) => r3(h / px)) };
}
