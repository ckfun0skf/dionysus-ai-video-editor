/** Export: offline frame-by-frame render → WebCodecs H.264 MP4 (AAC, else Opus audio), or a real-time MediaRecorder WebM fallback. */
import { loadBundledFonts } from "../fonts";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Project } from "../../domain/model";
import type { BlobStore } from "../../ports/storage";
import { Player } from "../player";
import { ExportVideoFrames } from "./videoFrames";
import { audioFxData, buildFxChain } from "../audioFx";
import { buildSpatial } from "../spatial";
import { audioOutputOf, type AudioOutput } from "../../domain/spatial";
import { audioPlan, gainEvents, keyEvents, spatialEvents, exportDuration, exportSize, frameTimes, type AudioSegment, type Resolution } from "./plan";

export interface ExportProgress { stage: "audio" | "video" | "finalize"; done: number; total: number }
/**
 * What an export actually writes (V2-SB-129): container, video codec, and audio codec. `audio` is undefined when the
 * timeline has no sound, and "none" when it has sound but this browser can't encode any audio for the container.
 */
export interface ExportFormat { ext: "mp4" | "webm"; video: string; audio?: "AAC" | "Opus" | "none" }
export interface ExportResult { blob: Blob; ext: "mp4" | "webm"; format?: ExportFormat; note?: string; warnings?: string[] }
export interface ExportOptions { res: Resolution; onProgress?: (p: ExportProgress) => void; signal?: AbortSignal; forceWebm?: boolean }

const RATE = 48_000;
const still = { kind: "wall" as const, now: () => 0 };
const abortIf = (s?: AbortSignal) => { if (s?.aborted) throw new DOMException("Export cancelled", "AbortError"); };

/** H.264 profile/level strings to try, best first, for the given size. */
export function avcCandidates(w: number, h: number) {
  const big = w * h > 1920 * 1088;
  return big ? ["avc1.640033", "avc1.4d0033", "avc1.420033"] : ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"];
}

export async function pickAvc(w: number, h: number, fps: number): Promise<VideoEncoderConfig | undefined> {
  if (typeof VideoEncoder === "undefined") return undefined;
  for (const codec of avcCandidates(w, h)) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, framerate: fps, bitrate: Math.round(w * h * fps * 0.15), avc: { format: "avc" } };
    if ((await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }))).supported) return cfg;
  }
  return undefined;
}

/** AAC-LC configs to try, best first, then Opus (MP4 allows both; Chromium builds without proprietary codecs lack AAC). */
export const AUDIO_CANDIDATES: AudioEncoderConfig[] = [
  { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 192_000 },
  { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 128_000 },
  { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2 },
  { codec: "opus", sampleRate: RATE, numberOfChannels: 2, bitrate: 192_000 },
  { codec: "opus", sampleRate: RATE, numberOfChannels: 2 },
];

/** The first audio config this browser can encode for MP4 (AAC preferred), or undefined. */
export async function pickAudio(): Promise<AudioEncoderConfig | undefined> {
  if (typeof AudioEncoder === "undefined") return undefined;
  for (const c of AUDIO_CANDIDATES) if ((await AudioEncoder.isConfigSupported(c).catch(() => ({ supported: false }))).supported) return { ...c };
  return undefined;
}

const audioName = (c: AudioEncoderConfig | undefined): ExportFormat["audio"] => (!c ? "none" : c.codec === "opus" ? "Opus" : "AAC");
const WEBM_MIMES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
/** Codecs named in a WebM MIME type (as MediaRecorder reports it). */
export function webmFormat(mime: string | undefined, hasAudio: boolean): ExportFormat {
  const c = /codecs="?([^";]+)/i.exec(mime ?? "")?.[1]?.toLowerCase() ?? "";
  const video = /vp9|vp09/.test(c) ? "VP9" : /vp8/.test(c) ? "VP8" : /avc1|h264/.test(c) ? "H.264" : /av1|av01/.test(c) ? "AV1" : "VP8/VP9";
  return { ext: "webm", video, ...(hasAudio ? { audio: "Opus" as const } : {}) };
}

