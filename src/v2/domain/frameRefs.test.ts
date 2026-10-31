import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { storyboardToDoc } from "./storyRoundtrip";
import { frameDescMissingSubjects, frameRefId, storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { referencesBlock } from "./storyRefs";
import { deleteShot } from "./storyEdit";

const DESC2 = "Medium close-up, eye level: the man at the computer sits centre-left and looks down at the objects on the desk; this is the middle of shot 1's slow push-in, before the pan; used as the start frame of shot 2.";
const DESC3 = "Wide shot: the camera has panned left to reveal another person standing by the window, the man at the computer on the right edge; end of shot 1's pan; used as a reference for the second person's look.";
const raw = (refs2: unknown[], refs3: unknown[] = [{ frameOf: "s1", atSec: 4.5, role: "reference", frameDesc: DESC3 }]) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "Desk", aspect: "16:9" },
  assets: [],
  shots: [
    { id: "s1", title: "Desk", description: "A man at his computer", durationSec: 5, prompt: "A man at the computer notices objects on the desk; the camera pushes in, then pans left to reveal a person standing by the window.", assets: [], qa: [] },
    { id: "s2", title: "Objects", description: "", durationSec: 4, prompt: "He picks up the objects.", assets: [], qa: [], references: refs2 },
    { id: "s3", title: "Visitor", description: "", durationSec: 4, prompt: "The visitor speaks.", assets: [], qa: [], references: refs3 },
  ],
  connections: [],
});
const ok = (r: unknown): StoryDoc => { const v = validateStoryboard(r); if (!v.ok) throw new Error(JSON.stringify(v.errors)); return v.doc; };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };
const png: MediaRef = { blobKey: "f", mime: "image/png", width: 16, height: 9 };
const start = (d: StoryDoc) => board.setStoryboard(createProject("p"), board.storyboardFromDoc(d));
const clip = (p: Project, shot: string, id: string) => board.addStoryVersion(p, { shot }, vid, { versionId: id });
const pick = (p: Project, slot: string, src: string, id: string) => board.addStoryVersion(p, { slot }, png, { versionId: id, frameRef: { frameOf: "s1", atSec: 2, sourceVersionId: src } });

