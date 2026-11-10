import { describe, expect, it } from "vitest";
import { createProject, findPlacement, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { sendStory, updateStory } from "./storySend";
import { validateStoryboard } from "./storyJson";
import { secondsToTicks as s } from "./time";
import { mainTrack, splitPlacement } from "./ops";
import * as edit from "./edit";
import * as cv from "./clipVersion";

function shotDoc(durationSec = 3) {
  const r = validateStoryboard({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [], shots: [{ id: "s1", title: "One", durationSec, prompt: "p", assets: [], qa: [] }], connections: [] });
  if (!r.ok) throw new Error("bad doc");
  return r.doc;
}
const media = (id: string, sec: number, blobKey = id): MediaRef => ({ blobKey, mime: "video/mp4", durationTicks: s(sec) });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const pl = (p: Project, id: string) => findPlacement(root(p), id)!.placement;

function withShot(mediaSec = 3): { p: Project; clipId: string; assetId: string } {
  let p = board.setStoryboard(createProject("t"), board.storyboardFromDoc(shotDoc(3)));
  p = board.addStoryVersion(p, { shot: "s1" }, media("k1", mediaSec), { versionId: "v1" });
  p = sendStory(p).project;
  const clip = mainTrack(root(p))!.placements[0];
  return { p, clipId: clip.id, assetId: p.storyboard!.shots.s1.assetId! };
}
function splitAt(p: Project, id: string, at: number, newId: string): Project {
  const c = root(p);
  return { ...p, compositions: { ...p.compositions, [c.id]: splitPlacement(c, id, at, newId) } };
}

describe("P58 per-clip version pin", () => {
  it("split then add a version on one clip leaves the sibling on the old take", () => {
    let { p, clipId: A, assetId } = withShot();
    p = splitAt(p, A, s(1.5), "B");
    const r = cv.addStoryVersionFromClip(p, A, media("k2", 3), { versionId: "v2", fit: "trim" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    p = r.project;
    expect(pl(p, A)).toMatchObject({ versionId: "v2", source: { versionId: "v2" } });
    expect(pl(p, "B")).toMatchObject({ versionId: "v1", source: { versionId: "v1" } });
    expect(p.assets[assetId].selectedVersionId).toBe("v2");
    expect(p.assets[assetId].versions.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("copy/paste then add a version on the original leaves the copy unchanged", () => {
    let { p, clipId: A } = withShot();
    const items = edit.copyClips(root(p), [A]);
    const pasted = edit.pasteClips(root(p), items, s(5), () => "C");
    p = { ...p, compositions: { ...p.compositions, [root(p).id]: pasted.comp } };
    const r = cv.addStoryVersionFromClip(p, A, media("k2", 3), { versionId: "v2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    p = r.project;
    expect(pl(p, A).source.versionId).toBe("v2");
    expect(pl(p, "C").source.versionId).toBe("v1");
    expect(pl(p, "C").versionId).toBe("v1");
  });

  it("resync and selecting another version do not overwrite pins", () => {
    let { p, clipId: A, assetId } = withShot();
    p = splitAt(p, A, s(1.5), "B");
    p = (cv.addStoryVersionFromClip(p, A, media("k2", 3), { versionId: "v2", fit: "trim" }) as { ok: true; project: Project }).project;
    p = updateStory(p).project;
    expect(pl(p, A).source.versionId).toBe("v2");
    expect(pl(p, "B").source.versionId).toBe("v1");
    p = board.selectStoryVersion(p, assetId, "v1");
    expect(pl(p, A).source.versionId).toBe("v2");
    expect(pl(p, "B").source.versionId).toBe("v1");
  });

  it("a pin to a deleted version falls back to the current version with a warning", () => {
    let { p, clipId: A } = withShot();
    const c = root(p);
    p = { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((x) => x.id === A ? { ...x, versionId: "gone" } : x) })) } } };
    const repaired = cv.repairStalePins(p);
    expect(repaired.warnings[0]).toMatchObject({ clipId: A });
    expect(repaired.warnings[0].message).toMatch(/no longer exists/);
    expect(pl(repaired.project, A).versionId).toBeUndefined();
    expect(pl(repaired.project, A).source.versionId).toBe("v1");
  });

  it("adding a version from the storyboard still updates unpinned clips", () => {
    let { p, clipId, assetId } = withShot();
    p = board.addStoryVersion(p, { shot: "s1" }, media("k2", 3), { versionId: "v2" });
    expect(pl(p, clipId).source.versionId).toBe("v2");
    expect(pl(p, clipId).versionId).toBeUndefined();
    expect(p.assets[assetId].selectedVersionId).toBe("v2");
  });

  it("Follow storyboard clears the pin", () => {
    let { p, clipId: A, assetId } = withShot();
    p = (cv.addStoryVersionFromClip(p, A, media("k2", 3), { versionId: "v2" }) as { ok: true; project: Project }).project;
    expect(pl(p, A).versionId).toBe("v2");
    p = board.selectStoryVersion(p, assetId, "v1");
    // A stays pinned to v2
    expect(pl(p, A).source.versionId).toBe("v2");
    p = cv.setClipVersion(p, A, null).project;
    expect(pl(p, A).versionId).toBeUndefined();
    expect(pl(p, A).source.versionId).toBe("v1");
  });
});

describe("P58 replace length choice", () => {
  it("a longer take without fit explains the choice", () => {
    const { p, clipId } = withShot();
    const r = cv.addStoryVersionFromClip(p, clipId, media("long", 6));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.needsFit).toBe(true);
    expect(r.error).toMatch(/fit "trim"/);
    expect(r.error).toMatch(/"full"/);
  });

  it("fit trim keeps the shot length and uses inSec", () => {
    const { p, clipId } = withShot();
    const r = cv.addStoryVersionFromClip(p, clipId, media("long", 6), { versionId: "v2", fit: "trim", inSec: 1.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pl(r.project, clipId)).toMatchObject({ durationTicks: s(3), sourceInTicks: s(1.5), versionId: "v2" });
  });

  it("fit full grows the clip and ripples later clips when asked", () => {
    let { p, clipId: A } = withShot();
    p = splitAt(p, A, s(1.5), "B");
    const noRipple = cv.addStoryVersionFromClip(p, A, media("long", 6), { versionId: "v2", fit: "full", ripple: false });
    expect(noRipple.ok).toBe(true);
    if (!noRipple.ok) return;
    expect(pl(noRipple.project, A).durationTicks).toBe(s(6));
    expect(pl(noRipple.project, "B").startTicks).toBe(s(1.5));
    const rippled = cv.addStoryVersionFromClip(p, A, media("long", 6), { versionId: "v2", fit: "full", ripple: true });
    expect(rippled.ok).toBe(true);
    if (!rippled.ok) return;
    expect(pl(rippled.project, A).durationTicks).toBe(s(6));
    expect(pl(rippled.project, "B").startTicks).toBe(s(6));
  });

  it("a shorter take notes it and leaves a gap unless ripple is on", () => {
    let { p, clipId } = withShot();
    const c = root(p);
    const main = mainTrack(c)!;
    const later = { ...main.placements[0], id: "LATER", startTicks: s(3), durationTicks: s(2), storyShot: undefined, versionId: undefined };
    p = { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks: c.tracks.map((t) => t.id === main.id ? { ...t, placements: [...t.placements, later] } : t) } } };
    const gap = cv.addStoryVersionFromClip(p, clipId, media("short", 1), { versionId: "v2", ripple: false });
    expect(gap.ok).toBe(true);
    if (!gap.ok) return;
    expect(gap.note).toMatch(/shorter/);
    expect(gap.note).toMatch(/gap/);
    expect(pl(gap.project, clipId).durationTicks).toBe(s(1));
    expect(pl(gap.project, "LATER").startTicks).toBe(s(3));
    const closed = cv.addStoryVersionFromClip(p, clipId, media("short", 1), { versionId: "v2", ripple: true });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.note).toMatch(/moved up/);
    expect(pl(closed.project, "LATER").startTicks).toBe(s(1));
  });
});

