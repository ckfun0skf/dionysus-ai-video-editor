/** Export: offline frame-by-frame render → WebCodecs H.264/AAC MP4, or a real-time MediaRecorder WebM fallback. */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Project } from "../../domain/model";
import type { BlobStore } from "../../ports/storage";
import { Player } from "../player";
import { audioPlan, exportDuration, exportSize, frameTimes, type AudioSegment, type Resolution } from "./plan";

export interface ExportProgress { stage: "audio" | "video" | "finalize"; done: number; total: number }
export interface ExportResult { blob: Blob; ext: "mp4" | "webm"; note?: string; warnings?: string[] }
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

/** Mix the audio plan offline (decoded sources, speed, volume, fades). */
export async function mixAudio(segs: AudioSegment[], seconds: number, blobs: BlobStore, signal?: AbortSignal): Promise<AudioBuffer | undefined> {
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
    if (s.fadeIn) { g.gain.setValueAtTime(0, s.start); g.gain.linearRampToValueAtTime(s.volume, s.start + s.fadeIn); }
    if (s.fadeOut) { g.gain.setValueAtTime(s.volume, s.start + s.duration - s.fadeOut); g.gain.linearRampToValueAtTime(0, s.start + s.duration); }
    src.connect(g).connect(ctx.destination);
    src.start(s.start, s.offset, s.duration * s.rate);
  }
  return ctx.startRendering();
}

export async function exportProject(project: Project, blobs: BlobStore, o: ExportOptions): Promise<ExportResult> {
  const { width, height } = exportSize(o.res, project.settings);
  const fps = project.settings.fps;
  const seconds = exportDuration(project);
  if (seconds <= 0) throw new Error("The timeline is empty — add a clip first.");
  o.onProgress?.({ stage: "audio", done: 0, total: 1 });
  const audio = await mixAudio(audioPlan(project), seconds, blobs, o.signal);
  abortIf(o.signal);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const player = new Player(project, blobs, still);
  player.canvas = canvas;
  try {
    const avc = o.forceWebm ? undefined : await pickAvc(width, height, fps);
    const r = avc
      ? await toMp4(player, canvas, avc, audio, frameTimes(Math.round(seconds * 120_000), fps), fps, o)
      : await toWebm(player, canvas, audio, frameTimes(Math.round(seconds * 120_000), fps), fps, o);
    const warnings = frameWarnings(project, player.frameIssues);
    return warnings.length ? { ...r, warnings } : r;
  } finally { player.dispose(); }
}

async function toMp4(player: Player, canvas: HTMLCanvasElement, cfg: VideoEncoderConfig, audio: AudioBuffer | undefined, times: number[], fps: number, o: ExportOptions): Promise<ExportResult> {
  const aCfg: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 192_000 };
  // AAC first; Opus-in-MP4 where AAC is unavailable (e.g. Chromium without proprietary codecs).
  const ok = async (c: AudioEncoderConfig) => typeof AudioEncoder !== "undefined" && !!(await AudioEncoder.isConfigSupported(c).catch(() => ({ supported: false }))).supported;
  if (audio && !(await ok(aCfg))) aCfg.codec = "opus";
  const aac = !!audio && (await ok(aCfg));
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: "in-memory", video: { codec: "avc", width: cfg.width, height: cfg.height, frameRate: fps }, ...(aac ? { audio: { codec: aCfg.codec === "opus" ? ("opus" as const) : ("aac" as const), numberOfChannels: 2, sampleRate: RATE } } : {}) });
  let failure: unknown;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
  venc.configure(cfg);
  for (let i = 0; i < times.length; i++) {
    abortIf(o.signal);
    if (failure) throw failure;
    await player.renderAt(times[i]);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    o.onProgress?.({ stage: "video", done: i + 1, total: times.length });
  }
  o.onProgress?.({ stage: "finalize", done: 0, total: 1 });
  await venc.flush(); venc.close();
  if (aac && audio) {
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
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), ext: "mp4", note: audio && !aac ? "This browser can't encode MP4 audio, so the file is silent." : undefined };
}

/** Fallback: real-time capture (frames paced to the wall clock) with the pre-mixed audio played into the recorder. */
async function toWebm(player: Player, canvas: HTMLCanvasElement, audio: AudioBuffer | undefined, times: number[], fps: number, o: ExportOptions): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream) throw new Error("This browser can't export video (no WebCodecs or MediaRecorder).");
  const stream = canvas.captureStream(0);
  const vt = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const ac = audio ? new AudioContext({ sampleRate: RATE }) : undefined;
  let src: AudioBufferSourceNode | undefined;
  if (ac && audio) { const dest = ac.createMediaStreamDestination(); src = ac.createBufferSource(); src.buffer = audio; src.connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t)); }
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
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
      const wait = t0 + (i * 1000) / fps - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      vt.requestFrame?.();
      o.onProgress?.({ stage: "video", done: i + 1, total: times.length });
    }
  } finally { rec.stop(); src?.stop(); await stopped; void ac?.close(); stream.getTracks().forEach((t) => t.stop()); }
  return { blob: new Blob(parts, { type: "video/webm" }), ext: "webm", note: "This browser has no H.264 encoder, so the export is WebM (recorded in real time)." };
}

/** One line per HTML clip whose frames timed out or were rejected; the export used the last good frame. */
export function frameWarnings(project: Project, issues: { placementId: string; t: number; issue: "timeout" | "invalid" }[]): string[] {
  const by = new Map<string, { timeout: number; invalid: number; first: number }>();
  for (const i of issues) {
    const e = by.get(i.placementId) ?? { timeout: 0, invalid: 0, first: i.t };
    e[i.issue] += 1; e.first = Math.min(e.first, i.t);
    by.set(i.placementId, e);
  }
  const comp = project.compositions[project.rootCompositionId];
  return [...by].map(([id, e]) => {
    const p = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === id);
    const name = (p && project.assets[p.source.assetId]?.name) ?? "HTML clip";
    const what = [e.timeout && `${e.timeout} frame${e.timeout > 1 ? "s" : ""} timed out (4 s)`, e.invalid && `${e.invalid} invalid frame${e.invalid > 1 ? "s" : ""}`].filter(Boolean).join(", ");
    return `${name}: ${what}, first at ${(e.first / 120_000).toFixed(2)} s. Those frames reuse the last good image (or are blank).`;
  });
}
