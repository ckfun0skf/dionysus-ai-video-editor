import { describe, expect, it } from "vitest";
import { Engine } from "../engine/engine";
import * as cmd from "../engine/commands";
import { audioFromVideo, audioFromVideoName, audioFromVideoPlacement, clampSpan, detectAudioTrack } from "./audioFromVideo";
import { createProject, type Asset, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as ops from "./ops";
import { storyDocJson, validateStoryboard } from "./storyJson";
import { sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

const S = TICKS_PER_SECOND;
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const mp4 = (...handlers: string[]) => bytes([0, 0, 0, 0], "ftypisom", ...handlers.flatMap((h) => ["hdlr", [0, 0, 0, 0, 0, 0, 0, 0], h, [0, 0, 0, 0]]));
const video: Asset = { id: "vid", kind: "video", name: "Take.mp4", selectedVersionId: "vv", versions: [{ id: "vv", createdAt: "2026-10-31T00:00:00Z", media: { blobKey: "vid/vv", mime: "video/mp4", durationTicks: 10 * S }, provenance: { source: "import", inputs: [] } }] };

describe("P18 audio from video: helpers", () => {
  it("spots an audio track in MP4/MOV and WebM headers, and says when it can't tell", () => {
    expect(detectAudioTrack(mp4("vide", "soun"))).toBe(true);
    expect(detectAudioTrack(mp4("vide"))).toBe(false);
    expect(detectAudioTrack(bytes("random bytes, no boxes here"))).toBeUndefined();
    const ebml = [0x1a, 0x45, 0xdf, 0xa3];
    expect(detectAudioTrack(bytes(ebml, [0x86, 0x85], "V_VP9", [0x86, 0x88], "A_OPUS\0\0"))).toBe(true);
    expect(detectAudioTrack(bytes(ebml, [0x86, 0x85], "V_VP9"))).toBe(false);
  });
  it("clamps the span to the video and names the asset", () => {
    expect(clampSpan(-1, 20, 10)).toEqual({ inSec: 0, outSec: 10 });
    expect(clampSpan(4, 4, 10)).toEqual({ inSec: 4, outSec: 4.1 });
    expect(clampSpan(12, 3, 10)).toEqual({ inSec: 9.9, outSec: 10 });
    expect(audioFromVideoName("Take.mp4", { inSec: 0, outSec: 10 }, 10)).toBe("Take (audio)");
    expect(audioFromVideoName("Take.mp4", { inSec: 1.5, outSec: 64 }, 70)).toBe("Take (audio 0:01.5–1:04.0)");
  });
  it("records provenance; an extracted WAV starts at 0, the fallback references the video from inSec", () => {
    const wav: MediaRef = { blobKey: "a/v", mime: "audio/wav", durationTicks: 3 * S };
    const x = audioFromVideo(video, video.versions[0], { inSec: 2, outSec: 5 }, wav, { assetId: "a", versionId: "v" });
    expect(x.asset).toMatchObject({ id: "a", kind: "audio", versions: [{ media: wav, provenance: { source: "derived", inputs: [{ assetId: "vid", versionId: "vv" }], fromVideo: { assetId: "vid", inSec: 2, outSec: 5 } } }] });
    expect(x.asset.versions[0].provenance.fromVideo?.referenced).toBeUndefined();
    expect([x.sourceInTicks, x.durationTicks]).toEqual([0, 3 * S]);
    const ref = audioFromVideo(video, video.versions[0], { inSec: 2, outSec: 5 }, undefined, { assetId: "b", versionId: "w" });
    expect(ref.asset.versions[0].media.blobKey).toBe("vid/vv");
    expect(ref.asset.versions[0].provenance.fromVideo).toEqual({ assetId: "vid", inSec: 2, outSec: 5, referenced: true });
    expect([ref.sourceInTicks, ref.durationTicks]).toEqual([2 * S, 3 * S]);
    expect(audioFromVideoPlacement(ref, 7 * S)).toMatchObject({ clipType: "audio", startTicks: 7 * S, sourceInTicks: 2 * S, durationTicks: 3 * S, source: { assetId: "b", versionId: "w" } });
  });
  it("adds the asset and clip at the playhead in one undo step, optionally muting the original clip", () => {
    const base = createProject("t");
    let root = ops.addTrack(base.compositions[base.rootCompositionId], "video", "tv");
    root = ops.insertPlacement(root, "tv", { id: "orig", startTicks: 0, durationTicks: 10 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "vid", versionId: "vv" }, clipType: "video" });
    const p0: Project = { ...base, assets: { vid: video }, compositions: { ...base.compositions, [base.rootCompositionId]: root } };
    const e = new Engine(p0);
    const r = audioFromVideo(video, video.versions[0], { inSec: 1, outSec: 4 }, undefined, { assetId: "a2", versionId: "v2" });
    const before = e.getState().project;
    expect(e.dispatch(cmd.addAudioFromVideo(r.asset, audioFromVideoPlacement(r, 2 * S), ["orig"]))).toBe(true);
    const comp = e.getState().project.compositions[e.getState().project.rootCompositionId];
    expect(e.getState().project.assets.a2.kind).toBe("audio");
    expect(comp.tracks.flatMap((t) => t.placements).some((q) => q.source.assetId === "a2" && q.startTicks === 2 * S)).toBe(true);
    expect(comp.tracks.flatMap((t) => t.placements).find((q) => q.id === "orig")?.linkedAudio?.muted).toBe(true);
    e.undo();
    expect(e.getState().project.assets.a2).toBeUndefined();
    expect(e.getState().project).toEqual(before);
  });
});

const doc = (source: unknown, extra: Record<string, unknown> = {}) => ({
  format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "take", name: "Take", type: "video", source: "upload" }, { id: "pic", name: "Pic", type: "image", prompt: "x" }],
  shots: [{ id: "a", title: "a", description: "", durationSec: 4, prompt: "P", assets: [], qa: [] }, { id: "b", title: "b", description: "", durationSec: 3, prompt: "P", assets: [], qa: [] }],
  audio: [{ id: "c1", kind: "ambience", from: "b", source, ...extra }],
});