/** Human label, e.g. "MP4 (H.264 + AAC)", "MP4 (H.264, silent)", "WebM (VP9 + Opus)". */
export function formatLabel(f: ExportFormat): string {
  const a = f.audio === undefined ? "" : f.audio === "none" ? ", silent" : ` + ${f.audio}`;
  return `${f.ext === "mp4" ? "MP4" : "WebM"} (${f.video}${a})`;
}

/** A short explanation when the format is not the standard H.264 + AAC MP4, else undefined. */
export function formatNote(f: ExportFormat): string | undefined {
  if (f.ext === "webm") return "This browser has no H.264 encoder, so the export is WebM, recorded in real time (keep this tab open).";
  if (f.audio === "none") return "This browser can't encode MP4 audio, so the file is silent.";
  if (f.audio === "Opus") return "This browser can't encode AAC, so the audio is Opus. Most players handle it; some older players and editors may play the file silent. Export in Safari, or Chrome on macOS or Windows, for AAC.";
  return undefined;
}

/** What `exportProject` will write at this resolution in this browser, without rendering anything. */
export async function probeExportFormat(project: Project, res: Resolution): Promise<ExportFormat> {
  const { width, height } = exportSize(res, project.settings);
  const hasAudio = audioPlan(project).length > 0;
  if (await pickAvc(width, height, project.settings.fps)) return { ext: "mp4", video: "H.264", ...(hasAudio ? { audio: audioName(await pickAudio()) } : {}) };
  const mime = typeof MediaRecorder === "undefined" ? undefined : WEBM_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
  return webmFormat(mime, hasAudio);
}

/** Mix the audio plan offline (decoded sources, speed, volume, fades). */
export async function mixAudio(segs: AudioSegment[], seconds: number, blobs: BlobStore, signal?: AbortSignal, output: Required<AudioOutput> = { mode: "stereo", environment: "room" }): Promise<AudioBuffer | undefined> {
  if (!segs.length || typeof OfflineAudioContext === "undefined") return undefined;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * RATE)), RATE);
  const decoded = new Map<string, Promise<AudioBuffer | undefined>>();
  const decode = (k: string) => {
    if (!decoded.has(k)) decoded.set(k, blobs.get(k).then((b) => b?.arrayBuffer()).then((ab) => (ab ? ctx.decodeAudioData(ab) : undefined)).catch(() => undefined));
    return decoded.get(k)!;
  };
  for (const s of segs) {
    abortIf(signal);
    const buf = await decode(s.blobKey);
    if (!buf) continue;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = s.rate;
    const g = ctx.createGain(); g.gain.value = s.volume;
    for (const e of gainEvents(s)) { if (e.type === "set") g.gain.setValueAtTime(e.value, e.at); else g.gain.linearRampToValueAtTime(e.value, e.at); }
    // P3B-11: the volume curve on a second gain, then the clip's effect chain (same builder as the preview).
    const kg = ctx.createGain();
    for (const e of keyEvents(s)) { if (e.type === "set") kg.gain.setValueAtTime(e.value, e.at); else kg.gain.linearRampToValueAtTime(e.value, e.at); }
    const fxData = s.fx ? audioFxData(s.fx.preset) : undefined;
    const chain = fxData ? buildFxChain(ctx, fxData, s.fx!.amount, s.start) : undefined;
    src.connect(g).connect(kg);
    // P14-SPATIAL: position stage last (same builder as the preview); absent = straight to the speakers.
    const dest: AudioNode = s.spatial ? spatialStage(ctx, s, output) : ctx.destination;
    if (chain) { kg.connect(chain.input); chain.output.connect(dest); } else kg.connect(dest);
    src.start(s.start, s.offset, s.duration * s.rate);
  }
  return ctx.startRendering();
}

