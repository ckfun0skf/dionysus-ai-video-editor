import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { addShot, updateShot } from "./storyEdit";
import { parseStoryboard, storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { EXAMPLE_STORYBOARD } from "./storyPrompt";
import { addSlot, setRefOverride } from "./storyRefs";
import { mergeStoryboard, storyDiff, storyboardToDoc } from "./storyRoundtrip";
import { replaceStory, sendStory, updatePlan, updateStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S };
const img: MediaRef = { blobKey: "i", mime: "image/png" };
const aud: MediaRef = { blobKey: "a", mime: "audio/mpeg", durationTicks: 3 * S };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `v${++n}`, now: "2026-10-29T00:00:00Z" });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
/** Export → JSON text → import, as a user would. */
const viaJson = (b: board.Storyboard): StoryDoc => { const r = parseStoryboard(storyDocJson(storyboardToDoc(b))); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const project = (doc: StoryDoc) => board.setStoryboard(createProject("T"), board.storyboardFromDoc(doc));
const root = (p: Project) => p.compositions[p.rootCompositionId];
const all = (p: Project) => root(p).tracks.flatMap((t) => t.placements);

/** States, keyframes, html and still clips, dialogue lines, roles, params and audio in one document. */
const RICH = parse({
  format: "dionysus.storyboard/1",
  meta: { title: "Rich", aspect: "16:9", style: "ink" },
  assets: [
    { id: "hero", name: "Hero", type: "character", prompt: "A hero", qa: ["Red scarf"], states: [{ id: "wet", prompt: "Hero, soaked", qa: ["Dripping"] }, { id: "lit", name: "Lit up", prompt: "Hero in light", references: ["street"], source: "upload" }] },
    { id: "street", name: "Street", type: "location", prompt: "A street", references: [{ asset: "hero", role: "style", note: "palette" }] },
    { id: "card", name: "Card", type: "html", prompt: "Title card", params: { title: { type: "text", default: "Hi" } } },
    { id: "poster", name: "Poster", type: "image", prompt: "Poster" },
    { id: "vo", name: "VO", type: "audio", prompt: "Voice" },
  ],
  shots: [
    { id: "s1", title: "Open", description: "d", durationSec: 3, prompt: "", assets: [], qa: [], render: "html", clip: "card", params: { title: "Rain" } },
    { id: "s2", title: "Walk", description: "d", durationSec: 5, prompt: "Hero walks", assets: ["hero@wet", "street"], qa: ["Feet visible"], camera: "dolly",
      dialogue: [{ speaker: "HERO", text: "Cold." }, { speaker: "MOM", text: "Come in!", offscreen: true }], captions: true,
      keyframe: { prompt: "Hero mid-step", references: ["hero@wet", { asset: "street", role: "detail" }], qa: ["Same scarf"] },
      layers: [{ id: "t1", type: "text", text: "Night", position: { x: 0.5, y: 0.8 }, startSec: 0, endSec: 2 }], genDurationSec: 8 },
    { id: "s3", title: "Poster", description: "d", durationSec: 2, prompt: "", assets: ["poster", "street"], qa: [], render: "still", clip: "poster", dialogue: "Plain words" },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut", transition: { preset: "crossfade" } }],
  audio: [{ id: "vo1", asset: "vo", kind: "voiceover", from: "s2" }],
});

const fixture = parse(JSON.parse(readFileSync(new URL("./__fixtures__/ep01_opening.storyboard.json", import.meta.url), "utf8")));
const docs: [string, StoryDoc][] = [["ep01 fixture", fixture], ["AI guide example", parse(EXAMPLE_STORYBOARD)], ["lantern keeper", parse(LANTERN_KEEPER)], ["rich", RICH]];

describe("storyboard export (P2A-EXPORT)", () => {
  it.each(docs)("round-trips %s: export, then import, gives the same board", (_, doc) => {
    const b = board.storyboardFromDoc(doc);
    expect(board.storyboardFromDoc(viaJson(b))).toEqual(b);
    expect(storyDiff(project(doc), viaJson(b)).same).toBe(true);
  });

  it("writes states, keyframes and clips back in their authored form", () => {
    const d = storyboardToDoc(board.storyboardFromDoc(RICH));
    expect(d.assets.map((a) => a.id)).toEqual(["hero", "street", "card", "poster", "vo"]);
    expect(d.assets[0].states).toEqual([{ id: "wet", prompt: "Hero, soaked", qa: ["Dripping"] }, { id: "lit", name: "Lit up", prompt: "Hero in light", references: ["street"], source: "upload" }]);
    expect(d.shots[1].keyframe).toEqual({ prompt: "Hero mid-step", references: ["hero@wet", { asset: "street", role: "detail" }], qa: ["Same scarf"] });
    expect(d.shots[1].assets).toEqual(["hero@wet", "street"]);
    expect(d.shots[0]).toMatchObject({ render: "html", clip: "card", assets: [], params: { title: "Rain" } });
    expect(d.shots[2].assets).toEqual(["poster", "street"]);
    expect(JSON.parse(storyDocJson(d)).assets[0].source).toBe("generate");
  });

  it("includes edits made on the board, and the re-import keeps every upload, pick, trim, pin and QA result", () => {
    let p = project(RICH);
    p = up(p, { slot: "street" }, img); p = up(p, { slot: "street" }, img);
    const street = p.storyboard!.slots.street.assetId!, [v1] = p.assets[street].versions;
    p = board.selectStoryVersion(p, street, v1.id);
    p = up(p, { shot: "s2" }, vid);
    const clip = p.storyboard!.shots.s2.assetId!, cv = p.assets[clip].versions[0].id;
    p = board.setVersionTrim(p, clip, cv, { inTicks: 1 * S, outTicks: 4 * S });
    p = board.setQaResult(p, cv, p.storyboard!.shots.s2.qa[0].id, "pass");
    p = setRefOverride(p, "s2", "street", v1.id);
    p = updateShot(p, "s2", { title: "Walk home", dialogue: "HERO: Colder." });
    p = addSlot(p, "lamp", { name: "Lamp", type: "prop", prompt: "Lamp" });
    p = addShot(p, "s4", { title: "End", prompt: "Fade" }, "s3");
    const doc = viaJson(p.storyboard!);
    expect(doc.shots.map((s) => s.title)).toEqual(["Open", "Walk home", "Poster", "End"]);
    expect(doc.assets.some((a) => a.id === "lamp")).toBe(true);
    expect(storyDiff(p, doc).same).toBe(true);
    expect(mergeStoryboard(p, doc)).toEqual(p.storyboard);
  });
});

describe("re-import by id (P2A-REIMPORT)", () => {
  const edited = (): StoryDoc => {
    const d = structuredClone(RICH);
    d.shots = d.shots.filter((s) => s.id !== "s3");
    d.assets = d.assets.filter((a) => a.id !== "poster");
    d.shots[1].prompt = "Hero runs";
    d.shots[1].qa = ["Splash", "Feet visible"];
    d.shots.push({ id: "s5", title: "New", description: "", durationSec: 4, prompt: "New shot", assets: ["street"], qa: [] });
    d.assets.push({ id: "moon", name: "Moon", type: "prop", aspect: "1:1", prompt: "Moon", references: [], source: { type: "generate" }, qa: [] });
    return d;
  };

  it("previews adds, changes and removals, counting the uploads a removal leaves in the library", () => {
    let p = project(RICH);
    p = up(p, { slot: "poster" }, img);
    const d = storyDiff(p, edited());
    expect(d.same).toBe(false);
    expect(d.shots.added.map((x) => x.id)).toEqual(["s5"]);
    expect(d.shots.changed).toEqual([{ id: "s2", name: "Walk", fields: ["prompt", "qa"] }]);
    expect(d.shots.removed).toEqual([{ id: "s3", name: "Poster", uploads: 0 }]);
    expect(d.assets.added.map((x) => x.id)).toEqual(["moon"]);
    expect(d.assets.removed).toEqual([{ id: "poster", name: "Poster", uploads: 1 }]);
    expect(d.assets.changed).toEqual([]);
  });

  it("keeps media, versions and QA results of matching ids, adds new ids empty and drops removed ones", () => {
    let p = project(RICH);
    p = up(p, { shot: "s2" }, vid);
    p = up(p, { slot: "hero@wet" }, img);
    const clip = p.storyboard!.shots.s2.assetId!, cv = p.assets[clip].versions[0].id;
    const feet = p.storyboard!.shots.s2.qa[0].id;
    p = board.setQaResult(p, cv, feet, "pass");
    p = board.setVersionTrim(p, clip, cv, { inTicks: S / 2, outTicks: 4 * S });
    const b = mergeStoryboard(p, edited());
    expect(b.shots.s2.assetId).toBe(clip);
    expect(b.shots.s2.prompt).toBe("Hero runs");
    // "Feet visible" moved to second place but keeps its id, so its pass still applies; "Splash" is new.
    expect(b.shots.s2.qa).toEqual([{ id: "s2.qa2", text: "Splash" }, { id: feet, text: "Feet visible" }]);
    expect(b.versions[cv]).toEqual(p.storyboard!.versions[cv]);
    expect(b.slots["hero@wet"].assetId).toBe(p.storyboard!.slots["hero@wet"].assetId);
    expect(b.shots.s5.assetId).toBeUndefined();
    expect(b.slots.moon).toBeDefined();
    expect(b.shots.s3).toBeUndefined();
    expect(b.slots.poster).toBeUndefined();
    expect(b.order).toEqual(["s1", "s2", "s5"]);
    expect(p.assets[clip]).toBeDefined();
  });

  it("an html or still shot keeps its own AI clip aside, and switching back to ai restores it", () => {
    let p = project(RICH);
    p = up(p, { slot: "card" }, { blobKey: "h", mime: "text/html" });
    const d = structuredClone(RICH);
    delete d.shots[0].render; delete d.shots[0].clip; delete d.shots[0].params; d.shots[0].prompt = "Animated title";
    let q = board.setStoryboard(p, mergeStoryboard(p, d));
    expect(q.storyboard!.shots.s1.assetId).toBeUndefined();
    q = up(q, { shot: "s1" }, vid);
    const own = q.storyboard!.shots.s1.assetId!;
    const back = mergeStoryboard(q, RICH);
    expect(back.shots.s1.assetId).toBe(p.storyboard!.slots.card.assetId);
    expect(back.shots.s1.ownAssetId).toBe(own);
    expect(mergeStoryboard(board.setStoryboard(q, back), d).shots.s1.assetId).toBe(own);
  });

  it("drops a changed check's result and pins to slots the shot no longer uses", () => {
    let p = project(RICH);
    p = up(p, { slot: "street" }, img);
    p = up(p, { shot: "s2" }, vid);
    const v = p.storyboard!.slots.street.assetId!;
    p = setRefOverride(p, "s2", "street", p.assets[v].versions[0].id);
    const d = structuredClone(RICH);
    d.shots[1].assets = ["hero@wet"];
    d.shots[1].keyframe!.references = ["hero@wet"];
    d.shots[1].qa = ["Feet out of frame"];
    const b = mergeStoryboard(p, d);
    expect(b.shots.s2.refOverrides).toBeUndefined();
    expect(b.shots.s2.qa).toEqual([{ id: "s2.qa1", text: "Feet out of frame" }]);
  });

  it("with no storyboard it is a plain import", () => {
    expect(mergeStoryboard(createProject("T"), RICH)).toEqual(board.storyboardFromDoc(RICH));
  });
});

describe("Send to timeline modes (P2A-SEND-MODES)", () => {
  const ready = () => {
    let p = project(RICH);
    p = up(p, { slot: "card" }, { blobKey: "h", mime: "text/html" });
    p = up(p, { shot: "s2" }, vid);
    p = up(p, { slot: "vo" }, aud);
    return p;
  };

  it("Update with nothing new changes nothing", () => {
    const p = sendStory(ready()).project;
    expect(updatePlan(p)).toEqual({ clips: [], refreshed: [], cues: [] });
    const r = updateStory(p);
    expect(all(r.project)).toEqual(all(p));
    expect(r.result).toMatchObject({ shots: 0, clips: 0, refreshed: 0, cues: 0, audio: 0 });
  });

  it("Update rebuilds only edited text, appends new shots, re-places edited audio and leaves the rest", () => {
    let p = sendStory(ready()).project;
    const clipIds = all(p).filter((x) => x.storyShot).map((x) => x.id);
    const untouched = all(p).find((x) => x.clipType === "text" && x.storyLink && x.text?.text === "Cold.\nCome in!");
    // Re-import an AI revision: new text on s2's layer, louder voiceover, and s3's poster uploaded.
    const d = structuredClone(RICH);
    d.shots[1].layers = [{ id: "t1", type: "text", text: "Midnight", position: { x: 0.5, y: 0.8 }, startSec: 0, endSec: 2 }];
    d.audio = [{ id: "vo1", asset: "vo", kind: "voiceover", from: "s2", volume: 0.5 }];
    p = board.setStoryboard(p, mergeStoryboard(p, d));
    p = up(p, { slot: "poster" }, img);
    expect(updatePlan(p)).toEqual({ clips: [], refreshed: ["s2"], cues: ["vo1"] });
    const r = updateStory(p);
    const after = all(r.project);
    expect(after.filter((x) => x.storyShot).map((x) => x.id).slice(0, 2)).toEqual(clipIds);
    expect(after.filter((x) => x.storyShot).map((x) => x.storyShot)).toEqual(["s1", "s2", "s3"]);
    const texts = after.filter((x) => x.clipType === "text").map((x) => x.text?.text);
    expect(texts).toContain("Midnight");
    expect(texts).not.toContain("Night");
    expect(after.filter((x) => x.storyCue === "vo1").map((x) => x.volume)).toEqual([0.5]);
    expect(r.result).toMatchObject({ shots: 1, refreshed: 1, cues: 1 });
    expect(untouched).toBeDefined();
    expect(updatePlan(r.project)).toEqual({ clips: [], refreshed: [], cues: [] });
  });

  it("Update switches a clip in place when its shot now uses another asset", () => {
    let p = sendStory(ready()).project;
    const before = all(p).find((x) => x.storyShot === "s1")!;
    const d = structuredClone(RICH);
    delete d.shots[0].render; delete d.shots[0].clip; delete d.shots[0].params; d.shots[0].prompt = "Animated title";
    p = board.setStoryboard(p, mergeStoryboard(p, d));
    p = up(p, { shot: "s1" }, vid);
    expect(updatePlan(p).clips).toEqual(["s1"]);
    const after = all(updateStory(p).project).find((x) => x.id === before.id)!;
    expect(after.source.assetId).toBe(p.storyboard!.shots.s1.assetId);
    expect(after.startTicks).toBe(before.startTicks);
  });

  it("Replace clears the timeline and rebuilds it from the board", () => {
    let p = sendStory(ready()).project;
    p = sendStory(p).project;
    const r = replaceStory(p);
    const shots = all(r.project).filter((x) => x.storyShot);
    expect(shots.map((x) => x.storyShot)).toEqual(["s1", "s2"]);
    expect(shots.some((x) => all(p).some((y) => y.id === x.id))).toBe(false);
    expect(all(r.project).filter((x) => x.storyCue)).toHaveLength(1);
    expect(r.result.shots).toBe(2);
  });
});

it("trims survive the re-import", () => {
  let p = project(RICH);
  p = up(p, { shot: "s2" }, vid);
  const clip = p.storyboard!.shots.s2.assetId!, cv = p.assets[clip].versions[0].id;
  p = board.setVersionTrim(p, clip, cv, { inTicks: S, outTicks: 4 * S });
  expect(p.storyboard!.versions[cv].trim).toEqual({ inTicks: S, outTicks: 4 * S });
  expect(mergeStoryboard(p, viaJson(p.storyboard!)).versions[cv].trim).toEqual({ inTicks: S, outTicks: 4 * S });
});
