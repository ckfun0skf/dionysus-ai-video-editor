import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { deleteShot } from "./storyEdit";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { deleteSlot } from "./storyRefs";
import { AUDIO_TRACK_NAMES, sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S };
const aud = (sec?: number): MediaRef => ({ blobKey: "a", mime: "audio/mpeg", ...(sec ? { durationTicks: sec * S } : {}) });
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });

const base = (audio: unknown, extra: Record<string, unknown> = {}) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "vo", name: "VO", type: "audio", prompt: "Voice: hello" },
    { id: "bed", name: "Bed", type: "audio", prompt: "Music" },
    { id: "slam", name: "Slam", type: "audio", source: "upload" },
    { id: "photo", name: "Photo", type: "image", prompt: "A photo" },
  ],
  shots: ["a", "b", "c"].map((id) => ({ id, title: id, description: "", durationSec: 5, prompt: "P", assets: id === "a" ? ["photo"] : [], qa: [] })),
  audio,
  ...extra,
});
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const errors = (raw: unknown) => { const r = validateStoryboard(raw); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warnings = (raw: unknown) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.warnings.map((w) => `${w.path}: ${w.message}`); };

const cues = [
  { id: "vo1", asset: "vo", kind: "voiceover", from: "a", atSec: 1, to: "b" },
  { id: "music", asset: "bed", kind: "music", from: "a", to: "c", volume: 0.3, fadeOutSec: 2 },
  { id: "hit", asset: "slam", kind: "sfx", from: "b", atSec: 2 },
];

