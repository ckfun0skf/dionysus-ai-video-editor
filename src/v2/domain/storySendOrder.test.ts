import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { mergeStoryboard } from "./storyRoundtrip";
import { AUDIO_TRACK_NAMES, relayoutStory, sendStory, updateStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

// P63 (#314): shots added to a board that is already on the timeline go in at their place in the story, and a new
// shot made from a clip asset that already has a version uses it instead of a placeholder.
const S = TICKS_PER_SECOND;
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `ov${++n}`, now: "2026-11-14T00:00:00Z" });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
type Sh = Record<string, unknown>;
const html = (id: string, sec: number, extra: Sh = {}): Sh => ({ id, title: id, description: "", durationSec: sec, render: "html", clip: "intro", params: {}, assets: [], qa: [], ...extra });
const vid = (id: string, extra: Sh = {}): Sh => ({ id, title: id, description: "", durationSec: 4, prompt: "P", assets: [], qa: [], ...extra });
const doc = (shots: Sh[], audio: unknown[] = [], assets: unknown[] = []) => parse({
  format: "dionysus.storyboard/1", schemaVersion: "3.1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "intro", name: "Intro", type: "html", prompt: "Intro card" }, { id: "late", name: "Late", type: "html", prompt: "Unmade card" }, { id: "vo-1", name: "VO 1", type: "audio", prompt: "Voice" }, ...assets],
  shots, audio,
});
const comp = (p: Project) => p.compositions[p.rootCompositionId];
const main = (p: Project) => comp(p).tracks.find((t) => t.kind === "video")!.placements.slice().sort((a, b) => a.startTicks - b.startTicks);
const order = (p: Project) => main(p).map((x) => [x.storyShot, x.startTicks / S, x.durationTicks / S]);
const cueAt = (p: Project, id: string) => comp(p).tracks.flatMap((t) => t.placements).find((x) => x.storyCue === id)?.startTicks;
const merge = (p: Project, d: StoryDoc) => board.setStoryboard(p, mergeStoryboard(p, d));

function sent(): Project {
  let p = board.setStoryboard(createProject("o"), board.storyboardFromDoc(doc([html("h1", 3), vid("a", { dialogue: "Hi", captions: true }), vid("b")], [{ id: "c1", asset: "vo-1", kind: "voiceover", from: "a", atSec: 1 }, { id: "bed", asset: "vo-1", kind: "music", from: "a", to: "b" }])));
  p = up(p, { slot: "intro" }, { blobKey: "h", mime: "text/html" });
  for (const s of ["a", "b"]) p = up(p, { shot: s }, { blobKey: s, mime: "video/mp4", durationTicks: 4 * S });
  p = up(p, { slot: "vo-1" }, { blobKey: "vo", mime: "audio/mpeg", durationTicks: 2 * S });
  return sendStory(p).project;
}

describe("new shots go in at their story position (P63, #314)", () => {
  it("re-import adds h0 first with the shared clip: relayout puts it at 0 s with the clip's version and moves the rest", () => {
    let p = sent();
    expect(order(p)).toEqual([["h1", 0, 3], ["a", 3, 4], ["b", 7, 4]]);
    const intro = p.storyboard!.slots.intro.assetId!;
    const vo1 = cueAt(p, "c1")!, bed = cueAt(p, "bed")!;
    p = merge(p, doc([html("h0", 2.25, { params: { scanAt: 99 } }), html("h1", 3), vid("a", { dialogue: "Hi", captions: true }), vid("b")],
      [{ id: "c0", asset: "vo-h0", kind: "voiceover", from: "h0", atSec: 0.5 }, { id: "c1", asset: "vo-1", kind: "voiceover", from: "a", atSec: 1 }, { id: "bed", asset: "vo-1", kind: "music", from: "a", to: "b" }],
      [{ id: "vo-h0", name: "VO h0", type: "audio", prompt: "Voice" }]));
    expect(p.storyboard!.shots.h0.assetId).toBe(intro); // linked to the clip's upload, not a placeholder
    expect(board.sendPlan(p).find((x) => x.shotId === "h0")!.state).toBe("ready");
    p = up(p, { slot: "vo-h0" }, { blobKey: "vo0", mime: "audio/mpeg", durationTicks: S });
    const { project, result } = relayoutStory(p);
    expect(order(project)).toEqual([["h0", 0, 2.25], ["h1", 2.25, 3], ["a", 5.25, 4], ["b", 9.25, 4]]);
    const h0 = main(project)[0];
    expect(h0).toMatchObject({ clipType: "html", source: { assetId: intro } });
    expect(h0.placeholder).toBeUndefined();
    expect(result.update).toMatchObject({ inserted: ["h0"] });
    expect(result.update!.placeholderShots).toBeUndefined();
    expect(result.update!.appended).toBeUndefined();
    // Cues: the new one sits in h0; the others moved 2.25 s with their shots.
    expect(cueAt(project, "c0")).toBe(0.5 * S);
    expect(cueAt(project, "c1")).toBe(vo1 + 2.25 * S);
    expect(cueAt(project, "bed")).toBe(bed + 2.25 * S);
    // Shot a's caption followed its clip.
    const a = main(project)[2];
    const cap = comp(project).tracks.flatMap((t) => t.placements).find((x) => x.storyLayer === "captions" && x.storyLink?.anchor === a.id)!;
    expect(cap.startTicks).toBe(a.startTicks);
  });

  it("Update alone also inserts in the middle, keeps later clips' edits and reports appended shots and placeholders", () => {
    let p = sent();
    const before = main(p);
    // A user volume on b, which moves up.
    p = { ...p, compositions: { ...p.compositions, [p.rootCompositionId]: { ...comp(p), tracks: comp(p).tracks.map((t) => ({ ...t, placements: t.placements.map((x) => (x.id === before[2].id ? { ...x, volume: 0.3 } : x)) })) } } };
    p = merge(p, doc([html("h1", 3), vid("a", { dialogue: "Hi", captions: true }), html("mid", 1.5), vid("b"), html("end", 2, { clip: "late" })]));
    const { project, result } = updateStory(p);
    expect(order(project)).toEqual([["h1", 0, 3], ["a", 3, 4], ["mid", 7, 1.5], ["b", 8.5, 4], ["end", 12.5, 2]]);
    expect(main(project).find((x) => x.storyShot === "b")).toMatchObject({ id: before[2].id, volume: 0.3 });
    expect(main(project).find((x) => x.storyShot === "end")!.placeholder).toBeTruthy(); // its clip has no version yet (RULE 59)
    expect(result).toMatchObject({ inserted: ["mid"], appended: ["end"], placeholderShots: ["end"] });
  });

  it("a first send onto a timeline without story clips still appends after the last clip", () => {
    let p = board.setStoryboard(createProject("f"), board.storyboardFromDoc(doc([html("h1", 3), html("h2", 2)])));
    p = up(p, { slot: "intro" }, { blobKey: "h", mime: "text/html" });
    const { project, result } = sendStory(p);
    expect(order(project)).toEqual([["h1", 0, 3], ["h2", 3, 2]]);
    expect(result).toMatchObject({ appended: ["h1", "h2"] });
    expect(result.inserted).toBeUndefined();
    expect(AUDIO_TRACK_NAMES.voiceover).toBe("Voiceover");
  });
});
