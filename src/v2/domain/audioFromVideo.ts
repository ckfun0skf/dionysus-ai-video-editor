/**
 * P18: Add audio → From Video. Pure helpers: spotting an audio track in a video file's bytes (MP4/MOV "soun" handler,
 * WebM/Matroska "A_" codec), clamping the in/out span, and the audio asset + timeline placement that carry the
 * provenance { fromVideo, inSec, outSec }. Decoding to WAV happens in the UI (Web Audio); when it fails the new audio
 * version references the video's own file (the timeline then plays the video's sound from `inSec`).
 */
import { newId, type Asset, type AssetVersion, type FromVideo, type MediaRef, type Placement } from "./model";
import { secondsToTicks, TICKS_PER_SECOND } from "./time";

const ascii = (b: Uint8Array, i: number, s: string) => { for (let k = 0; k < s.length; k += 1) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };

/**
 * Whether the bytes (the whole file, or its head and tail joined) hold an audio track: true / false when the container
 * says so, undefined when it can't tell (unknown container, or the track table wasn't in the bytes given).
 */
export function detectAudioTrack(bytes: Uint8Array): boolean | undefined {
  const n = bytes.length;
  if (n >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    let video = false;
    for (let i = 0; i + 3 < n; i += 1) {
      if (bytes[i] !== 0x86) continue; // Matroska CodecID element
      const len = bytes[i + 1] & 0x7f; // 1-byte EBML size (0x80 | len)
      if ((bytes[i + 1] & 0x80) === 0 || len < 3 || len > 32) continue;
      if (ascii(bytes, i + 2, "A_")) return true;
      if (ascii(bytes, i + 2, "V_")) video = true;
    }
    return video ? false : undefined;
  }
  let handlers = 0;
  for (let i = 4; i + 16 <= n; i += 1) {
    if (bytes[i] !== 0x68 || !ascii(bytes, i, "hdlr")) continue;
    handlers += 1;
    if (ascii(bytes, i + 12, "soun")) return true;
  }
  return handlers ? false : undefined;
}

/** Clamp an in/out span (seconds) to a video of `durationSec`; at least 0.1 s long. */
export function clampSpan(inSec: number, outSec: number, durationSec?: number): { inSec: number; outSec: number } {
  const max = durationSec && durationSec > 0 ? durationSec : Math.max(inSec, outSec, 0.1);
  const r = (x: number) => Math.round(x * 100) / 100;
  const i = r(Math.min(Math.max(0, inSec), Math.max(0, max - 0.1)));
  const o = r(Math.min(max, Math.max(i + 0.1, outSec)));
  return { inSec: i, outSec: o };
}

/** "Clip name (audio)" plus the span when it isn't the whole video. */
export function audioFromVideoName(name: string, span: { inSec: number; outSec: number }, durationSec?: number): string {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "");
  const whole = span.inSec <= 0 && (!durationSec || span.outSec >= durationSec - 0.01);
  const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return whole ? `${base} (audio)` : `${base} (audio ${t(span.inSec)}–${t(span.outSec)})`;
}

/**
 * The audio asset for a From Video add. `extracted` is the decoded WAV's media (stored at `ids.assetId/ids.versionId`);
 * without it the version references the video's file and plays from `inSec`.
 */
export function audioFromVideo(video: Asset, version: AssetVersion, span: { inSec: number; outSec: number }, extracted?: MediaRef, ids = { assetId: newId("ast"), versionId: newId("ver") }): { asset: Asset; sourceInTicks: number; durationTicks: number } {
  const fromVideo: FromVideo = { assetId: video.id, inSec: span.inSec, outSec: span.outSec, ...(extracted ? {} : { referenced: true as const }) };
  const durationTicks = Math.max(1, secondsToTicks(span.outSec - span.inSec));
  const media: MediaRef = extracted ?? { blobKey: version.media.blobKey, mime: version.media.mime, ...(version.media.durationTicks ? { durationTicks: version.media.durationTicks } : {}) };
  const asset: Asset = {
    id: ids.assetId, kind: "audio", name: audioFromVideoName(video.name, span, version.media.durationTicks ? version.media.durationTicks / TICKS_PER_SECOND : undefined), selectedVersionId: ids.versionId,
    versions: [{ id: ids.versionId, createdAt: new Date().toISOString(), media, provenance: { source: "derived", inputs: [{ assetId: video.id, versionId: version.id }], fromVideo } }],
  };
  return { asset, sourceInTicks: extracted ? 0 : secondsToTicks(span.inSec), durationTicks: extracted?.durationTicks ? Math.min(durationTicks, extracted.durationTicks) : durationTicks };
}

/** The audio placement at `startTicks` for an asset made by `audioFromVideo`. */
export function audioFromVideoPlacement(r: { asset: Asset; sourceInTicks: number; durationTicks: number }, startTicks: number): Placement {
  const v = r.asset.versions[0];
  return { id: newId("plc"), startTicks, durationTicks: r.durationTicks, sourceInTicks: r.sourceInTicks, source: { kind: "assetVersion", assetId: r.asset.id, versionId: v.id }, clipType: "audio", volume: 1 };
}
