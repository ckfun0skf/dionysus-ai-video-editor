import { describe, expect, it } from "vitest";
import { createProject, type Asset } from "../domain/model";
import { collectUnusedBlobs } from "../persistence/gc";
import { createMemoryStorage } from "../persistence/memory";
import { projectMediaList } from "./projectMedia";

const asset = (id: string, kind: Asset["kind"], createdAt: string, name = id): Asset => ({ id, kind, name, versions: [{ id: "v", createdAt, media: { blobKey: `${id}/v`, mime: "x", durationTicks: 240_000 }, provenance: { source: "import", inputs: [] } }] });

describe("Project media", () => {
  it("lists video/image/html/audio assets newest first, skipping stickers", () => {
    const p = createProject("t");
    p.assets = { a: asset("a", "image", "2026-01-01"), b: asset("b", "video", "2026-03-01"), c: asset("c", "audio", "2026-02-01"), h: asset("h", "html", "2026-04-01"), s: asset("s", "image", "2026-05-01", "sticker-circle.png") };
    expect(projectMediaList(p, { b: "blob:b" }).map((m) => `${m.id}:${m.thumb ?? ""}`)).toEqual(["h:", "b:blob:b", "c:", "a:"]);
  });
  it("GC keeps blobs of listed assets even when no clip uses them", async () => {
    const s = createMemoryStorage();
    const p = createProject("t");
    p.assets = { a: asset("a", "video", "2026-01-01") };
    await s.projects.save(p);
    await s.blobs.put("a/v", new Blob(["x"]));
    let t = 0; const opts = { graceMs: 1, now: () => t, locks: null };
    await collectUnusedBlobs(s, opts); t = 10 ** 9; await collectUnusedBlobs(s, opts);
    expect(await s.blobs.get("a/v")).toBeDefined();
  });
});
