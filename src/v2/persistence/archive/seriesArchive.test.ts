import { describe, expect, it } from "vitest";
import * as board from "../../domain/storyboard";
import { createProject, type MediaRef } from "../../domain/model";
import * as series from "../../domain/series";
import { validateStoryboard } from "../../domain/storyJson";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { createMemoryStorage } from "../memory";
import { ArchiveError, BlobSink, exportProjectArchive, exportSeriesArchive, importProjectArchive, importSeriesArchive, readAnyArchive, readProjectArchive } from "./projectArchive";

const now = "2026-10-29T00:00:00Z";
async function episode() {
  const storage = createMemoryStorage();
  await storage.blobs.put("k1", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  await storage.blobs.put("k1t", new Blob([new Uint8Array([4])], { type: "image/jpeg" }));
  const r = validateStoryboard(JSON.parse(JSON.stringify(LANTERN_KEEPER)));
  if (!r.ok) throw new Error("fixture");
  let p = board.setStoryboard(createProject("Ep1"), board.storyboardFromDoc(r.doc));
  p = board.addStoryVersion(p, { slot: "keeper" }, { blobKey: "k1", mime: "image/png", thumbKey: "k1t" } as MediaRef, { versionId: "kv1", now });
  const pr = series.promoteToSeries(series.createSeries("Lantern", now, "ser1"), p, "keeper", now)!;
  return { storage, s: pr.series, p: { ...pr.project, seriesId: "ser1" } };
}

describe("Series archives (P5)", () => {
  it("round-trips a whole-Series zip with fresh media keys", async () => {
    const { storage, s } = await episode();
    const sink = new BlobSink();
    const out = await exportSeriesArchive(s, storage.blobs, sink);
    expect(out.manifest).toMatchObject({ format: "dionysus.series", series: { id: "ser1", name: "Lantern", assets: 1 }, missing: [] });
    const a = await readAnyArchive(sink.blob());
    expect("project" in a).toBe(false);
    const here = createMemoryStorage();
    const got = await importSeriesArchive(here, a as never);
    expect(got.id).toBe("ser1");
    const v = got.assets.keeper.media[""].asset.versions[0];
    expect(v.media.blobKey).not.toBe("k1");
    expect(await (await here.blobs.get(v.media.blobKey))!.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
    await expect(readProjectArchive(sink.blob())).rejects.toThrow(ArchiveError);
  });

  it("an episode zip bundles the Series assets it uses and hands them back remapped", async () => {
    const { storage, s, p } = await episode();
    const sink = new BlobSink();
    const r = await exportProjectArchive(p, storage.blobs, sink, { series: series.seriesForProject(s, p) });
    expect(r.manifest.series).toEqual({ id: "ser1", name: "Lantern", assets: 1 });
    const a = await readProjectArchive(sink.blob());
    expect(a.series?.id).toBe("ser1");
    const here = createMemoryStorage();
    let seen: series.Series | undefined;
    const q = await importProjectArchive(here, a, "new", { onSeries: (x) => { seen = x; } });
    expect(q.seriesId).toBe("ser1");
    const pk = Object.values(q.assets)[0].versions[0].media.blobKey;
    expect(seen!.assets.keeper.media[""].asset.versions[0].media.blobKey).toBe(pk);
    expect(series.pullSeries(q, seen!)).toBe(q);
  });
});
