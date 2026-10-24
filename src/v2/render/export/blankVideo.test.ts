// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../domain";
import type { Placement, Project } from "../../domain/model";
import { Player } from "../player";
import { frameWarnings, stopOnBlankVideo } from "./encode";
import type { ExportVideoFrames } from "./videoFrames";

/**
 * Regression for V2-BUG-EXPORT-BLACK: on Android Chrome the export's <video> elements report a seeked,
 * "ready" state but never present a frame the canvas can draw, so video clips were exported as black
 * while audio, images and text were fine. The export must keep the elements in the DOM, nudge them to
 * decode, and stop with a message naming the clip instead of silently writing black frames.
 */
const T = 120_000;
const still = { kind: "wall" as const, now: () => 0 };

function project(): Project {
  const p = createProject("blank-video");
  p.assets.v = { id: "v", kind: "video", name: "beach.mp4", versions: [{ id: "v1", createdAt: "", media: { blobKey: "vb", mime: "video/mp4" }, provenance: { source: "import", inputs: [] } }] } as never;
  p.compositions[p.rootCompositionId].tracks[0].placements = [{ id: "pv", startTicks: 2 * T, durationTicks: 3 * T, sourceInTicks: T, clipType: "video", source: { kind: "assetVersion", assetId: "v", versionId: "v1" } } as Placement];
  return p;
}
const blobs = { get: async () => new Blob(["x"], { type: "video/mp4" }) } as never;

/** Media element behaviour under test: `decodes()` decides whether drawImage gets a picture. */
let media: { decodes: () => boolean; error: { code: number; message: string } | null; plays: number };
beforeEach(() => {
  media = { decodes: () => false, error: null, plays: 0 };
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test/1", revokeObjectURL: () => undefined }));
  const P = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  const define = (k: string, get: () => unknown) => Object.defineProperty(P, k, { configurable: true, get });
  define("readyState", () => 4); // the browser claims it has the frame...
  define("seeking", () => false);
  define("videoWidth", () => 640);
  define("videoHeight", () => 360);
  define("error", () => media.error);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => { media.plays++; } });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => true });
  // ...but drawing it yields transparent pixels unless it really decoded.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    clearRect() {}, drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(64).fill(media.decodes() ? 255 : 0) }),
  })) as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const k of ["readyState", "seeking", "videoWidth", "videoHeight", "error"]) delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[k]; });

async function exportFrames(p: Project, from: number, n: number, exportVideo?: Partial<ExportVideoFrames>) {
  const player = new Player(p, blobs, still);
  player.offline = true;
  if (exportVideo) player.exportVideo = exportVideo as ExportVideoFrames;
  try {
    for (let i = 0; i < n; i++) { await player.renderAt(from + (i * T) / 30); stopOnBlankVideo(p, player); }
    return { player, error: undefined as Error | undefined };
  } catch (e) { return { player, error: e as Error }; }
}

describe("export of video clips that never present a frame (Android Chrome)", () => {
  it("fails loudly naming the clip instead of exporting black", async () => {
    const p = project();
    const { player, error } = await exportFrames(p, 2 * T, 5);
    expect(error?.message).toMatch(/^The video clip "beach\.mp4" \(at 2\.0 s on the timeline\) has no picture in this browser — the browser returned no picture for it\. Re-import it as an H\.264 MP4/);
    expect(media.plays).toBeGreaterThan(0); // it tried a muted play/pause nudge first
    // The element is kept in the document (mobile browsers don't decode detached/display:none video).
    const el = document.querySelector("video")!;
    expect(el).not.toBeNull();
    expect(el.muted).toBe(true);
    expect(getComputedStyle(el.parentElement!).display).not.toBe("none");
    player.dispose();
    expect(document.querySelector("video")).toBeNull();
  });

  it("exports normally once the nudge makes the element decode", async () => {
    media.decodes = () => media.plays > 0;
    const p = project();
    const { player, error } = await exportFrames(p, 2 * T, 5);
    expect(error).toBeUndefined();
    expect(player.videoStats.get("pv")).toMatchObject({ frames: 5, blank: 0 });
    expect(frameWarnings(p, player.frameIssues, player.videoStats)).toEqual([]);
    player.dispose();
  });

  it("names the codec problem when the browser can't play the file (e.g. HEVC on Android)", async () => {
    media.error = { code: 4, message: "DEMUXER_ERROR_NO_SUPPORTED_STREAMS" };
    const reasons = new Map([["pv", "HEVC / H.265 (hvc1.1.6.L93.B0) can't be decoded by this browser"]]);
    const p = project();
    const { error } = await exportFrames(p, 2 * T, 5, { reasons, prepare: async () => false, handles: () => false, frame: () => undefined, retain: () => undefined, dispose: () => undefined });
    expect(error?.message).toContain('"beach.mp4"');
    expect(error?.message).toContain("HEVC / H.265 (hvc1.1.6.L93.B0) can't be decoded by this browser; the browser can't play it (DEMUXER_ERROR_NO_SUPPORTED_STREAMS)");
    expect(error?.message).toContain("Most Compatible");
  });

  it("reports clips that lose their picture part-way as export warnings", async () => {
    let n = 0;
    media.decodes = () => n < 6; // fine for the first frames, then nothing
    const p = project();
    const player = new Player(p, blobs, still);
    player.offline = true;
    for (let i = 0; i < 6; i++) { n = i * 2; await player.renderAt(2 * T + (i * T) / 30); stopOnBlankVideo(p, player); }
    expect(frameWarnings(p, player.frameIssues, player.videoStats)).toEqual(["beach.mp4: 3 frames had no picture (the browser returned no picture for it), first at 2.10 s. Those frames show what is underneath the clip."]);
    player.dispose();
  });
});