describe("audio cues (V2-SB-125)", () => {
  it("imports cues with defaults, counts them as uses and summarises them", () => {
    const r = validateStoryboard(base(cues));
    expect(r.ok && r.warnings).toEqual([]);
    const doc = parse(base(cues));
    expect(doc.audio).toEqual([
      { id: "vo1", asset: "vo", kind: "voiceover", from: "a", atSec: 1, to: "b" },
      { id: "music", asset: "bed", kind: "music", from: "a", to: "c", volume: 0.3, fadeOutSec: 2 },
      { id: "hit", asset: "slam", kind: "sfx", from: "b", atSec: 2 },
    ]);
    expect(parse(base([{ asset: "slam", kind: "sfx", from: "a", to: "a" }])).audio).toEqual([{ id: "audio1", asset: "slam", kind: "sfx", from: "a" }]);
    expect(parse(base(undefined)).audio).toBeUndefined();
  });

  it("rejects unknown or wrong assets and shots, bad kinds, backwards ranges and duplicate ids", () => {
    expect(errors(base({}))).toEqual([expect.stringMatching(/^audio: /)]);
    const e = errors(base([
      "x",
      { asset: "nope", kind: "sfx", from: "a" },
      { asset: "photo", kind: "sfx", from: "a" },
      { asset: "vo", kind: "song", from: "a" },
      { asset: "vo", kind: "voiceover", from: "zz" },
      { asset: "vo", kind: "voiceover", from: "c", to: "a" },
      { id: "d", asset: "vo", kind: "voiceover", from: "a" },
      { id: "d", asset: "vo", kind: "voiceover", from: "b" },
    ]));
    for (const re of [/^audio\[0\]: /, /audio\[1\]\.asset: Unknown asset "nope"/, /audio\[2\]\.asset: Asset "photo" is a image/, /audio\[3\]\.kind/, /audio\[4\]\.from: Unknown shot "zz"/, /audio\[5\]\.to/, /audio\[7\]\.id: Audio cue id "d" is used twice/])
      expect(e.some((m) => re.test(m)), `${re}`).toBe(true);
    expect(errors(base([], { assets: [{ id: "vo", name: "VO", type: "audio", source: { type: "lastFrame", shot: "a" } }] })).some((m) => /can't be a last frame/.test(m))).toBe(true);
  });

  it("warns about and ignores out-of-range numbers", () => {
    const w = warnings(base([
      { id: "x", asset: "vo", kind: "voiceover", from: "a", atSec: -1, durationSec: 0, volume: 2, fadeInSec: -1, fadeOutSec: "2" },
      { id: "late", asset: "slam", kind: "sfx", from: "a", atSec: 5 },
      { id: "both", asset: "bed", kind: "music", from: "a", to: "b", durationSec: 3 },
    ]));
    for (const f of ["atSec", "durationSec", "volume", "fadeInSec", "fadeOutSec"]) expect(w.some((m) => m.startsWith(`audio[0].${f}`)), f).toBe(true);
    expect(w.some((m) => m.startsWith("audio[1].atSec"))).toBe(true);
    expect(w.some((m) => m.startsWith("audio[2]"))).toBe(true);
    expect(parse(base([{ id: "x", asset: "vo", kind: "voiceover", from: "a", atSec: -1, durationSec: 0, volume: 2 }])).audio).toEqual([{ id: "x", asset: "vo", kind: "voiceover", from: "a" }]);
  });

  it("carries cues into the board and keeps them consistent when shots or assets are deleted", () => {
    const doc = parse(base(cues));
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(doc));
    expect(p.storyboard!.audio).toEqual(doc.audio);
    expect(p.storyboard!.audio).not.toBe(doc.audio);
    // Deleting "a": the voiceover moves to "b" (and stops spanning), the music bed now starts at "b".
    let q = deleteShot(p, "a");
    expect(q.storyboard!.audio).toEqual([
      { id: "vo1", asset: "vo", kind: "voiceover", from: "b" },
      { id: "music", asset: "bed", kind: "music", from: "b", to: "c", volume: 0.3, fadeOutSec: 2 },
      { id: "hit", asset: "slam", kind: "sfx", from: "b", atSec: 2 },
    ]);
    // Deleting "b": the single-shot sfx goes; the voiceover now ends with "a" (its own first shot), the bed still ends at "c".
    q = deleteShot(p, "b");
    expect(q.storyboard!.audio).toEqual([
      { id: "vo1", asset: "vo", kind: "voiceover", from: "a", atSec: 1 },
      { id: "music", asset: "bed", kind: "music", from: "a", to: "c", volume: 0.3, fadeOutSec: 2 },
    ]);
    q = deleteShot(p, "c");
    expect(q.storyboard!.audio!.find((c) => c.id === "music")!.to).toBe("b");
    p = deleteSlot(p, "bed");
    expect(p.storyboard!.audio!.map((c) => c.id)).toEqual(["vo1", "hit"]);
    p = deleteSlot(deleteSlot(p, "vo"), "slam");
    expect(p.storyboard!.audio).toBeUndefined();
  });

  it("sends cues onto per-kind audio layers with volume, fades, spans and links", () => {
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(base(cues))));
    for (const s of ["a", "b", "c"]) p = up(p, { shot: s }, vid);
    p = up(p, { slot: "vo" }, aud(20));
    p = up(p, { slot: "bed" }, aud()); // unknown length: runs to the end of "c"
    // "slam" has no version yet: skipped.
    let { project, result } = sendStory(p);
    expect(result).toMatchObject({ shots: 3, audio: 2, skippedAudio: 1 });
    const comp = project.compositions[project.rootCompositionId];
    const video = comp.tracks.find((t) => t.kind === "video")!.placements;
    const track = (name: string) => comp.tracks.filter((t) => t.kind === "audio" && t.name === name).flatMap((t) => t.placements);
    const [vo] = track(AUDIO_TRACK_NAMES.voiceover), [bed] = track(AUDIO_TRACK_NAMES.music);
    expect(vo).toMatchObject({ clipType: "audio", startTicks: video[0].startTicks + S, durationTicks: 9 * S, volume: 1 });
    expect(vo.storyLink).toBeUndefined();
    expect(vo.fadeInTicks).toBeUndefined();
    expect(bed).toMatchObject({ startTicks: video[0].startTicks, durationTicks: 15 * S, volume: 0.3, fadeInTicks: S, fadeOutTicks: 2 * S });
    // Upload the sfx and send the same (unsent) board again: the sfx sits inside shot "b", so it is linked to that clip.
    p = up(p, { slot: "slam" }, aud(1));
    ({ project, result } = sendStory(p));
    const c2 = project.compositions[project.rootCompositionId];
    const hit = c2.tracks.filter((t) => t.name === AUDIO_TRACK_NAMES.sfx).flatMap((t) => t.placements)[0];
    const b = c2.tracks.find((t) => t.kind === "video")!.placements[1];
    expect(result.skippedAudio).toBe(0);
    expect(hit).toMatchObject({ startTicks: b.startTicks + 2 * S, durationTicks: S, volume: 1, storyLink: { anchor: b.id } });
  });

  it("caps a cue at the audio's length and at durationSec, and clamps fades to the cue", () => {
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(base([
      { id: "short", asset: "bed", kind: "music", from: "a", to: "c", fadeInSec: 9, fadeOutSec: 9 },
      { id: "dur", asset: "vo", kind: "voiceover", from: "b", to: "c", durationSec: 3 },
    ]))));
    for (const s of ["a", "b", "c"]) p = up(p, { shot: s }, vid);
    p = up(p, { slot: "bed" }, aud(4));
    p = up(p, { slot: "vo" }, aud(30));
    const comp = sendStory(p).project.compositions[p.rootCompositionId];
    const audio = comp.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.placements);
    const bed = audio.find((x) => x.volume === 0.35)!, vo = audio.find((x) => x.volume === 1)!;
    expect(bed).toMatchObject({ durationTicks: 4 * S, fadeInTicks: 4 * S, fadeOutTicks: 4 * S });
    expect(bed.storyLink).toBeDefined(); // fits inside shot "a"
    expect(vo.durationTicks).toBe(3 * S);
  });

  it("the ep01 fixture exercises voiceover, music and sfx cues", () => {
    const raw = JSON.parse(readFileSync(new URL("./__fixtures__/ep01_opening.storyboard.json", import.meta.url), "utf8"));
    const r = validateStoryboard(raw);
    expect(r.ok && r.warnings).toEqual([]);
    const doc = parse(raw);
    expect(doc.audio!.map((c) => c.kind).sort()).toEqual(["music", "sfx", "voiceover"]);
    expect(doc.audio!.find((c) => c.kind === "voiceover")).toMatchObject({ from: "s01", to: "s03" });
  });
});
