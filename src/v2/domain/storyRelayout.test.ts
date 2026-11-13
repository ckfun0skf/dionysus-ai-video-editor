import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { updateShot } from "./storyEdit";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { AUDIO_TRACK_NAMES, relayoutStory, sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

// P62 (#312): re-lay a sent timeline from the storyboard in place.
const S = TICKS_PER_SECOND;
const vid = (sec: number, key = "v"): MediaRef => ({ blobKey: key, mime: "video/mp4", durationTicks: sec * S });
const aud = (sec: number): MediaRef => ({ blobKey: "a", mime: "audio/mpeg", durationTicks: sec * S });
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }, m: MediaRef) => board.addStoryVersion(p, t, m, { versionId: `rv${++n}`, now: "2026-11-13T00:00:00Z" });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const doc = () => parse({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "vo", name: "VO", type: "audio", prompt: "Voice: hi" }, { id: "card", name: "Card", type: "html", prompt: "Title card" }],
  shots: [
    { id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [] },
    { id: "b", title: "b", description: "", durationSec: 5, render: "html", clip: "card", assets: [], qa: [] },
    { id: "c", title: "c", description: "", durationSec: 5, prompt: "P", assets: [], qa: [], dialogue: "Hello", captions: true, layers: [{ id: "t1", type: "text", text: "Hi", startSec: 1, endSec: 3, position: { x: 0.5, y: 0.2 } }] },
  ],
  audio: [{ id: "vo1", asset: "vo", kind: "voiceover", from: "c", atSec: 1 }],
});
const comp = (p: Project) => p.compositions[p.rootCompositionId];
const main = (p: Project) => comp(p).tracks.find((t) => t.kind === "video")!.placements.slice().sort((x, y) => x.startTicks - y.startTicks);
const cue = (p: Project) => comp(p).tracks.filter((t) => t.name === AUDIO_TRACK_NAMES.voiceover).flatMap((t) => t.placements)[0];

function sent(): Project {
  let p = board.setStoryboard(createProject("r"), board.storyboardFromDoc(doc()));
  for (const s of ["a", "c"]) p = up(p, { shot: s }, vid(5));
  p = up(p, { slot: "card" }, { blobKey: "h", mime: "text/html" });
  p = up(p, { slot: "vo" }, aud(2));
  return sendStory(p).project;
}

describe("relayoutStory (P62)", () => {
  it("re-applies planned shot lengths, repacks the main track and re-places captions and cues", () => {
    let p = sent();
    const before = main(p);
    expect(before.map((x) => x.durationTicks)).toEqual([5 * S, 5 * S, 5 * S]);
    expect(cue(p).startTicks).toBe(before[2].startTicks + S);
    // The html shot is planned shorter on the board, and the user turned the voice-over down on the timeline.
    p = updateShot(p, "b", { durationSec: 2 });
    p = { ...p, compositions: { ...p.compositions, [p.rootCompositionId]: { ...comp(p), tracks: comp(p).tracks.map((t) => ({ ...t, placements: t.placements.map((x) => (x.storyCue ? { ...x, volume: 0.4 } : x.id === before[0].id ? { ...x, volume: 0.7 } : x)) })) } } };
    expect(main(p).map((x) => x.durationTicks)).toEqual([5 * S, 5 * S, 5 * S]); // Update alone keeps lengths
    const { project, result } = relayoutStory(p);
    const after = main(project);
    expect(after.map((x) => x.durationTicks)).toEqual([5 * S, 2 * S, 5 * S]);
    const t0 = before[0].startTicks;
    expect(after.map((x) => x.startTicks)).toEqual([t0, t0 + 5 * S, t0 + 7 * S]);
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id)); // same clips, edited in place
    expect(after[0].volume).toBe(0.7); // clip props kept
    expect(result).toMatchObject({ shots: 3, resized: 1, moved: 1, cues: 1 });
    // Shot c moved: its caption and text layer keep their offsets; the cue is re-placed against c and keeps the user's volume.
    const linked = (q: Project, layer: string) => comp(q).tracks.flatMap((t) => t.placements).find((x) => x.storyLayer === layer && x.storyLink?.anchor === after[2].id);
    expect(linked(p, "t1")!.startTicks).toBe(before[2].startTicks + S);
    expect(linked(project, "t1")!.startTicks).toBe(after[2].startTicks + S);
    expect(linked(project, "captions")!.startTicks).toBe(after[2].startTicks);
    expect(cue(project)).toMatchObject({ startTicks: after[2].startTicks + S, volume: 0.4 });
  });

  it("is a no-op on an up-to-date timeline and does nothing without a board", () => {
    const p = sent();
    const { project, result } = relayoutStory(p);
    expect(main(project).map((x) => [x.startTicks, x.durationTicks])).toEqual(main(p).map((x) => [x.startTicks, x.durationTicks]));
    expect(result).toMatchObject({ resized: 0, moved: 0 });
    const empty = createProject("e");
    expect(relayoutStory(empty).project).toBe(empty);
  });

  it("keeps gaps and a clip the user slowed down", () => {
    let p = sent();
    const [a, b, c] = main(p);
    // a at half speed (10 s long, pushed c along), and a 1 s gap before c.
    p = { ...p, compositions: { ...p.compositions, [p.rootCompositionId]: { ...comp(p), tracks: comp(p).tracks.map((t) => ({ ...t, placements: t.placements.map((x) => (x.id === a.id ? { ...x, speed: 0.5, durationTicks: 10 * S } : x.id === b.id ? { ...x, startTicks: x.startTicks + 5 * S } : x.id === c.id ? { ...x, startTicks: x.startTicks + 6 * S } : x)) })) } } };
    p = updateShot(p, "b", { durationSec: 3 });
    const after = main(relayoutStory(p).project);
    expect(after.map((x) => x.durationTicks)).toEqual([10 * S, 3 * S, 5 * S]);
    expect(after[2].startTicks - (after[1].startTicks + after[1].durationTicks)).toBe(S);
    expect(after[0].startTicks).toBe(a.startTicks);
  });
});
