/**
 * Export video frames through WebCodecs: demux MP4/MOV with mp4box and decode with VideoDecoder, so every
 * export frame is the exact decoded source frame for its timestamp. This avoids HTMLVideoElement seeking,
 * which on Android Chrome (and intermittently elsewhere) resolves `seeked` without a frame the canvas can
 * draw, leaving video layers black in the export.
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie } from "mp4box";

/** One encoded sample, in decode order. Times are microseconds of presentation time. */
export interface VSample { pts: number; dur: number; sync: boolean; offset: number; size: number }
export interface DemuxedVideo { codec: string; config: VideoDecoderConfig; samples: VSample[]; data: ArrayBuffer; rotation: 0 | 90 | 180 | 270 }
export interface DrawableFrame { image: CanvasImageSource; width: number; height: number }

/** Decode-order index of the sample shown at `us` (the last one presented at or before it; the first one before the start). */
export function sampleAt(samples: VSample[], byPts: number[], us: number): number {
  let lo = 0, hi = byPts.length - 1, best = byPts[0];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[byPts[mid]].pts <= us + 500) { best = byPts[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Decode-order index of the last sync sample at or before decode index `i`. */
export function keyBefore(samples: VSample[], i: number): number {
  for (let k = i; k >= 0; k--) if (samples[k].sync) return k;
  return 0;
}

/** Clockwise display rotation from a track matrix (16.16 fixed point), snapped to 90°. */
export function matrixRotation(m: ArrayLike<number> | undefined): 0 | 90 | 180 | 270 {
  if (!m || m.length < 4) return 0;
  const deg = Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI / 90) * 90;
  return (((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Parse the first video track of an MP4/MOV. Returns a reason string when the file can't be demuxed. */
export function demuxVideo(buf: ArrayBuffer): DemuxedVideo | string {
  const file = createFile();
  let info: Movie | undefined, err: string | undefined;
  file.onReady = (i) => { info = i; };
  file.onError = (_m, msg) => { err = msg; };
  const mb = MP4BoxBuffer.fromArrayBuffer(buf, 0);
  try { file.appendBuffer(mb); file.flush(); } catch (e) { return `not an MP4/MOV file (${e instanceof Error ? e.message : String(e)})`; }
  if (!info) return err ? `not a readable MP4/MOV file (${err})` : "not an MP4/MOV file";
  const track = info.videoTracks[0];
  if (!track) return "the file has no video track";
  const trak = file.getTrackById(track.id);
  const raw = trak?.samples ?? [];
  if (!raw.length) return "the video track has no frames";
  const ts = raw[0].timescale || track.timescale;
  // Edit list: leading empty edits delay the track; the first real edit's media_time is where it starts.
  let delay = 0, shift = 0;
  for (const e of trak.edts?.elst?.entries ?? []) {
    if (e.media_time === -1) { delay += e.segment_duration / (track.movie_timescale || 1); continue; }
    shift = e.media_time; break;
  }
  const samples = raw.map((s) => ({ pts: Math.round(((s.cts - shift) / ts + delay) * 1e6), dur: Math.max(1, Math.round((s.duration / ts) * 1e6)), sync: !!s.is_sync, offset: s.offset, size: s.size }));
  const entry = trak.mdia.minf.stbl.stsd.entries[0] as unknown as Record<string, { write(s: DataStream): void } | undefined>;
  const cbox = entry.avcC ?? entry.hvcC;
  let description: Uint8Array | undefined;
  if (cbox) { const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN); cbox.write(s); description = new Uint8Array(s.buffer, 8); }
  const width = track.video?.width || track.track_width, height = track.video?.height || track.track_height;
  const config: VideoDecoderConfig = { codec: track.codec.startsWith("vp08") ? "vp8" : track.codec, codedWidth: width, codedHeight: height, ...(description ? { description } : {}) };
  return { codec: track.codec, config, samples, data: mb, rotation: matrixRotation(track.matrix) };
}

/** A friendly codec name for messages. */
export function codecLabel(codec: string): string {
  const c = codec.slice(0, 4).toLowerCase();
  return c === "hvc1" || c === "hev1" ? "HEVC / H.265" : c === "avc1" || c === "avc3" ? "H.264" : c === "vp09" ? "VP9" : c === "av01" ? "AV1" : codec;
}

/** Sequential, frame-accurate decoder for one demuxed track. `frameAt` resolves the frame shown at `sec`. */
export class TrackDecoder {
  private dec?: VideoDecoder;
  private next = 0;
  private flushed = false;
  private queue: VideoFrame[] = [];
  private current?: VideoFrame;
  private wake?: () => void;
  private failure?: Error;
  private byPts: number[];
  private rot?: HTMLCanvasElement;
  constructor(private v: DemuxedVideo, private timeoutMs = 10_000) {
    this.byPts = v.samples.map((_, i) => i).sort((a, b) => v.samples[a].pts - v.samples[b].pts);
  }

  private open() {
    this.dec?.close();
    this.queue.forEach((f) => f.close()); this.queue = [];
    this.failure = undefined; this.flushed = false;
    const dec = new VideoDecoder({
      output: (f) => { if (dec !== this.dec) { f.close(); return; } this.queue.push(f); this.wake?.(); },
      error: (e) => { this.failure = e instanceof Error ? e : new Error(String(e)); this.wake?.(); },
    });
    dec.configure(this.v.config);
    this.dec = dec;
  }

  private feed(i: number) {
    const s = this.v.samples[i];
    this.dec!.decode(new EncodedVideoChunk({ type: s.sync ? "key" : "delta", timestamp: s.pts, duration: s.dur, data: new Uint8Array(this.v.data, s.offset, s.size) }));
  }

  private take(f: VideoFrame) { if (this.current !== f) this.current?.close(); this.current = f; }

  async frameAt(sec: number): Promise<DrawableFrame> {
    const { samples } = this.v;
    const idx = sampleAt(samples, this.byPts, Math.round(sec * 1e6));
    const pts = samples[idx].pts;
    if (this.current?.timestamp === pts) return this.drawable(this.current);
    const key = keyBefore(samples, idx);
    // Continue forward when the target is ahead and its key frame is already fed (or is next); else restart at the key frame.
    // After the end-of-track flush every remaining frame is already queued, so continuing is still valid.
    const forward = this.dec && !this.failure && (!this.current || this.current.timestamp < pts) && key <= this.next;
    if (!forward) { this.open(); this.next = key; }
    const deadline = Date.now() + this.timeoutMs;
    let fallback: VideoFrame | undefined;
    for (;;) {
      if (this.failure) throw this.failure;
      while (this.queue.length) {
        const f = this.queue[0];
        if (f.timestamp < pts) { this.queue.shift(); fallback?.close(); fallback = f; continue; }
        if (f.timestamp === pts) { this.queue.shift(); fallback?.close(); this.take(f); return this.drawable(f); }
        // Overshot (the target was dropped by the decoder): show the nearest earlier frame, or this one.
        if (fallback) { this.take(fallback); return this.drawable(fallback); }
        this.queue.shift(); this.take(f); return this.drawable(f);
      }
      if (Date.now() > deadline) { fallback?.close(); throw new Error(`video decoder timed out at ${sec.toFixed(2)} s`); }
      const dec = this.dec!;
      if (this.next < samples.length && dec.decodeQueueSize < 3) { this.feed(this.next++); continue; }
      if (this.next >= samples.length && !this.flushed) { this.flushed = true; await dec.flush().catch((e) => { this.failure ??= e instanceof Error ? e : new Error(String(e)); }); continue; }
      if (this.flushed && !this.queue.length) {
        if (fallback) { this.take(fallback); return this.drawable(fallback); }
        if (this.current) return this.drawable(this.current);
        throw new Error("the video decoder produced no frame");
      }
      await new Promise<void>((r) => { const t = setTimeout(() => { this.wake = undefined; r(); }, 20); this.wake = () => { clearTimeout(t); this.wake = undefined; r(); }; });
    }
  }

  private drawable(f: VideoFrame): DrawableFrame {
    const w = f.displayWidth, h = f.displayHeight;
    if (!this.v.rotation) return { image: f, width: w, height: h };
    const c = (this.rot ??= document.createElement("canvas"));
    const side = this.v.rotation === 180;
    c.width = side ? w : h; c.height = side ? h : w;
    const g = c.getContext("2d")!;
    g.save(); g.translate(c.width / 2, c.height / 2); g.rotate((this.v.rotation * Math.PI) / 180); g.drawImage(f, -w / 2, -h / 2, w, h); g.restore();
    return { image: c, width: c.width, height: c.height };
  }

  close() {
    this.queue.forEach((f) => f.close()); this.queue = [];
    this.current?.close(); this.current = undefined;
    if (this.dec && this.dec.state !== "closed") this.dec.close();
    this.dec = undefined;
  }
}

/** Why a blob can't go through WebCodecs, or the demuxed track ready to decode. */
export async function openVideo(blob: Blob): Promise<DemuxedVideo | string> {
  if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") return "this browser has no WebCodecs video decoder";
  const d = demuxVideo(await blob.arrayBuffer());
  if (typeof d === "string") return d;
  const ok = await VideoDecoder.isConfigSupported(d.config).then((r) => !!r.supported, () => false);
  return ok ? d : `${codecLabel(d.codec)} (${d.codec}) can't be decoded by this browser`;
}

/**
 * Export-time video frames for every video placement. Placements whose media can't use WebCodecs report
 * `reason` and fall back to the media element path (which is verified frame by frame in Player.renderAt).
 */
export class ExportVideoFrames {
  private tracks = new Map<string, Promise<DemuxedVideo | string>>();
  private decoders = new Map<string, { blobKey: string; dec: TrackDecoder }>();
  private frames = new Map<string, DrawableFrame>();
  /** placementId → why WebCodecs isn't used for it (element fallback). */
  readonly reasons = new Map<string, string>();
  constructor(private getBlob: (key: string) => Promise<Blob | undefined>) {}

  /** Decode the frame of `placementId` at `sec`. Returns false when the placement must use the element fallback. */
  async prepare(placementId: string, blobKey: string, sec: number): Promise<boolean> {
    if (this.reasons.has(placementId)) return false;
    if (!this.tracks.has(blobKey)) this.tracks.set(blobKey, this.getBlob(blobKey).then((b) => (b ? openVideo(b) : "the media file is missing from this device's storage"), (e) => `the media could not be read (${String(e)})`));
    const t = await this.tracks.get(blobKey)!;
    if (typeof t === "string") { this.reasons.set(placementId, t); return false; }
    let d = this.decoders.get(placementId);
    if (d?.blobKey !== blobKey) { d?.dec.close(); d = { blobKey, dec: new TrackDecoder(t) }; this.decoders.set(placementId, d); }
    try { this.frames.set(placementId, await d.dec.frameAt(sec)); return true; }
    catch (e) {
      d.dec.close(); this.decoders.delete(placementId); this.frames.delete(placementId);
      this.reasons.set(placementId, `the WebCodecs decoder failed (${e instanceof Error ? e.message : String(e)})`);
      return false;
    }
  }

  frame(placementId: string): DrawableFrame | undefined { return this.reasons.has(placementId) ? undefined : this.frames.get(placementId); }
  handles(placementId: string) { return this.frames.has(placementId) && !this.reasons.has(placementId); }

  /** Close decoders of placements that are no longer on screen (hardware decoders are scarce on phones). */
  retain(live: Set<string>) {
    for (const [id, d] of this.decoders) if (!live.has(id)) { d.dec.close(); this.decoders.delete(id); this.frames.delete(id); }
  }

  dispose() { this.decoders.forEach((d) => d.dec.close()); this.decoders.clear(); this.frames.clear(); }
}