describe("P18 storyboard cues with source.fromVideo", () => {
  it("accepts a video asset or a shot, warns on bad spans and ignores asset", () => {
    const ok = validateStoryboard(doc({ fromVideo: "a", inSec: 0, outSec: 2 }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.doc.audio![0].source).toEqual({ fromVideo: "a", inSec: 0, outSec: 2 });
      const out = JSON.parse(storyDocJson(ok.doc)) as { audio: Record<string, unknown>[] };
      expect(out.audio[0].source).toEqual({ fromVideo: "a", inSec: 0, outSec: 2 });
      expect(out.audio[0].asset).toBeUndefined();
    }
    expect(validateStoryboard(doc({ fromVideo: "take" })).ok).toBe(true);
    const bad = validateStoryboard(doc({ fromVideo: "pic" }));
    expect(bad.ok).toBe(false);
    expect(validateStoryboard(doc({ inSec: 1 })).ok).toBe(false);
    const w = validateStoryboard(doc({ fromVideo: "a", inSec: 3, outSec: 1 }, { asset: "pic" }));
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.warnings.length).toBeGreaterThanOrEqual(2);
  });
  it("sends the cue as an audio clip playing the shot's video sound", () => {
    const r = validateStoryboard(doc({ fromVideo: "a", inSec: 1, outSec: 3 }));
    if (!r.ok) throw new Error("invalid");
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(r.doc));
    const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S };
    let n = 0;
    for (const s of ["a", "b"]) p = board.addStoryVersion(p, { shot: s }, vid, { versionId: `v${++n}`, now: "2026-10-31T00:00:00Z" });
    const { project, result } = sendStory(p);
    expect(result.audio).toBe(1);
    const comp = project.compositions[project.rootCompositionId];
    const shotA = comp.tracks.find((t) => t.kind === "video")!.placements[0];
    const cue = comp.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.placements)[0];
    expect(cue).toMatchObject({ clipType: "audio", sourceInTicks: S, durationTicks: 2 * S, source: { assetId: shotA.source.assetId, versionId: shotA.source.versionId } });
  });
});
