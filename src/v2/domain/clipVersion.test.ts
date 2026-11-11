import { describe, expect, it } from "vitest";
import { createProject, findPlacement, versionOfPlacement, type MediaRef, type Project } from "./model";
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


function standaloneHtml(pin = true): Project {
  let p = createProject("t");
  const ver = (id: string, key: string) => ({
    id, createdAt: "2020-01-01T00:00:00Z", media: { blobKey: key, mime: "text/html" },
    provenance: { source: "import" as const, inputs: [] },
  });
  p = { ...p, assets: { ...p.assets, html: { id: "html", name: "viz", kind: "html", versions: [ver("v1", "old.html")], selectedVersionId: "v1" } } };
  const c = p.compositions[p.rootCompositionId];
  const mk = (id: string, start: number) => ({
    id, startTicks: start, durationTicks: s(3), sourceInTicks: 0,
    source: { kind: "assetVersion" as const, assetId: "html", versionId: "v1" },
    clipType: "html" as const, ...(pin ? { versionId: "v1" } : {}),
  });
  const tracks = c.tracks.map((t, i) => i === 0 ? { ...t, placements: [mk("A", 0), mk("B", s(3))] } : t);
  return { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks } } };
}

describe("P59 version save mode and preview pin", () => {
  it("saving a new take from a pinned HTML clip previews that take; the sibling stays on the old one", () => {
    let p = standaloneHtml(true);
    expect(versionOfPlacement(p, pl(p, "A"))?.media.blobKey).toBe("old.html");
    const r = cv.applyMediaFromClip(p, "A", { blobKey: "new.html", mime: "text/html" }, { versionId: "v2", mode: "new" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    p = r.project;
    expect(p.assets.html.versions.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(p.assets.html.selectedVersionId).toBe("v2");
    expect(pl(p, "A").versionId).toBe("v2");
    expect(versionOfPlacement(p, pl(p, "A"))?.id).toBe("v2");
    expect(versionOfPlacement(p, pl(p, "A"))?.media.blobKey).toBe("new.html");
    expect(pl(p, "B").versionId).toBe("v1");
    expect(versionOfPlacement(p, pl(p, "B"))?.id).toBe("v1");
    expect(versionOfPlacement(p, pl(p, "B"))?.media.blobKey).toBe("old.html");
    expect(p.settings.versionSaveMode).toBeUndefined();
  });

  it("replace current version keeps the id, updates the blob, notes other clips, and drops the old key", () => {
    let { p, clipId: A, assetId } = withShot();
    p = splitAt(p, A, s(1.5), "B");
    const before = p.assets[assetId].versions.find((v) => v.id === "v1")!;
    const r = cv.applyMediaFromClip(p, A, media("k-new", 1.5, "k-new"), { mode: "replace" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mode).toBe("replace");
    expect(r.otherCount).toBe(1);
    expect(r.note).toMatch(/1 other clip/);
    expect(r.dropKeys).toContain("k1");
    p = r.project;
    const after = p.assets[assetId].versions.find((v) => v.id === "v1")!;
    expect(after.id).toBe(before.id);
    expect(after.media.blobKey).toBe("k-new");
    expect(versionOfPlacement(p, pl(p, A))?.media.blobKey).toBe("k-new");
    expect(versionOfPlacement(p, pl(p, "B"))?.media.blobKey).toBe("k-new");
    expect(p.settings.versionSaveMode).toBe("replace");
  });

  it("does not drop a blob still used by another version", () => {
    let { p, clipId: A, assetId } = withShot();
    p = (cv.addStoryVersionFromClip(p, A, media("k1", 3, "k1"), { versionId: "v2" }) as { ok: true; project: Project }).project;
    const r = cv.replaceCurrentVersion(p, A, media("k1", 3, "k1"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropKeys ?? []).not.toContain("k1");
    expect(p.assets[assetId].versions[0].media.blobKey).toBe("k1");
  });

  it("replace of a longer take without fit asks, then trim and full apply", () => {
    const { p, clipId } = withShot(3);
    const need = cv.replaceCurrentVersion(p, clipId, media("long", 8, "long"));
    expect(need.ok).toBe(false);
    if (need.ok) return;
    expect(need.error).toMatch(/fit/);
    const trimmed = cv.replaceCurrentVersion(p, clipId, media("long", 8, "long"), { fit: "trim", inSec: 2 });
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(pl(trimmed.project, clipId).durationTicks).toBe(s(3));
    expect(pl(trimmed.project, clipId).sourceInTicks).toBe(s(2));
    const full = cv.replaceCurrentVersion(p, clipId, media("long", 8, "long"), { fit: "full" });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(pl(full.project, clipId).durationTicks).toBe(s(8));
  });

  it("a snapshot of the project before replace still holds the old media (undo)", () => {
    const { p, clipId, assetId } = withShot();
    const snap = p;
    const r = cv.replaceCurrentVersion(p, clipId, media("k-new", 3, "k-new"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.assets[assetId].versions[0].media.blobKey).toBe("k-new");
    expect(snap.assets[assetId].versions[0].media.blobKey).toBe("k1");
  });
});
