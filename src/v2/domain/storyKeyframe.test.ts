/** V2-SB-124: keyframe then animate (docs/v2/STORYBOARD_FORMAT.md §2.4.2). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import * as edit from "./storyEdit";
import * as refs from "./storyRefs";
import { parseStoryboard, validateStoryboard, type StoryDoc } from "./storyJson";

const doc = (shot: Record<string, unknown> = {}, more: { assets?: unknown[]; shots?: unknown[] } = {}) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "9:16" },
  assets: [
    { id: "hero", name: "Hero", type: "character", prompt: "A hero" },
    { id: "room", name: "Room", type: "location", prompt: "A room" },
    ...(more.assets ?? []),
  ],
  shots: [
    { id: "s1", title: "Wake", description: "", durationSec: 4, prompt: "She turns.", assets: ["hero", "room"], qa: [], keyframe: { prompt: "She stands at the window.", references: ["hero", { asset: "room", role: "look" }], qa: ["Face matches"] }, ...shot },
    ...(more.shots ?? []),
  ],
  connections: [],
});
const PLATE = { id: "plate", name: "Plate", type: "frame", prompt: "A plate" };
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const fresh = (d: StoryDoc): Project => board.setStoryboard(createProject("k"), board.storyboardFromDoc(d));
const img: MediaRef = { blobKey: "b-img", mime: "image/png", width: 10, height: 10 } as MediaRef;
const vid: MediaRef = { blobKey: "b-vid", mime: "video/mp4", width: 10, height: 10, durationTicks: 4 * 120000 } as MediaRef;
let n = 0;
const up = (p: Project, t: board.Target) => board.addStoryVersion(p, t, "slot" in t ? img : vid, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });

describe("shots[].keyframe (V2-SB-124)", () => {
  it("imports as a frame slot made first and attached to the clip as Image 1, the start frame", () => {
    const r = validateStoryboard(doc());
    expect(r.ok && r.warnings).toEqual([]);
    const b = board.storyboardFromDoc(parse(doc()));
    const kf = b.slots["s1.keyframe"];
    expect(kf).toMatchObject({ name: "Keyframe · Wake", type: "frame", aspect: "9:16", prompt: "She stands at the window.", references: ["hero", "room"], keyframeOf: "s1", source: { type: "generate" } });
    expect(kf.refRoles).toEqual({ room: { role: "look" } });
    expect(kf.qa.map((q) => q.text)).toEqual(["Face matches"]);
    expect(b.shots.s1.keyframe).toBe("s1.keyframe");
    expect(b.shots.s1.slotIds[0]).toBe("s1.keyframe");
    expect(refs.attachList(b, b.shots.s1).map((x) => [x.slotId, x.role])).toEqual([["s1.keyframe", "start-frame"], ["hero", "identity"], ["room", "detail"]]);
    expect(refs.referencesBlock(b, b.shots.s1)).toContain("Image 1 (Keyframe · Wake): START FRAME");
    // Its own prompt gets a References block from its own references.
    expect(refs.slotPromptWithReferences(b, kf)).toMatch(/^References:\nImage 1 \(Hero\)/);
  });

  it("the keyframe step comes after its references and right before its shot; a new keyframe version makes the clip stale", () => {
    let p = fresh(parse(doc({}, { assets: [PLATE], shots: [{ id: "s2", title: "Two", description: "", durationSec: 3, prompt: "Go", assets: ["plate"], qa: [] }] })));
    expect(board.productionSteps(p).map((s) => s.key)).toEqual(["slot:hero", "slot:room", "slot:s1.keyframe", "shot:s1", "slot:plate", "shot:s2"]);
    p = up(p, { slot: "hero" }); p = up(p, { slot: "room" }); p = up(p, { slot: "s1.keyframe" }); p = up(p, { shot: "s1" });
    expect(board.storyStatus(p).shots.s1.stale).toBe(false);
    p = up(p, { slot: "s1.keyframe" });
    expect(board.storyStatus(p).shots.s1.reasons.join(" ")).toMatch(/Keyframe · Wake/);
  });

  it("an explicit or inferred start frame of the shot becomes detail", () => {
    const r = validateStoryboard(doc({ assets: ["hero", "plate"], references: [{ asset: "plate", role: "start-frame" }, { asset: "hero", role: "identity" }] }, { assets: [PLATE] }));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.map((w) => w.path)).toEqual(["shots[0].references[0].role"]);
    const b = board.storyboardFromDoc(r.doc);
    expect(refs.attachList(b, b.shots.s1).map((x) => [x.slotId, x.role])).toEqual([["s1.keyframe", "start-frame"], ["plate", "detail"], ["hero", "identity"]]);
    const b2 = board.storyboardFromDoc(parse(doc({ assets: ["plate", "hero"] }, { assets: [PLATE] })));
    expect(refs.attachList(b2, b2.shots.s1).map((x) => x.role)).toEqual(["start-frame", "detail", "identity"]);
  });

  it("rejects a missing prompt, unknown references, a taken id and its own last frame; ignores it on html/still shots", () => {
    const errs = (raw: unknown) => { const r = validateStoryboard(raw); return r.ok ? [] : r.errors.map((e) => e.path); };
    expect(errs(doc({ keyframe: { references: [] } }))).toContain("shots[0].keyframe.prompt");
    expect(errs(doc({ keyframe: { prompt: "x", references: ["nope"] } }))).toContain("shots[0].keyframe.references[0]");
    expect(errs(doc({}, { assets: [{ id: "s1.keyframe", name: "K", type: "frame", prompt: "k" }] }))).toContain("shots[0].keyframe");
    const own = doc({ keyframe: { prompt: "x", references: ["end"] } }, { assets: [{ id: "end", name: "End", type: "frame", source: { type: "lastFrame", shot: "s1" } }] });
    expect(validateStoryboard(own).ok).toBe(false);
    const still = validateStoryboard(doc({ render: "still", clip: "img", assets: ["img", "hero", "room"] }, { assets: [{ id: "img", name: "Img", type: "image", prompt: "i" }] }));
    expect(still.ok).toBe(true);
    if (!still.ok) return;
    expect(still.warnings.map((w) => w.path)).toContain("shots[0].keyframe");
    expect(board.storyboardFromDoc(still.doc).slots["s1.keyframe"]).toBeUndefined();
  });

  it("assets used only by a keyframe are not reported unused", () => {
    const r = validateStoryboard(doc({ assets: ["hero"] }));
    expect(r.ok && r.warnings).toEqual([]); // "room" is only in the keyframe's references
  });

  it("addKeyframe makes one from the shot's references; deleting it or the shot cleans up; a duplicate keeps it as a plain reference", () => {
    const d = parse(doc({ keyframe: undefined, references: [{ asset: "plate", role: "start-frame" }], assets: ["plate", "hero"] }, { assets: [PLATE] }));
    let p = fresh(d);
    p = refs.addKeyframe(p, "s1", "s1.keyframe");
    const b = p.storyboard!;
    expect(b.slots["s1.keyframe"]).toMatchObject({ keyframeOf: "s1", references: ["plate", "hero"], type: "frame", aspect: "9:16" });
    expect(b.shots.s1.keyframe).toBe("s1.keyframe");
    expect(b.shots.s1.references?.[0]).toMatchObject({ slotId: "plate", role: "detail" });
    expect(refs.attachList(b, b.shots.s1)[0]).toMatchObject({ no: 1, slotId: "s1.keyframe", role: "start-frame" });
    expect(refs.addKeyframe(p, "s1", "other")).toBe(p); // one per shot
    const dup = edit.duplicateShot(p, "s1", "s1b").storyboard!.shots.s1b;
    expect(dup.keyframe).toBeUndefined();
    expect(dup.slotIds).toContain("s1.keyframe");
    const del = refs.deleteSlot(p, "s1.keyframe").storyboard!;
    expect(del.shots.s1.keyframe).toBeUndefined();
    expect(del.shots.s1.slotIds).not.toContain("s1.keyframe");
    const gone = edit.deleteShot(p, "s1").storyboard!;
    expect(gone.slots["s1.keyframe"].keyframeOf).toBeUndefined();
  });

  it("the example fixture exercises a keyframe with no warnings about it", () => {
    const r = parseStoryboard(readFileSync(resolve(__dirname, "__fixtures__/ep01_opening.storyboard.json"), "utf8"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.filter((w) => w.path.includes("keyframe"))).toEqual([]);
    const b = board.storyboardFromDoc(r.doc);
    expect(b.slots["s04.keyframe"]?.keyframeOf).toBe("s04");
    expect(refs.attachList(b, b.shots.s04)[0]).toMatchObject({ slotId: "s04.keyframe", role: "start-frame" });
  });
});
