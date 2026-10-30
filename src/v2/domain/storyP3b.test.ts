import { describe, expect, it } from "vitest";
import { createProject, volumeKeyAt, type MediaRef, type Placement, type Project } from "./model";
import * as board from "./storyboard";
import * as ops from "./ops";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";
import { listPresets } from "../registry";
import { hexRgb, keyImageData, keyPixel, rgbHex } from "../render/chromaKey";
import { audioFxData, fxKey, fxSettings, impulseSamples } from "../render/audioFx";
import { keyEvents } from "../render/export/plan";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S, width: 1920, height: 1080 };
const aud: MediaRef = { blobKey: "a", mime: "audio/mpeg", durationTicks: 4 * S };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `p3b${++n}`, now: "2026-10-29T00:00:00Z" });
const doc = (layers: unknown[], audio: unknown[] = []) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "actor", name: "Actor", type: "video", prompt: "Actor on green" },
    { id: "bed", name: "Bed", type: "audio", prompt: "Wind" },
  ],
  shots: [{ id: "a", title: "a", description: "", durationSec: 10, prompt: "P", assets: [], qa: [], layers }],
  audio,
});
const actor = (extra: Record<string, unknown> = {}) => ({ id: "k", type: "video", asset: "actor", startSec: 0, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 }, ...extra });
const parse = (raw: unknown) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return { doc: r.doc as StoryDoc, warnings: r.warnings.map((w) => `${w.path}: ${w.message}`) }; };
const placements = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);

describe("chroma key (P3B-12)", () => {
  const green = { rgb: hexRgb("#00ff00"), range: 0.4, spill: 0.5 };
  it("keys out the key colour, keeps far colours and suppresses spill", () => {
    const px = (r: number, g: number, b: number, k = green) => keyPixel(r / 255, g / 255, b / 255, k);
    expect(px(0, 255, 0)[3]).toBe(0);
    expect(px(255, 0, 0)[3]).toBe(1);
    expect(px(220, 180, 160)[3]).toBe(1);
    const edge = px(110, 200, 110);
    expect(edge[1]).toBeLessThan(200 / 255);
    expect(edge[1] - edge[0]).toBeLessThan((200 - 110) / 255);
    // range 0 removes almost nothing beyond the exact colour
    expect(px(60, 200, 60, { ...green, range: 0 })[3]).toBe(1);
  });
  it("keys a pixel buffer in place and round-trips hex colours", () => {
    const px = new Uint8ClampedArray([0, 255, 0, 255, 200, 30, 40, 255]);
    keyImageData(px, green);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(255);
    expect(rgbHex(...(hexRgb("#12abEF").map((v) => v * 255) as [number, number, number]))).toBe("#12abef");
  });
  it("setChromaKey clamps, normalises and clears; only on image/video/html clips", () => {
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(doc([actor()])).doc));
    p = up(up(p, { shot: "a" }, vid), { slot: "actor" }, vid);
    const sent = sendStory(p).project;
    const pl = placements(sent).find((x) => x.storyLink && x.clipType === "video" && x.durationTicks === 3 * S)!;
    const root = sent.compositions[sent.rootCompositionId];
    const keyed = ops.setChromaKey(root, pl.id, { color: "#00FF00", range: 3, spill: -1 });
    const k = keyed.tracks.flatMap((t) => t.placements).find((x) => x.id === pl.id)!.chromaKey!;
    expect(k).toEqual({ color: "#00ff00", range: 1, spill: 0 });
    expect(ops.setChromaKey(keyed, pl.id, null).tracks.flatMap((t) => t.placements).find((x) => x.id === pl.id)).not.toHaveProperty("chromaKey");
  });
  it("parses layer chromaKey (names, hex, defaults) and sends it to the clip", () => {
    const ok = parse(doc([actor({ chromaKey: { color: "green", spill: 0.7 } })]));
    expect(ok.warnings.filter((w) => w.startsWith("shots"))).toEqual([]);
    expect(ok.doc.shots[0].layers![0]).toMatchObject({ chromaKey: { color: "#00ff00", spill: 0.7 } });
    const bad = parse(doc([actor({ chromaKey: { color: "nope" } }), { id: "t", type: "text", text: "Hi", startSec: 0, endSec: 1, position: { x: 0.5, y: 0.5 }, chromaKey: { color: "#00ff00" } }]));
    expect(bad.warnings.filter((w) => w.includes("chromaKey")).length).toBe(2);
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(ok.doc));
    p = up(up(p, { shot: "a" }, vid), { slot: "actor" }, vid);
    const pl = placements(sendStory(p).project).find((x) => x.chromaKey)!;
    expect(pl.chromaKey).toEqual({ color: "#00ff00", range: 0.4, spill: 0.7 });
  });
});