function spatialStage(ctx: BaseAudioContext, s: AudioSegment, output: Required<AudioOutput>): AudioNode {
  const st = buildSpatial(ctx, output.mode, output.environment);
  spatialEvents(s).forEach((e, i) => st.set(e.pos, e.at, i ? "ramp" : "set"));
  st.output.connect(ctx.destination);
  return st.input;
}

export async function exportProject(project: Project, blobs: BlobStore, o: ExportOptions): Promise<ExportResult> {
  const { width, height } = exportSize(o.res, project.settings);
  const fps = project.settings.fps;
  const seconds = exportDuration(project);
  if (seconds <= 0) throw new Error("The timeline is empty — add a clip first.");
  o.onProgress?.({ stage: "audio", done: 0, total: 1 });
  const audio = await mixAudio(audioPlan(project), seconds, blobs, o.signal, audioOutputOf(project));
  abortIf(o.signal);
  await loadBundledFonts(); // P7-FONTS: every exported frame uses the bundled faces, as the preview does
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const player = new Player(project, blobs, still);
  player.canvas = canvas;
  player.offline = true;
  player.exportVideo = new ExportVideoFrames((k) => blobs.get(k));
  const check = () => stopOnBlankVideo(project, player);
  try {
    const avc = o.forceWebm ? undefined : await pickAvc(width, height, fps);
    const r = avc
      ? await toMp4(player, canvas, avc, audio, frameTimes(Math.round(seconds * 120_000), fps), fps, o, check)
      : await toWebm(player, canvas, audio, frameTimes(Math.round(seconds * 120_000), fps), fps, o, check);
    const warnings = frameWarnings(project, player.frameIssues, player.videoStats);
    return warnings.length ? { ...r, warnings } : r;
  } finally { player.dispose(); }
}

async function toMp4(player: Player, canvas: HTMLCanvasElement, cfg: VideoEncoderConfig, audio: AudioBuffer | undefined, times: number[], fps: number, o: ExportOptions, check: () => void): Promise<ExportResult> {
  // AAC first; Opus-in-MP4 where AAC is unavailable (e.g. Chromium without proprietary codecs).
  const aCfg = audio ? await pickAudio() : undefined;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: "in-memory", video: { codec: "avc", width: cfg.width, height: cfg.height, frameRate: fps }, ...(aCfg ? { audio: { codec: aCfg.codec === "opus" ? ("opus" as const) : ("aac" as const), numberOfChannels: 2, sampleRate: RATE } } : {}) });
  let failure: unknown;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
  venc.configure(cfg);
  try {
  for (let i = 0; i < times.length; i++) {
    abortIf(o.signal);
    if (failure) throw failure;
    await player.renderAt(times[i]);
    check();
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    o.onProgress?.({ stage: "video", done: i + 1, total: times.length });
  }
  } catch (e) {
    // Free the hardware encoder on abort or a hard export error (e.g. a clip with no picture).
    if (venc.state !== "closed") venc.close();
    throw e;
  }
  o.onProgress?.({ stage: "finalize", done: 0, total: 1 });
  await venc.flush(); venc.close();
  if (aCfg && audio) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure(aCfg);
    const n = Math.min(audio.length, Math.round((times.length / fps) * RATE));
    const l = audio.getChannelData(0), r = audio.getChannelData(1);
    for (let at = 0; at < n; at += 4096) {
      const len = Math.min(4096, n - at), data = new Float32Array(len * 2);
      data.set(l.subarray(at, at + len)); data.set(r.subarray(at, at + len), len);
      const ad = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / RATE), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }
  if (failure) throw failure;
  muxer.finalize();
  const format: ExportFormat = { ext: "mp4", video: "H.264", ...(audio ? { audio: audioName(aCfg) } : {}) };
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), ext: "mp4", format, note: formatNote(format) };
}

