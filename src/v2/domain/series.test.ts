import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { parseStoryboard, storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { storyboardToDoc } from "./storyRoundtrip";
import * as series from "./series";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";

const ex = () => JSON.parse(JSON.stringify(LANTERN_KEEPER));
const img: MediaRef = { blobKey: "k1", mime: "image/png", thumbKey: "k1t" } as MediaRef;
const parse = (raw: unknown, s?: series.Series): StoryDoc => { const r = validateStoryboard(raw, { series: s }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const project = (doc: StoryDoc) => board.setStoryboard(createProject("Ep"), board.storyboardFromDoc(doc));
const now = "2026-10-29T00:00:00Z";
/** Episode 1 with a keeper upload, promoted to a new Series. */
function ep1(): { s: series.Series; p: Project } {
  let p = project(parse(ex()));
  p = board.addStoryVersion(p, { slot: "keeper" }, img, { versionId: "kv1", now });
  const r = series.promoteToSeries(series.createSeries("Lantern", now, "ser1"), p, "keeper", now)!;
  return { s: r.series, p: r.project };
}

describe("Series (P5)", () => {
  it("promotes an asset with its versions and links it", () => {
    const { s, p } = ep1();
    expect(Object.keys(s.assets)).toEqual(["keeper"]);
    expect(s.assets.keeper.def.type).toBe("character");
    expect(s.assets.keeper.description).toMatch(/^Character sheet of an elderly/);
    expect(s.assets.keeper.media[""].asset.versions.map((v) => v.id)).toEqual(["kv1"]);
    expect(p.storyboard!.slots.keeper.seriesRef).toBe("keeper");
    expect(series.seriesMediaKeys(s)).toEqual(["k1", "k1t"]);
    expect(series.seriesAssetList(s)[0]).toMatchObject({ id: "keeper", type: "character", versions: 1 });
    expect(series.seriesPromptSection(s)).toContain('"keeper" (character) The keeper');
  });
  it("dedupes by id: promoting again reuses the Series asset and adds versions", () => {
    const { s } = ep1();
    let p2 = project(parse(ex()));
    p2 = board.addStoryVersion(p2, { slot: "keeper" }, { ...img, blobKey: "k2" }, { versionId: "kv2", now });
    const r = series.promoteToSeries(s, p2, "keeper", now)!;
    expect(r.deduped).toBe(true);
    expect(Object.keys(r.series.assets)).toEqual(["keeper"]);
    expect(r.series.assets.keeper.media[""].asset.versions.map((v) => v.id)).toEqual(["kv1", "kv2"]);
  });
  it("seriesRef resolves against the Series; missing refs are reported with the ids", () => {
    const { s } = ep1();
    const raw = ex();
    raw.assets[0] = { id: "keeper", seriesRef: "keeper" };
    const doc = parse(raw, s);
    expect(doc.assets[0]).toMatchObject({ id: "keeper", seriesRef: "keeper", type: "character", name: "The keeper" });
    raw.assets[0] = { id: "keeper", seriesRef: "nobody" };
    const bad = validateStoryboard(raw, { series: s });
    expect(bad.ok).toBe(false);
    if (!bad.ok) { expect(bad.errors[0].message).toContain('no asset "nobody"'); expect(bad.errors[0].message).toContain("keeper"); expect(bad.errors.length).toBe(1); }
    const none = validateStoryboard(raw);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors[0].message).toContain("isn't in a Series");
  });
  it("a redefined Series asset uses the Series definition with a warning; full defs work without a Series", () => {
    const { s } = ep1();
    const raw = ex();
    raw.assets[0] = { ...raw.assets[0], seriesRef: "keeper", prompt: "someone else" };
    const r = validateStoryboard(raw, { series: s });
    expect(r.ok && r.doc.assets[0].prompt).toMatch(/^Character sheet/);
    expect(r.warnings.some((w) => w.message.includes("detach"))).toBe(true);
    const alone = validateStoryboard(raw);
    expect(alone.ok && alone.doc.assets[0].prompt).toBe("someone else");
  });
  it("adds Series assets a referenced asset is made from", () => {
    const { s, p } = ep1();
    const withDeps = series.promoteToSeries(s, p, "lantern", now)!.series;
    const keeperDef = { ...withDeps.assets.keeper.def, references: ["lantern"] };
    const s2 = series.updateSeriesAsset(withDeps, "keeper", { def: keeperDef });
    const raw = ex();
    raw.assets = [{ id: "keeper", seriesRef: "keeper" }, raw.assets[1], raw.assets[3]];
    raw.shots = raw.shots.map((sh: { assets: string[]; references?: unknown }) => ({ ...sh, assets: sh.assets.filter((a) => a !== "lantern") , references: undefined }));
    const r = validateStoryboard(raw, { series: s2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.assets.find((a) => a.id === "lantern")?.seriesRef).toBe("lantern");
    expect(series.seriesForProject(s2, project(parse(raw, s2))).assets).toHaveProperty("lantern");
  });
  it("series: true round-trips, and promoteFlagged links flagged assets", () => {
    const raw = ex();
    raw.assets[2] = { ...raw.assets[2], series: true };
    const p = project(parse(raw));
    expect(p.storyboard!.slots.lantern.seriesPromote).toBe(true);
    expect(parseStoryboard(storyDocJson(storyboardToDoc(p.storyboard!))).ok && storyboardToDoc(p.storyboard!).assets[2].series).toBe(true);
    const r = series.promoteFlagged(series.createSeries("S", now, "x"), p, now);
    expect(r.promoted).toEqual(["lantern"]);
    expect(r.project.storyboard!.slots.lantern).toMatchObject({ seriesRef: "lantern" });
    expect(r.project.storyboard!.slots.lantern.seriesPromote).toBeUndefined();
  });
  it("edits in the Series reach every episode; pull is idempotent; detach stops following", () => {
    const { s, p } = ep1();
    const raw = ex(); raw.assets[0] = { id: "keeper", seriesRef: "keeper" };
    const ep2 = project(parse(raw, s));
    const edited = series.updateSeriesAsset(s, "keeper", { def: { ...s.assets.keeper.def, prompt: "New keeper look" } });
    for (const ep of [p, ep2]) {
      const q = series.pullSeries(ep, edited);
      expect(q.storyboard!.slots.keeper.prompt).toBe("New keeper look");
      expect(q.storyboard!.slots.keeper.assetId).toBe(s.assets.keeper.media[""].asset.id);
      expect(series.pullSeries(q, edited)).toBe(q);
      const d = series.detachFromSeries(q, "keeper");
      expect(series.pullSeries(d, s)).toBe(d);
    }
  });
  it("captureLinked writes episode edits back; unchanged is a no-op", () => {
    const { s, p } = ep1();
    expect(series.captureLinked(s, p)).toBe(s);
    const p2 = board.addStoryVersion(p, { slot: "keeper" }, { ...img, blobKey: "k3" }, { versionId: "kv3", now });
    const s2 = series.captureLinked(s, p2, now);
    expect(s2.assets.keeper.media[""].asset.versions.map((v) => v.id)).toEqual(["kv1", "kv3"]);
  });
  it("mergeSeries combines versions and keeps both sides' assets", () => {
    const { s } = ep1();
    const other = { ...s, assets: { ...s.assets, extra: { ...s.assets.keeper, id: "extra" } } };
    const m = series.mergeSeries(s, other, now);
    expect(Object.keys(m.assets).sort()).toEqual(["extra", "keeper"]);
    expect(series.parseSeries(JSON.parse(JSON.stringify(m)))?.id).toBe("ser1");
    expect(series.parseSeries({ format: "x" })).toBeUndefined();
  });
});
