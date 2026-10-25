/** V2-SB-135: keyframe references ("<shot id>.keyframe"), ambience / sting / dialogue cues and off-screen dialogue lines. */
import { describe, expect, it } from "vitest";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as edit from "./storyEdit";
import * as refs from "./storyRefs";
import { audioLoops, dialogueText, parseDialogueText, validateStoryboard, type StoryDoc } from "./storyJson";
import { AUDIO_TRACK_NAMES, captionText, sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

const S = TICKS_PER_SECOND;
const img: MediaRef = { blobKey: "i", mime: "image/png" };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 6 * S };
const aud = (sec: number): MediaRef => ({ blobKey: "a", mime: "audio/mpeg", durationTicks: sec * S });
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const clone = (): StoryDoc & Record<string, unknown> => structuredClone(LANTERN_KEEPER) as StoryDoc & Record<string, unknown>;
const check = (raw: unknown) => validateStoryboard(raw);
const errs = (raw: unknown) => { const r = check(raw); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warns = (raw: unknown) => { const r = check(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.warnings.map((w) => `${w.path}: ${w.message}`); };
const parse = (raw: unknown) => { const r = check(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };

/** LANTERN_KEEPER with a keyframe on shot 1 that shot 3 reuses for its look. */
function withKfRef() {
  const d = clone();
  d.shots[0].keyframe = { prompt: "The keeper on the cliff path at dusk", references: ["keeper", "cliff"], qa: ["Keeper matches"] };
  d.shots[2].assets = [...d.shots[2].assets, "s1.keyframe"];
  d.shots[2].references = [{ asset: "cliff", role: "detail" }, { asset: "s1.keyframe", role: "look", note: "same dusk palette" }];
  return d;
}

describe("keyframe references (V2-SB-135 #3)", () => {
  it("shots and assets may reference another shot's keyframe; the clip numbering and attach list show it", () => {
    const d = withKfRef();
    expect(warns(d)).toEqual([]);
    const b = board.storyboardFromDoc(parse(d));
    const items = refs.attachList(b, b.shots.s3);
    expect(items.map((x) => [x.no, x.slotId, x.role])).toEqual([[1, "cliff", "detail"], [2, "s1.keyframe", "look"]]);
    expect(refs.referencesBlock(b, b.shots.s3)).toContain("Image 2 (Keyframe · Climbing the cliff path): reference only, not a frame: overall look");
    // A plain id is a frame: the start frame when the shot has none.
    const plain = clone();
    plain.shots[0].keyframe = { prompt: "K", references: [], qa: [] };
    plain.shots[2].assets = ["s1.keyframe", "cliff"];
    const b2 = board.storyboardFromDoc(parse(plain));
    expect(refs.attachList(b2, b2.shots.s3)[0]).toMatchObject({ slotId: "s1.keyframe", role: "start-frame", no: 1 });
    // An asset may use it too (as its base image).
    const asset = clone();
    asset.shots[0].keyframe = { prompt: "K", references: [], qa: [] };
    asset.assets.push({ id: "poster", name: "Poster", type: "image", aspect: "16:9", prompt: "Poster", references: ["s1.keyframe"], source: { type: "generate" }, qa: [] });
    asset.shots[2].assets = [...asset.shots[2].assets, "poster"];
    const b3 = board.storyboardFromDoc(parse(asset));
    expect(refs.slotAttachList(b3, b3.slots.poster)).toMatchObject([{ slotId: "s1.keyframe", role: "start-frame" }]);
  });

  it("makes the referenced keyframe first and attaches its selected version", () => {
    let p = board.setStoryboard(createProject("k"), board.storyboardFromDoc(parse(withKfRef())));
    const keys = board.productionSteps(p).map((s) => s.key);
    expect(keys.indexOf("slot:s1.keyframe")).toBeLessThan(keys.indexOf("shot:s3"));
    p = up(p, { slot: "s1.keyframe" }, img);
    p = up(p, { slot: "s1.keyframe" }, img);
    const second = board.versionsOf(p, p.storyboard!.slots["s1.keyframe"])[1].id;
    const v = refs.attachVersions(p, p.storyboard!.shots.s3).find((x) => x.item.slotId === "s1.keyframe")!;
    expect(v.versionId).toBe(board.selectedOf(p, p.storyboard!.slots["s1.keyframe"]));
    expect(v.versionId).toBe(second);
  });

  it("rejects unknown shots, shots without a keyframe, self references and loops", () => {
    const a = clone(); a.shots[2].assets = [...a.shots[2].assets, "zz.keyframe"];
    expect(errs(a).some((m) => /"zz.keyframe" names the keyframe of shot "zz", but there is no such shot/.test(m))).toBe(true);
    const b = clone(); b.shots[2].assets = [...b.shots[2].assets, "s1.keyframe"];
    expect(errs(b).some((m) => /Shot "s1" has no keyframe/.test(m))).toBe(true);
    const c = clone(); c.shots[0].keyframe = { prompt: "K", references: ["s1.keyframe"], qa: [] };
    expect(errs(c).some((m) => /can't reference itself/.test(m))).toBe(true);
    // s1's keyframe is made from s3's keyframe, which is made from s1's last frame: a loop.
    const loop = clone();
    loop.shots[0].keyframe = { prompt: "K", references: ["s3.keyframe"], qa: [] };
    loop.shots[2].keyframe = { prompt: "K3", references: ["s1-end"], qa: [] };
    loop.shots[2].assets = [...loop.shots[2].assets, "s1-end"];
    expect(errs(loop).some((m) => /^shots: Keyframe references form a loop/.test(m))).toBe(true);
    // A shot listing its own keyframe: warned and dropped (it is always Image 1).
    const own = clone(); own.shots[0].keyframe = { prompt: "K", references: [], qa: [] }; own.shots[0].assets = [...own.shots[0].assets, "s1.keyframe"];
    expect(warns(own).some((m) => /own keyframe/.test(m))).toBe(true);
    expect(parse(own).shots[0].assets).not.toContain("s1.keyframe");
  });
});

describe("ambience, stings and recorded lines (V2-SB-135 #7)", () => {
  const doc = (audio: unknown[], extra: (d: StoryDoc) => void = () => {}) => {
    const d = clone();
    d.assets.push(
      { id: "rain", name: "Rain", type: "audio", aspect: "16:9", prompt: "Loopable rain", references: [], source: { type: "generate" }, qa: [] },
      { id: "hit", name: "Hit", type: "audio", aspect: "16:9", prompt: "Sting", references: [], source: { type: "generate" }, qa: [] },
    );
    d.audio = audio as StoryDoc["audio"];
    extra(d);
    return d;
  };

  it("imports ambience (looping by default) and stings, warns on misuse", () => {
    const d = doc([{ id: "bed", asset: "rain", kind: "ambience", from: "s1", to: "s3" }, { id: "st", asset: "hit", kind: "sting", from: "s3", atSec: 1 }]);
    expect(warns(d)).toEqual([]);
    const cues = parse(d).audio!;
    expect(audioLoops(cues[0])).toBe(true);
    expect(audioLoops({ kind: "ambience", loop: false })).toBe(false);
    expect(audioLoops({ kind: "music" })).toBe(false);
    expect(audioLoops({ kind: "music", loop: true })).toBe(true);
    const w = warns(doc([
      { id: "a", asset: "hit", kind: "sting", from: "s1", to: "s3" },
      { id: "b", asset: "rain", kind: "sfx", from: "s1", to: "s3" },
      { id: "c", asset: "hit", kind: "sfx", from: "s1", loop: true },
    ]));
    expect(w.some((m) => /^audio\[0\]\.to: A sting plays once/.test(m))).toBe(true);
    expect(w.some((m) => /^audio\[1\]\.to: A sound effect .*not looped.*"ambience"/.test(m))).toBe(true);
    expect(w.some((m) => /^audio\[2\]\.loop: Only music and ambience/.test(m))).toBe(true);
    const parsed = parse(doc([{ id: "a", asset: "hit", kind: "sting", from: "s1", to: "s3" }])).audio!;
    expect(parsed[0].to).toBeUndefined();
  });

  it("send loops an ambience bed over its span on an Ambience layer; a sting goes on Stings", () => {
    let p = board.setStoryboard(createProject("a"), board.storyboardFromDoc(parse(doc([
      { id: "bed", asset: "rain", kind: "ambience", from: "s1", to: "s3", fadeOutSec: 2 },
      { id: "st", asset: "hit", kind: "sting", from: "s3", atSec: 1 },
    ]))));
    for (const s of ["s1", "s2", "s3"]) p = up(p, { shot: s }, vid);
    p = up(p, { slot: "rain" }, aud(4));
    p = up(p, { slot: "hit" }, aud(2));
    const { project, result } = sendStory(p);
    expect(result).toMatchObject({ audio: 2, skippedAudio: 0 });
    const comp = project.compositions[project.rootCompositionId];
    const amb = comp.tracks.filter((t) => t.name === AUDIO_TRACK_NAMES.ambience);
    expect(amb).toHaveLength(1);
    const pcs = amb[0].placements;
    const video = comp.tracks.find((t) => t.kind === "video")!.placements;
    const end = video[2].startTicks + video[2].durationTicks;
    // Back-to-back 4 s copies from the start of s1 to the end of s3, the last one trimmed.
    expect(pcs[0].startTicks).toBe(video[0].startTicks);
    expect(pcs.at(-1)!.startTicks + pcs.at(-1)!.durationTicks).toBe(end);
    pcs.slice(0, -1).forEach((x, i) => { expect(x.durationTicks).toBe(4 * S); expect(pcs[i + 1].startTicks).toBe(x.startTicks + x.durationTicks); });
    expect(pcs.length).toBe(Math.ceil((end - video[0].startTicks) / (4 * S)));
    expect(pcs[0]).toMatchObject({ volume: 0.5, fadeInTicks: S });
    expect(pcs[0].fadeOutTicks).toBeUndefined();
    expect(pcs.at(-1)).toMatchObject({ fadeOutTicks: Math.min(2 * S, pcs.at(-1)!.durationTicks) });
    const sting = comp.tracks.find((t) => t.name === AUDIO_TRACK_NAMES.sting)!.placements[0];
    expect(sting).toMatchObject({ durationTicks: 2 * S, volume: 0.8 });
  });
});

describe("off-screen dialogue (V2-SB-135 #9)", () => {
  const lines = () => {
    const d = clone();
    d.shots[1].dialogue = [{ speaker: "KEEPER", text: "One more night." }, { speaker: "RADIO", text: "Storm warning,   all ships.", offscreen: true }];
    return d;
  };

  it("parses lines, keeps text dialogue working and validates line fields", () => {
    expect(warns(lines())).toEqual([]);
    expect(parse(lines()).shots[1].dialogue).toEqual([{ speaker: "KEEPER", text: "One more night." }, { speaker: "RADIO", text: "Storm warning, all ships.", offscreen: true }]);
    expect(parse(clone()).shots[1].dialogue).toBe("One more night.");
    const bad = clone(); bad.shots[1].dialogue = [{ speaker: "X" }, { text: "Hi", whisper: true }] as never;
    expect(errs(bad).some((m) => /shots\[1\]\.dialogue\[0\]\.text/.test(m))).toBe(true);
    bad.shots[1].dialogue = [{ text: "Hi", whisper: true }] as never;
    expect(warns(bad).some((m) => /Unknown dialogue line field "whisper"/.test(m))).toBe(true);
  });

  it("the clip prompt gets a Dialogue block marking off-screen lines; captions show only the words", () => {
    const b = board.storyboardFromDoc(parse(lines()));
    const s2 = b.shots.s2;
    expect(s2.dialogue).toBe("KEEPER: One more night.\nRADIO (O.S.): Storm warning, all ships.");
    const prompt = refs.promptWithReferences(b, s2);
    expect(prompt).toMatch(/^References:/);
    expect(prompt).toContain('Dialogue:\n1. KEEPER (on screen, lip-synced): "One more night."\n2. RADIO (OFF-SCREEN: heard, not seen; the speaker is not in frame and no one in frame moves their lips): "Storm warning, all ships."');
    expect(captionText(s2)).toBe("One more night.\nStorm warning, all ships.");
    // Plain-text dialogue: no block (the prompt carries it).
    const plain = board.storyboardFromDoc(parse(clone()));
    expect(refs.promptWithReferences(plain, plain.shots.s2)).not.toContain("Dialogue:");
  });

  it("a recorded dialogue cue links to an off-screen line and the prompt says not to voice it", () => {
    const d = lines();
    d.assets.push({ id: "radio-vo", name: "Radio", type: "audio", aspect: "16:9", prompt: "Radio voice", references: [], source: { type: "generate" }, qa: [] });
    d.audio = [{ id: "radio", asset: "radio-vo", kind: "dialogue", from: "s2", atSec: 2, line: 2 }];
    expect(warns(d)).toEqual([]);
    const b = board.storyboardFromDoc(parse(d));
    expect(refs.promptWithReferences(b, b.shots.s2)).toContain("2. RADIO (recorded separately and added in the edit: do not voice it");
    d.audio = [{ id: "radio", asset: "radio-vo", kind: "dialogue", from: "s2", line: 1 }, { id: "r2", asset: "radio-vo", kind: "dialogue", from: "s2", line: 5 }];
    const w = warns(d);
    expect(w.some((m) => /^audio\[0\]\.line: Line 1 of shot "s2" is on screen/.test(m))).toBe(true);
    expect(w.some((m) => /^audio\[1\]\.line: Shot "s2" has only 2 dialogue lines/.test(m))).toBe(true);
  });

  it("editing keeps lines: (O.S.) text becomes lines, plain text stays text", () => {
    expect(parseDialogueText("MARA (O.S.): Who's there?\nJust a thought")).toEqual([{ speaker: "MARA", text: "Who's there?", offscreen: true }, { text: "Just a thought" }]);
    expect(dialogueText([{ text: "Hi", offscreen: true }])).toBe("(O.S.): Hi");
    expect(parseDialogueText("(O.S.): Hi")).toEqual([{ text: "Hi", offscreen: true }]);
    let p = board.setStoryboard(createProject("d"), board.storyboardFromDoc(parse(clone())));
    p = edit.updateShot(p, "s2", { dialogue: "One more night, again." });
    expect(p.storyboard!.shots.s2).toMatchObject({ dialogue: "One more night, again." });
    expect(p.storyboard!.shots.s2.lines).toBeUndefined();
    p = edit.updateShot(p, "s2", { dialogue: "KEEPER: One more night.\nRADIO (O.S.): Storm warning." });
    expect(p.storyboard!.shots.s2.lines).toEqual([{ speaker: "KEEPER", text: "One more night." }, { speaker: "RADIO", text: "Storm warning.", offscreen: true }]);
    p = edit.updateShot(p, "s2", { dialogue: "KEEPER: Only this." });
    expect(p.storyboard!.shots.s2.lines).toEqual([{ speaker: "KEEPER", text: "Only this." }]);
    p = edit.updateShot(p, "s2", { dialogue: "" });
    expect(p.storyboard!.shots.s2.lines).toBeUndefined();
    expect(p.storyboard!.shots.s2.dialogue).toBeUndefined();
  });
});