describe("P58 delete version", () => {
  it("refuses to delete the last remaining version", () => {
    const { p, assetId } = withShot();
    const plan = cv.versionDeletePlan(p, assetId, "v1");
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/last remaining/);
    expect(() => cv.deleteAssetVersion(p, assetId, "v1")).toThrow(/last remaining/);
  });

  it("lists affected clips and the version they will switch to", () => {
    let { p, clipId: A, assetId } = withShot();
    p = splitAt(p, A, s(1.5), "B");
    p = (cv.addStoryVersionFromClip(p, A, media("k2", 3), { versionId: "v2", fit: "trim" }) as { ok: true; project: Project }).project;
    const plan = cv.versionDeletePlan(p, assetId, "v1");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fallbackId).toBe("v2");
    expect(plan.affected.map((x) => x.clipId)).toContain("B");
    expect(plan.affected.find((x) => x.clipId === "B")?.toVersionId).toBe("v2");
    expect(plan.dropKeys).toContain("k1");
    const next = cv.deleteAssetVersion(p, assetId, "v1");
    expect(next.assets[assetId].versions.map((v) => v.id)).toEqual(["v2"]);
    expect(pl(next, "B").source.versionId).toBe("v2");
    expect(pl(next, A).source.versionId).toBe("v2");
    expect(next.storyboard!.versions.v1).toBeUndefined();
    expect(() => cv.deleteAssetVersion(next, assetId, "v2")).toThrow(/last remaining/);
  });

  it("does not drop a blob still used by another version", () => {
    let { p, clipId: A, assetId } = withShot();
    p = (cv.addStoryVersionFromClip(p, A, media("k1", 3, "k1"), { versionId: "v2" }) as { ok: true; project: Project }).project;
    const plan = cv.versionDeletePlan(p, assetId, "v1");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.dropKeys).not.toContain("k1");
  });
});