/** Fallback: real-time capture (frames paced to the wall clock) with the pre-mixed audio played into the recorder. */
async function toWebm(player: Player, canvas: HTMLCanvasElement, audio: AudioBuffer | undefined, times: number[], fps: number, o: ExportOptions, check: () => void): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream) throw new Error("This browser can't export video (no WebCodecs or MediaRecorder).");
  const stream = canvas.captureStream(0);
  const vt = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const ac = audio ? new AudioContext({ sampleRate: RATE }) : undefined;
  let src: AudioBufferSourceNode | undefined;
  if (ac && audio) { const dest = ac.createMediaStreamDestination(); src = ac.createBufferSource(); src.buffer = audio; src.connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); }
  const mime = WEBM_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  await player.renderAt(0);
  rec.start(1000); src?.start();
  const t0 = performance.now();
  try {
    for (let i = 0; i < times.length; i++) {
      abortIf(o.signal);
      await player.renderAt(times[i]);
      check();
      const wait = t0 + (i * 1000) / fps - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      vt.requestFrame?.();
      o.onProgress?.({ stage: "video", done: i + 1, total: times.length });
    }
  } finally { rec.stop(); src?.stop(); await stopped; void ac?.close(); stream.getTracks().forEach((t) => t.stop()); }
  const format = webmFormat(rec.mimeType || mime, !!audio);
  return { blob: new Blob(parts, { type: "video/webm" }), ext: "webm", format, note: formatNote(format) };
}

const clipName = (project: Project, id: string, fallback: string) => {
  const p = project.compositions[project.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === id);
  return { name: (p && project.assets[p.source.assetId]?.name) || fallback, at: p ? p.startTicks / 120_000 : 0 };
};

/** How to get a clip through export when this browser can't decode it. */
export function decodeAdvice(reason: string): string {
  return /HEVC|H\.265|hvc1|hev1/i.test(reason)
    ? "Re-import it as H.264 MP4 (on iPhone: Settings › Camera › Formats › Most Compatible, or convert it first), or export on a device that plays HEVC (desktop Safari/Chrome on a recent Mac or PC)."
    : "Re-import it as an H.264 MP4, or try exporting in desktop Chrome.";
}

/** A video clip whose first frames all came out without a picture stops the export with a message naming it, rather than writing black. */
export function stopOnBlankVideo(project: Project, player: Pick<Player, "videoStats" | "exportVideo">) {
  for (const [id, s] of player.videoStats) {
    if (s.frames < 3 || s.blank < s.frames) continue;
    const { name, at } = clipName(project, id, "a video clip");
    const why = [player.exportVideo?.reasons.get(id), s.detail].filter(Boolean).join("; ");
    throw new Error(`The video clip "${name}" (at ${at.toFixed(1)} s on the timeline) has no picture in this browser — ${why || "no frame could be decoded"}. ${decodeAdvice(why)}`);
  }
}

/** One line per clip whose frames timed out, were rejected (HTML clips) or had no picture (video clips). */
export function frameWarnings(project: Project, issues: { placementId: string; t: number; issue: "timeout" | "invalid" | "blank" }[], videoStats?: Player["videoStats"]): string[] {
  const by = new Map<string, { timeout: number; invalid: number; blank: number; first: number }>();
  for (const i of issues) {
    const e = by.get(i.placementId) ?? { timeout: 0, invalid: 0, blank: 0, first: i.t };
    e[i.issue] += 1; e.first = Math.min(e.first, i.t);
    by.set(i.placementId, e);
  }
  return [...by].map(([id, e]) => {
    const name = clipName(project, id, e.blank ? "Video clip" : "HTML clip").name;
    const s = (n: number) => (n > 1 ? "s" : "");
    const what = [e.timeout && `${e.timeout} frame${s(e.timeout)} timed out (4 s)`, e.invalid && `${e.invalid} invalid frame${s(e.invalid)}`, e.blank && `${e.blank} frame${s(e.blank)} had no picture${videoStats?.get(id)?.detail ? ` (${videoStats.get(id)!.detail})` : ""}`].filter(Boolean).join(", ");
    return `${name}: ${what}, first at ${(e.first / 120_000).toFixed(2)} s. ${e.blank ? "Those frames show what is underneath the clip." : "Those frames reuse the last good image (or are blank)."}`;
  });
}
