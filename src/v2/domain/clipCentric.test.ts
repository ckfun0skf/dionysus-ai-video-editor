import { describe, expect, it } from "vitest";
import { createProject, type MediaRef } from "./model";
import * as board from "./storyboard";
import { storyboardToDoc } from "./storyRoundtrip";
import { parseStoryboard, storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";
import { secondsToTicks } from "./time";

// A 3.0 file: prompts on shots, plus a video asset "wide" reused as an overlay layer (3.0 reuse).
const v30 = () => ({
  format: "dionysus.storyboard/1",
  meta: { title: "Ride", aspect: "16:9" },
  assets: [
    { id: "rider", name: "Rider", type: "character", prompt: "A cyclist in a red jacket.", qa: ["Red jacket"] },
    { id: "wide", name: "Wide take", type: "video", prompt: "Wide tracking shot of the rider on a hill road.", references: ["rider"], genDurationSec: 10, qa: ["The rider is visible"] },
  ],
  shots: [
    { id: "s1", title: "Start", description: "", durationSec: 3, prompt: "The rider clips in.", assets: ["rider"], camera: "Close-up", qa: ["Shoe clips in"] },
    { id: "s2", title: "Climb", description: "", durationSec: 4, prompt: "The rider climbs.", assets: ["rider"], qa: [], layers: [{ id: "pip", type: "video", asset: "wide", startSec: 0, endSec: 2, inSec: 1, box: { x: 0.6, y: 0.6, width: 0.3, height: 0.3 } }] },
    { id: "s3", title: "Summit", description: "", durationSec: 3, prompt: "The rider reaches the top.", assets: ["rider"], qa: [] },
  ],
  connections: [],
});
/** The same story in 3.1 where s2 and s3 share the "wide" clip (s3 from 6 s). */
const v31 = () => {
  const j = JSON.parse(storyDocJson(ok(v30())));
  j.assets = j.assets.filter((a: { id: string }) => a.id !== "s2-clip" && a.id !== "s3-clip");
  j.shots[1] = { id: "s2", title: "Climb", description: "", durationSec: 4, clip: "wide" };
  j.shots[2] = { id: "s3", title: "Climb, later", description: "", durationSec: 3, clip: "wide", inSec: 6 };
  return j;
};
const ok = (r: unknown): StoryDoc => { const v = validateStoryboard(r); if (!v.ok) throw new Error(JSON.stringify(v.errors)); return v.doc; };
const warnings = (r: unknown) => { const v = validateStoryboard(r); return v.ok ? v.warnings.map((w) => `${w.path}: ${w.message}`) : v.errors.map((e) => `ERR ${e.path}: ${e.message}`); };

describe("P16 schema 3.1: clip-centric storyboard", () => {
  it("exports 3.1: no prompt on any shot, each shot names a clip, single-use clips are auto assets", () => {
    const out = JSON.parse(storyDocJson(ok(v30())));
    expect(out.schemaVersion).toBe("3.1");
    for (const s of out.shots) expect(s.prompt, s.id).toBeUndefined();
    expect(out.shots.map((s: { clip: string }) => s.clip)).toEqual(["s1-clip", "s2-clip", "s3-clip"]);
    // 3.0 reuse of a video asset (an overlay layer) is unchanged.
    expect(out.shots[1].layers[0]).toMatchObject({ asset: "wide", inSec: 1 });
    const own = out.assets.find((a: { id: string }) => a.id === "s1-clip");
    expect(own).toMatchObject({ type: "video", name: "Clip · Start", prompt: "The rider clips in.", camera: "Close-up", qa: ["Shoe clips in"], auto: true, source: "generate" });
    expect(own.references).toEqual(["rider"]);
  });

  it("migration round trip: 3.0 → 3.1 export → import is stable and keeps shared reuse", () => {
    const j1 = storyDocJson(ok(v30()));
    const r = parseStoryboard(j1);
    expect(r.ok && r.warnings).toEqual([]);
    const d2 = (r as { doc: StoryDoc }).doc;
    expect(storyDocJson(d2)).toBe(j1);
    expect(storyDocJson(storyboardToDoc(board.storyboardFromDoc(d2)))).toBe(j1);
    // A 3.1 file with a shared clip round-trips through the board model.
    const j31 = storyDocJson(ok(v31()));
    expect(JSON.parse(j31).shots.map((s: { clip: string }) => s.clip)).toEqual(["s1-clip", "wide", "wide"]);
    const b = board.storyboardFromDoc(ok(JSON.parse(j31)));
    expect(b.shots.s1.prompt).toBe("The rider clips in.");
    expect(b.shots.s2.clipSlot).toBe("wide");
    expect(b.shots.s3).toMatchObject({ clipSlot: "wide", clipInSec: 6 });
    expect(storyDocJson(storyboardToDoc(b))).toBe(j31);
  });

  it("validator warns when a 3.1 shot carries a prompt and errors on an AI shot without a clip", () => {
    const j = v31();
    j.shots[1].prompt = "Stray";
    const w = warnings(j);
    expect(w.some((x) => x.startsWith("shots[1]") && /prompt/.test(x) && /clip "wide"/.test(x))).toBe(true);
    const j2 = JSON.parse(storyDocJson(ok(v30())));
    delete j2.shots[0].clip;
    expect(warnings(j2).some((x) => x.startsWith("ERR shots[0]") && /needs "clip"/.test(x))).toBe(true);
    const j3 = JSON.parse(storyDocJson(ok(v30())));
    delete j3.shots[0].clip; j3.shots[0].prompt = "A legacy prompt";
    expect(warnings(j3).some((x) => x.startsWith("shots[0]") && /prompt/.test(x))).toBe(true);
  });

  it("production iterates per clip: the shared clip is one step, before its first shot's place", () => {
    const p = board.setStoryboard(createProject("p"), board.storyboardFromDoc(ok(v31())));
    const keys = board.productionSteps(p).map((s) => s.key);
    expect(keys.filter((k) => k === "slot:wide")).toHaveLength(1);
    expect(keys).not.toContain("shot:s2");
    expect(keys).not.toContain("shot:s3");
    expect(keys).toContain("shot:s1");
    expect(keys.indexOf("slot:rider")).toBeLessThan(keys.indexOf("slot:wide"));
  });

  it("Send to Timeline plays each shared-clip shot from its in point", () => {
    const vid: MediaRef = { blobKey: "w", mime: "video/mp4", durationTicks: secondsToTicks(10) };
    let p = board.setStoryboard(createProject("p"), board.storyboardFromDoc(ok(v31())));
    p = board.addStoryVersion(p, { shot: "s1" }, { ...vid, blobKey: "a" }, { versionId: "v1" });
    p = board.addStoryVersion(p, { slot: "wide" }, vid, { versionId: "vw" });
    const { project } = sendStory(p);
    const clips = project.compositions[project.rootCompositionId].tracks.flatMap((t) => t.placements);
    const s3 = clips.find((c) => c.storyShot === "s3"), s2 = clips.find((c) => c.storyShot === "s2");
    expect(s2?.sourceInTicks).toBe(0);
    expect(s3?.sourceInTicks).toBe(secondsToTicks(6));
    expect(s3?.durationTicks).toBe(secondsToTicks(3));
  });
});
