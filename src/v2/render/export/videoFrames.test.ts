import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codecLabel, demuxVideo, ExportVideoFrames, keyBefore, matrixRotation, openVideo, sampleAt, TrackDecoder, type DemuxedVideo, type VSample } from "./videoFrames";

const fixture = (name: string) => {
  const b = readFileSync(resolve(__dirname, "__fixtures__", name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/**
 * Minimal stand-in for WebCodecs' VideoDecoder: like a real decoder it reorders B-frames and emits frames in
 * presentation order (holding up to `reorder` frames until more input or flush arrives).
 */
class FakeDecoder {
  static log: { configured: number; fed: number[] }[] = [];
  static supported = true;
  static async isConfigSupported() { return { supported: FakeDecoder.supported }; }
  state = "unconfigured";
  decodeQueueSize = 0;
  private held: number[] = [];
  private entry = { configured: 0, fed: [] as number[] };
  constructor(private init: { output: (f: unknown) => void; error: (e: unknown) => void }) { FakeDecoder.log.push(this.entry); }
  configure() { this.state = "configured"; this.entry.configured++; }
  decode(c: { timestamp: number; type: string }) {
    if (!this.entry.fed.length && c.type !== "key") throw new Error("first chunk after configure must be a key frame");
    this.entry.fed.push(c.timestamp);
    this.held.push(c.timestamp); this.held.sort((a, b) => a - b);
    if (this.held.length > 3) this.emit(this.held.shift()!);
  }
  async flush() { while (this.held.length) this.emit(this.held.shift()!); }
  close() { this.state = "closed"; }
  private emit(ts: number) { this.init.output({ timestamp: ts, displayWidth: 64, displayHeight: 64, close: () => undefined }); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeDecoder.log = []; FakeDecoder.supported = true; });
const stubWebCodecs = () => { vi.stubGlobal("VideoDecoder", FakeDecoder); vi.stubGlobal("EncodedVideoChunk", class { constructor(o: object) { Object.assign(this, o); } }); };

describe("export video frames (WebCodecs path)", () => {
  it("picks the sample presented at a time, in presentation order, and its key frame", () => {
    // decode order I0 P3 B1 B2 | I4 ...  (pts in µs)
    const s: VSample[] = [0, 3, 1, 2, 4, 5].map((n, i) => ({ pts: n * 100_000, dur: 100_000, sync: i === 0 || i === 4, offset: 0, size: 1 }));
    const byPts = s.map((_, i) => i).sort((a, b) => s[a].pts - s[b].pts);
    expect(sampleAt(s, byPts, 0)).toBe(0);
    expect(sampleAt(s, byPts, 150_000)).toBe(2); // B1 is shown from 0.1 s to 0.2 s
    expect(sampleAt(s, byPts, 199_700)).toBe(3); // within 0.5 ms of B2's start: rounding must not show the previous frame
    expect(sampleAt(s, byPts, 300_000)).toBe(1);
    expect(sampleAt(s, byPts, -5)).toBe(0);
    expect(sampleAt(s, byPts, 9e9)).toBe(5);
    expect(keyBefore(s, 3)).toBe(0);
    expect(keyBefore(s, 5)).toBe(4);
  });

  it("reads track rotation from the display matrix (iPhone portrait = 90° clockwise)", () => {
    const F = 65536;
    expect(matrixRotation([F, 0, 0, 0, F, 0, 0, 0, 1 << 30])).toBe(0);
    expect(matrixRotation([0, F, 0, -F, 0, 0, 0, 0, 1 << 30])).toBe(90);
    expect(matrixRotation([-F, 0, 0, 0, -F, 0, 0, 0, 1 << 30])).toBe(180);
    expect(matrixRotation([0, -F, 0, F, 0, 0, 0, 0, 1 << 30])).toBe(270);
    expect(matrixRotation(undefined)).toBe(0);
  });

  it("demuxes an H.264 MP4 with B-frames into exact presentation timestamps, key frames and decoder config", () => {
    const d = demuxVideo(fixture("avc_bframes.mp4")) as DemuxedVideo;
    expect(typeof d).toBe("object");
    expect(d.codec).toMatch(/^avc1\./);
    expect(d.config).toMatchObject({ codec: d.codec, codedWidth: 64, codedHeight: 64 });
    expect((d.config.description as Uint8Array)[0]).toBe(1); // AVCDecoderConfigurationRecord version
    expect(d.samples).toHaveLength(12);
    // Edit list applied: the first frame is presented at 0, then every 100 ms.
    expect(d.samples.map((s) => s.pts).sort((a, b) => a - b)).toEqual([...Array(12)].map((_, i) => i * 100_000));
    expect(d.samples.filter((s) => s.sync).map((s) => s.pts)).toEqual([0, 400_000, 800_000]);
    expect(d.rotation).toBe(0);
    expect((demuxVideo(fixture("rot90.mp4")) as DemuxedVideo).rotation).toBe(270); // ffmpeg display_rotation=90 is counter-clockwise
    expect(codecLabel((demuxVideo(fixture("hevc.mp4")) as DemuxedVideo).codec)).toBe("HEVC / H.265");
    expect(demuxVideo(new TextEncoder().encode("definitely not a video file").buffer as ArrayBuffer)).toMatch(/MP4\/MOV/);
  });

  it("returns the exact frame for every timestamp, decoding forward and restarting at the key frame only when needed", async () => {
    stubWebCodecs();
    const d = demuxVideo(fixture("avc_bframes.mp4")) as DemuxedVideo;
    const dec = new TrackDecoder(d, 2000);
    const ts = async (sec: number) => ((await dec.frameAt(sec)).image as unknown as VideoFrame).timestamp;
    for (let i = 0; i < 12; i++) expect(await ts(i / 10)).toBe(i * 100_000); // sequential export: every frame exact
    expect(FakeDecoder.log).toHaveLength(1); // ... from one decoder session
    expect(await ts(0.55)).toBe(500_000); // seek back: restart at the key frame before 0.5 s (0.4 s)
    expect(FakeDecoder.log).toHaveLength(2);
    expect(FakeDecoder.log[1].fed[0]).toBe(400_000);
    expect(await ts(0.5)).toBe(500_000); // same frame: no work
    expect(await ts(0.9)).toBe(900_000); // forward across a key frame continues the session
    expect(FakeDecoder.log).toHaveLength(2);
    expect(await ts(30)).toBe(1_100_000); // past the end holds the last frame
    dec.close();
  });

  it("explains why a clip can't use WebCodecs (no decoder, unsupported codec such as HEVC on Android)", async () => {
    const blob = (n: string) => new Blob([fixture(n)]);
    expect(await openVideo(blob("avc_bframes.mp4"))).toBe("this browser has no WebCodecs video decoder");
    stubWebCodecs();
    FakeDecoder.supported = false;
    expect(await openVideo(blob("hevc.mp4"))).toMatch(/^HEVC \/ H\.265 \(hvc1\.[^)]*\) can't be decoded by this browser$/);
    FakeDecoder.supported = true;
    expect(typeof (await openVideo(blob("avc_bframes.mp4")))).toBe("object");

    const frames = new ExportVideoFrames(async (k) => (k === "missing" ? undefined : blob("avc_bframes.mp4")));
    expect(await frames.prepare("a", "missing", 0)).toBe(false);
    expect(frames.reasons.get("a")).toMatch(/missing/);
    expect(await frames.prepare("b", "clip", 0.3)).toBe(true);
    expect(frames.handles("b")).toBe(true);
    expect((frames.frame("b")!.image as unknown as VideoFrame).timestamp).toBe(300_000);
    frames.retain(new Set()); // off screen: decoder released
    expect(frames.handles("b")).toBe(false);
    frames.dispose();
  });
});
