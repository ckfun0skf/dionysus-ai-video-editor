/** P2B: "<shot>.lastframe" ids, still-shot backgrounds, automatic jobs and the example. */
import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { updateShot } from "./storyEdit";
import { backgroundCss, backgroundJobs, lastFrameJobs, resolvedStops } from "./storyAuto";
import { parseStoryboard, storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { EXAMPLE_STORYBOARD } from "./storyPrompt";
import { storyboardToDoc } from "./storyRoundtrip";
import { TICKS_PER_SECOND } from "./time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const S = TICKS_PER_SECOND;
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "hero", name: "Hero", type: "character", prompt: "hero sheet", qa: [] }],
  shots: [
    { id: "s1", title: "One", durationSec: 4, prompt: "a walk", assets: ["hero"], qa: [] },
    { id: "s2", title: "Two", durationSec: 4, prompt: "on", assets: ["s1.lastframe", "hero"], references: [{ asset: "s1.lastframe", role: "start-frame" }], qa: [] },
    { id: "s3", title: "Card", durationSec: 3, prompt: "", assets: [], render: "still", background: "#000000", qa: [] },
  ],
});
const run = (mut: (d: J) => void = () => {}) => { const d = base(); mut(d); return validateStoryboard(d); };
const doc = (mut?: (d: J) => void): StoryDoc => { const r = run(mut); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const errs = (mut: (d: J) => void) => { const r = run(mut); return r.ok ? [] : r.errors.map((e) => e.message).join("\n"); };
const project = (d: StoryDoc) => board.setStoryboard(createProject("T"), board.storyboardFromDoc(d));
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S };

describe("P2B: <shot>.lastframe references", () => {
  it("adds an implicit frame asset, with no warnings", () => {
    const r = run();
    expect(r.ok && r.warnings).toEqual([]);
    const a = doc().assets.find((x) => x.id === "s1.lastframe")!;
    expect(a).toMatchObject({ type: "frame", name: "Last frame · One", implicit: true, source: { type: "lastFrame", shot: "s1" } });
  });
  it("rejects unknown shots, own frames and declared reserved ids", () => {
    expect(errs((d) => { d.shots[1].assets.push("s9.lastframe"); })).toMatch(/s9\.lastframe/);
    expect(errs((d) => { d.shots[0].assets.push("s1.lastframe"); })).not.toBe("");
    expect(errs((d) => { d.assets.push({ id: "s1.lastframe", name: "x", type: "frame", prompt: "", qa: [] }); })).not.toBe("");
  });
  it("is not exported and round-trips", () => {
    const out = storyboardToDoc(project(doc()).storyboard!);
    expect(out.assets.map((a) => a.id)).toEqual(["hero"]);
    expect(out.shots[1].assets).toContain("s1.lastframe");
    const r = parseStoryboard(storyDocJson(out));
    expect(r.ok).toBe(true);
  });
  it("queues a frame job once a clip version is picked, and clears it once taken", () => {
    let p: Project = project(doc());
    expect(lastFrameJobs(p)).toEqual([]);
    p = board.addStoryVersion(p, { shot: "s1" }, vid, { versionId: "v1", now: "2026-10-29T00:00:00Z" });
    const jobs = lastFrameJobs(p);
    expect(jobs).toEqual([{ slotId: "s1.lastframe", shotId: "s1", versionId: "v1", blobKey: "v" }]);
    p = board.addStoryVersion(p, { slot: "s1.lastframe" }, { blobKey: "f", mime: "image/png" }, { versionId: "f1", derivedFrom: { shotId: "s1", versionId: "v1" } });
    expect(lastFrameJobs(p)).toEqual([]);
  });
});

describe("P2B: still-shot backgrounds", () => {
  it("validates colours and gradients", () => {
    expect(run().ok).toBe(true);
    expect(run((d) => { d.shots[2].background = { type: "linear", angle: 90, stops: [{ color: "#000000" }, { color: "#ffffff", at: 1 }] }; }).ok).toBe(true);
    expect(errs((d) => { d.shots[2].background = "red"; })).not.toBe("");
    expect(errs((d) => { d.shots[2].background = { type: "linear", stops: [{ color: "#000000" }] }; })).not.toBe("");
    expect(errs((d) => { delete d.shots[2].background; })).toMatch(/"background"/);
    const w = run((d) => { d.shots[0].background = "#000000"; });
    expect(w.ok && w.warnings.length).toBeGreaterThan(0);
  });
  it("makes an implicit background slot, exports the background and queues a drawing", () => {
    const p = project(doc());
    const b = p.storyboard!;
    expect(b.shots.s3.clipSlot).toBe("s3.background");
    expect(b.slots["s3.background"]).toMatchObject({ implicit: "background", background: "#000000" });
    const out = storyboardToDoc(b);
    expect(out.shots[2]).toMatchObject({ render: "still", background: "#000000" });
    expect(out.shots[2].clip).toBeUndefined();
    expect(out.assets.some((a) => a.id === "s3.background")).toBe(false);
    expect(backgroundJobs(p).map((j) => j.slotId)).toEqual(["s3.background"]);
  });
  it("is edited from the shot editor patch and redrawn on change", () => {
    let p = project(doc());
    const j = backgroundJobs(p)[0];
    p = board.addStoryVersion(p, { slot: j.slotId }, { blobKey: "bg", mime: "image/png" }, { versionId: "b1", bg: j.signature });
    expect(backgroundJobs(p)).toEqual([]);
    p = updateShot(p, "s3", { background: { type: "radial", stops: [{ color: "#ffffff" }, { color: "#000000" }] } });
    expect(backgroundJobs(p)).toHaveLength(1);
    p = updateShot(p, "s1", { render: "still", background: "#112233" });
    expect(p.storyboard!.shots.s1.clipSlot).toBe("s1.background");
  });
  it("draws CSS for the preview", () => {
    expect(backgroundCss("#101820")).toBe("#101820");
    expect(backgroundCss({ type: "linear", angle: 90, stops: [{ color: "#000000" }, { color: "#ffffff" }] })).toMatch(/linear-gradient\(90deg/);
    expect(resolvedStops([{ color: "#000000" }, { color: "#111111" }, { color: "#ffffff" }]).map((s) => s.at)).toEqual([0, 0.5, 1]);
  });
});

describe("P2B: the example", () => {
  it("imports with no warnings and uses s1.lastframe, sheets and a background still", () => {
    const r = validateStoryboard(EXAMPLE_STORYBOARD);
    expect(r.ok && r.warnings).toEqual([]);
    const p = project((r as { doc: StoryDoc }).doc);
    expect(p.storyboard!.shots.s5.clipSlot).toBe("s5.background");
    expect(p.storyboard!.slots["s1.lastframe"]).toBeDefined();
  });
});