describe("volume curve and audio effects (P3B-11)", () => {
  it("ships the seven audio effect presets with AI hints", () => {
    const ids = listPresets("audioFx").map((d) => d.id).sort();
    expect(ids).toEqual(["hall", "pa-announcement", "radio", "robot", "room", "telephone", "underwater"]);
    for (const d of listPresets("audioFx")) { expect(d.description.length).toBeGreaterThan(10); expect(d.ai?.use).toBeTruthy(); expect(audioFxData(d.id)).toBeTruthy(); }
  });
  it("fx settings scale with amount; amount 0 is dry; reverb impulses are deterministic", () => {
    const tel = audioFxData("telephone")!;
    const full = fxSettings(tel, 1), none = fxSettings(tel, 0);
    expect(full.highpass).toBeCloseTo(tel.highpass!);
    expect(none.highpass).toBeCloseTo(20);
    expect(none.lowpass).toBeCloseTo(20000);
    expect(fxKey({ preset: "telephone", amount: 0 })).toBe("");
    expect(fxKey({ preset: "nope", amount: 1 })).toBe("");
    expect(fxKey({ preset: "hall", amount: 0.5 })).toBe("hall:0.5");
    const [a] = impulseSamples(8000, 0.5, 2), [b] = impulseSamples(8000, 0.5, 2);
    expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)));
  });
  it("export key events match the preview's curve", () => {
    const keys = [{ t: 1, v: 0.5 }, { t: 3, v: 1.5 }];
    expect(keyEvents({ start: 10, keys })).toEqual([{ type: "set", value: 0.5, at: 10 }, { type: "ramp", value: 0.5, at: 11 }, { type: "ramp", value: 1.5, at: 13 }]);
    expect(keyEvents({ start: 0, keys: [{ t: -1, v: 0 }, { t: 1, v: 1 }] })[0]).toEqual({ type: "set", value: 0.5, at: 0 });
    expect(keyEvents({ start: 0 })).toEqual([]);
  });
  it("parses volumeKeys and fx, warns on bad values, and sends them to the clip", () => {
    const cue = { id: "c", asset: "bed", kind: "ambience", from: "a", to: "a", volumeKeys: [{ t: 0, v: 1 }, { t: 2, v: 0.2 }, { t: 5, v: 3 }], fx: { preset: "hall", amount: 0.5 } };
    const r = parse(doc([], [cue]));
    expect(r.warnings.filter((w) => w.startsWith("audio"))).toHaveLength(1);
    expect(r.doc.audio![0]).toMatchObject({ volumeKeys: [{ t: 0, v: 1 }, { t: 2, v: 0.2 }], fx: { preset: "hall", amount: 0.5 } });
    expect(parse(doc([], [{ ...cue, volumeKeys: undefined, fx: "robot" }])).doc.audio![0].fx).toEqual({ preset: "robot" });
    expect(parse(doc([], [{ ...cue, fx: { preset: "kazoo" } }])).warnings.some((w) => w.includes("fx"))).toBe(true);
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(r.doc));
    p = up(up(p, { shot: "a" }, vid), { slot: "bed" }, aud);
    const cues = placements(sendStory(p).project).filter((x) => x.storyCue === "c").sort((x, y) => x.startTicks - y.startTicks);
    expect(cues.length).toBeGreaterThan(1); // the 4 s bed loops under the 10 s shot
    expect(cues[0].audioFx).toEqual({ preset: "hall", amount: 0.5 });
    expect(volumeKeyAt(cues[0], cues[0].startTicks + 2 * S)).toBeCloseTo(0.2);
    // the second copy starts 4 s into the cue, so the curve keeps the cue's timing
    expect(volumeKeyAt(cues[1], cues[1].startTicks)).toBeCloseTo(0.2);
  });
  it("setVolumeKeys clamps, sorts and dedupes; empty removes the curve; split keeps keys", () => {
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(doc([], [{ id: "c", asset: "bed", kind: "sfx", from: "a" }])).doc));
    p = up(up(p, { shot: "a" }, vid), { slot: "bed" }, aud);
    p = sendStory(p).project;
    const root = p.compositions[p.rootCompositionId];
    const id = placements(p).find((x) => x.storyCue === "c")!.id;
    const get = (c: typeof root): Placement => c.tracks.flatMap((t) => t.placements).find((x) => x.id === id)!;
    const c1 = ops.setVolumeKeys(root, id, [{ t: 2 * S, v: 5 }, { t: 0, v: 1 }, { t: 2 * S + 10, v: 0.5 }]);
    expect(get(c1).keyframes!.volume!.map((k) => [k.t, k.v])).toEqual([[0, 1], [2 * S + 10, 0.5]]);
    expect(get(ops.setVolumeKeys(c1, id, [])).keyframes?.volume).toBeUndefined();
    const fx = ops.setAudioFx(root, id, { preset: "radio", amount: 2 });
    expect(get(fx).audioFx).toEqual({ preset: "radio", amount: 1 });
    expect(get(ops.setAudioFx(fx, id, null))).not.toHaveProperty("audioFx");
  });
});