describe("P15 frameOf references: schema and validation", () => {
  it("imports frameOf references as implicit frame slots with their roles", () => {
    const doc = ok(raw([{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC2 }]));
    expect(doc.shots[1].references![0]).toMatchObject({ asset: frameRefId("s2", "s1"), role: "start-frame", frameOf: "s1", atSec: 2 });
    expect(doc.shots[2].references![0].role).toBe("detail");
    const b = board.storyboardFromDoc(doc), slot = b.slots["s2.frameof.s1"];
    expect(slot).toMatchObject({ type: "frame", implicit: "frameof", source: { type: "frameOf", shotId: "s1", atSec: 2, frameDesc: DESC2 } });
    expect(b.shots.s2.slotIds).toContain("s2.frameof.s1");
  });
  it("requires frameDesc and a known, earlier, other shot", () => {
    const errs = (refs: unknown[]) => { const v = validateStoryboard(raw(refs)); return v.ok ? [] : v.errors.map((e) => `${e.path}: ${e.message}`); };
    expect(errs([{ frameOf: "s1", atSec: 2, role: "start" }])[0]).toMatch(/references\[0\]\.frameDesc: A frameOf reference needs "frameDesc"/);
    expect(errs([{ frameOf: "nope", frameDesc: DESC2 }])[0]).toMatch(/Unknown shot "nope"/);
    expect(errs([{ frameOf: "s2", frameDesc: DESC2 }])[0]).toMatch(/can't use a frame of its own clip/);
    expect(errs([{ frameOf: "s3", frameDesc: DESC2 }])[0]).toMatch(/comes later in the order/);
  });
  it("warns when key subjects of frameDesc are not in the source shot's prompt", () => {
    expect(frameDescMissingSubjects("Close-up of the dog on the sofa", "A man at the computer")).toEqual(["dog", "sofa"]);
    expect(frameDescMissingSubjects(DESC2, "A man at the computer notices objects on the desk")).toEqual([]);
    const v = validateStoryboard(raw([{ frameOf: "s1", role: "start", frameDesc: "Close-up: the dog on the sofa; start of the push-in; start frame of shot 2." }]));
    expect(v.warnings.some((w) => w.path === "shots[1].references[0].frameDesc" && /"dog", "sofa"/.test(w.message))).toBe(true);
  });
  it("exports the authored frameOf form and round-trips", () => {
    const doc = ok(raw([{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC2 }]));
    const out = JSON.parse(storyDocJson(storyboardToDoc(board.storyboardFromDoc(doc))));
    expect(out.shots[1].references).toEqual([{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC2 }]);
    expect(out.shots[1].assets).toEqual([]);
    expect(out.assets).toEqual([]);
    expect(ok(out).shots[1].references![0].asset).toBe("s2.frameof.s1");
  });
  it("passes the picked frame to the prompt as the start frame or a reference", () => {
    const b = board.storyboardFromDoc(ok(raw([{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC2 }])));
    expect(referencesBlock(b, b.shots.s2)).toMatch(/Image 1 \(Frame of shot 1 · Desk\): START FRAME/);
    expect(referencesBlock(b, b.shots.s3)).toMatch(/Image 1 \(Frame of shot 1 · Desk\): reference only/);
  });
});

describe("P15 frameOf references: production order and version warnings", () => {
  const doc = ok(raw([{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC2 }]));
  it("needs the source clip first, then a pick step before the target shot", () => {
    let p = start(doc);
    const keys = () => board.productionSteps(p).map((s) => s.key);
    expect(keys().indexOf("shot:s1")).toBeLessThan(keys().indexOf("slot:s2.frameof.s1"));
    expect(keys().indexOf("slot:s2.frameof.s1")).toBeLessThan(keys().indexOf("shot:s2"));
    expect(board.productionSteps(p).find((s) => s.key === "slot:s2.frameof.s1")).toMatchObject({ state: "blocked", blockedBy: "s1" });
    expect(board.frameRefState(p, "s2.frameof.s1").state).toBe("no-source");
    p = clip(p, "s1", "c1");
    expect(board.frameRefState(p, "s2.frameof.s1").state).toBe("pick");
    expect(board.pendingFrameRefs(p).map((x) => x.slotId)).toEqual(["s2.frameof.s1", "s3.frameof.s1"]);
    p = pick(p, "s2.frameof.s1", "c1", "f1");
    expect(board.frameRefState(p, "s2.frameof.s1")).toMatchObject({ state: "ok", sourceVersionId: "c1" });
    expect(sbVersions(p).f1.frameRef).toEqual({ frameOf: "s1", atSec: 2, sourceVersionId: "c1" });
  });
  it("warns when the source version changes, dismisses per version, and never replaces the frame", () => {
    let p = pick(clip(start(doc), "s1", "c1"), "s2.frameof.s1", "c1", "f1");
    p = clip(p, "s1", "c2");
    expect(board.frameRefState(p, "s2.frameof.s1").state).toBe("changed");
    expect(board.storyStatus(p).slots["s2.frameof.s1"].reasons).toContain(board.FRAME_CHANGED);
    expect(board.selectedOf(p, p.storyboard!.slots["s2.frameof.s1"])).toBe("f1");
    p = board.dismissFrameWarning(p, "s2.frameof.s1");
    expect(board.frameRefState(p, "s2.frameof.s1")).toMatchObject({ state: "ok", dismissed: true });
    expect(board.storyStatus(p).slots["s2.frameof.s1"].stale).toBe(false);
    p = clip(p, "s1", "c3");
    expect(board.frameRefState(p, "s2.frameof.s1").state).toBe("changed");
    p = pick(p, "s2.frameof.s1", "c3", "f2");
    expect(board.frameRefState(p, "s2.frameof.s1").state).toBe("ok");
  });
  it("keeps the frame as a plain asset when the source shot is deleted", () => {
    const p = deleteShot(start(doc), "s1");
    expect(p.storyboard!.slots["s2.frameof.s1"]).toMatchObject({ source: { type: "upload" } });
    expect(p.storyboard!.slots["s2.frameof.s1"].implicit).toBeUndefined();
  });
});
const sbVersions = (p: Project) => p.storyboard!.versions;
