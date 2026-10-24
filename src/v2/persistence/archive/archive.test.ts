import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createProject, type Project } from "../../domain/model";
import { addShot } from "../../domain/storyEdit";
import { createIndexedDbStorage } from "../indexeddb";
import { createMemoryStorage } from "../memory";
import { ArchiveError, BlobSink, exportProjectArchive, importProjectArchive, readProjectArchive, ARCHIVE_VERSION, type ArchiveManifest } from "./projectArchive";
import { Sha256, crc32 } from "./sha256";
import { ZipWriter, readZipIndex, zipEntryBlob } from "./zip";

const enc = new TextEncoder();
const bytes = (len: number, seed = 1) => { const a = new Uint8Array(len); for (let i = 0; i < len; i++) a[i] = (i * 31 + seed * 7) & 255; return a; };
const read = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe("sha256 / crc32", () => {
  it("match known vectors and Node's implementation across chunk boundaries", () => {
    expect(new Sha256().hex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(new Sha256().update(enc.encode("abc")).hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const n of [55, 56, 63, 64, 65, 1000, 100_003]) {
      const d = bytes(n, n);
      const s = new Sha256();
      for (let i = 0; i < n; i += 37) s.update(d.subarray(i, i + 37));
      expect(s.hex()).toBe(createHash("sha256").update(d).digest("hex"));
    }
    expect(crc32(0, enc.encode("123456789")).toString(16)).toBe("cbf43926");
    expect(crc32(crc32(0, enc.encode("12345")), enc.encode("6789")).toString(16)).toBe("cbf43926");
  });
});

describe("zip", () => {
  it("writes STORE entries with UTF-8 names that the reader slices back without copying", async () => {
    const sink = new BlobSink();
    const z = new ZipWriter(sink, new Date(2026, 9, 24, 12, 0, 0));
    await z.addBytes("manifest.json", enc.encode("{}"));
    const big = bytes(300_000);
    await z.add("media/clip é.mp4", { size: big.length, crc: crc32(0, big) }, (async function* () { yield big.subarray(0, 100_000); yield big.subarray(100_000); })());
    await z.finish();
    const file = sink.blob();
    const idx = await readZipIndex(file);
    expect([...idx.keys()]).toEqual(["manifest.json", "media/clip é.mp4"]);
    const e = idx.get("media/clip é.mp4")!;
    expect(e).toMatchObject({ method: 0, size: 300_000, compressedSize: 300_000 });
    expect(await read(await zipEntryBlob(file, e))).toEqual(big);
  });

  it("refuses a stream that doesn't match the size/CRC from the hashing pass", async () => {
    const z = new ZipWriter(new BlobSink());
    await expect(z.add("a", { size: 3, crc: 0 }, (async function* () { yield bytes(3); })())).rejects.toThrow(/changed/);
  });

  it("reads a deflated entry (archive re-zipped by another tool) when DecompressionStream exists", async () => {
    const zlib = await import("node:zlib");
    const raw = enc.encode("hello hello hello hello");
    const def = new Uint8Array(zlib.deflateRawSync(raw));
    const sink = new BlobSink();
    const z = new ZipWriter(sink);
    await z.add("x.txt", { size: def.length, crc: crc32(0, def) }, (async function* () { yield def; })());
    await z.finish();
    const file = sink.blob();
    const e = (await readZipIndex(file)).get("x.txt")!;
    e.method = 8; e.compressedSize = def.length; e.size = raw.length;
    expect(new TextDecoder().decode(await read(await zipEntryBlob(file, e)))).toBe("hello hello hello hello");
  });

  it("parses ZIP64 end records", async () => {
    // Hand-build an archive whose EOCD defers to the ZIP64 record.
    const sink = new BlobSink();
    const z = new ZipWriter(sink);
    await z.addBytes("a.txt", enc.encode("abc"));
    await z.finish();
    const plain = await read(sink.blob());
    const eocd = plain.length - 22;
    const cdOffset = new DataView(plain.buffer).getUint32(eocd + 16, true);
    const cdSize = new DataView(plain.buffer).getUint32(eocd + 12, true);
    const out = new Uint8Array(eocd + 56 + 20 + 22);
    out.set(plain.subarray(0, eocd));
    const dv = new DataView(out.buffer);
    let p = eocd;
    dv.setUint32(p, 0x06064b50, true); dv.setUint32(p + 4, 44, true); dv.setUint32(p + 24, 1, true); dv.setUint32(p + 32, 1, true);
    dv.setUint32(p + 40, cdSize, true); dv.setUint32(p + 48, cdOffset, true);
    p += 56;
    dv.setUint32(p, 0x07064b50, true); dv.setUint32(p + 8, eocd, true); dv.setUint32(p + 16, 1, true);
    p += 20;
    dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 8, 0xffff, true); dv.setUint16(p + 10, 0xffff, true);
    dv.setUint32(p + 12, 0xffffffff, true); dv.setUint32(p + 16, 0xffffffff, true);
    const idx = await readZipIndex(new Blob([out]));
    expect(new TextDecoder().decode(await read(await zipEntryBlob(new Blob([out]), idx.get("a.txt")!)))).toBe("abc");
  });
});

/** A project using the v1.1 fields: versions, thumbnails, keyframes, transitions, effects, text, linked audio, storyboard. */
function richProject(): Project {
  let p = createProject("Ep 01 — Opening", "2026-10-01T00:00:00.000Z");
  const v = (id: string, key: string, mime: string, thumbKey?: string) => ({ id, createdAt: "2026-10-01T00:00:00.000Z", media: { blobKey: key, mime, durationTicks: 1_200_000, width: 1920, height: 1080, ...(thumbKey ? { thumbKey } : {}) }, provenance: { source: "manual-generation" as const, promptText: "A neon street at night", inputs: [] } });
  p.assets = {
    a1: { id: "a1", kind: "video", name: "Shot 1", versions: [v("v1", "a1/v1", "video/mp4", "a1/v1.thumb"), v("v2", "a1/v2", "video/mp4")], selectedVersionId: "v2" },
    a2: { id: "a2", kind: "audio", name: "Music", versions: [v("v1", "a2/v1", "audio/mpeg")] },
    a3: { id: "a3", kind: "image", name: "Same bytes as a1/v1", versions: [v("v1", "a3/v1", "video/mp4")] },
  };
  const comp = p.compositions[p.rootCompositionId];
  comp.tracks[0].placements = [
    { id: "p1", startTicks: 0, durationTicks: 600_000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a1", versionId: "v2" }, clipType: "video", keyframes: { opacity: [{ t: 0, v: 0 }, { t: 120_000, v: 1 }] }, fadeOutTicks: 60_000, speed: 1.5, transform: { x: 0.1, y: 0, scale: 1.2, rotation: 5, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } } as never, linkedAudio: { muted: false } as never },
    { id: "p2", startTicks: 600_000, durationTicks: 600_000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a1", versionId: "v1" }, clipType: "video", transitionIn: { kind: "crossfade", durationTicks: 60_000 } },
  ];
  comp.tracks[1].placements = [{ id: "p3", startTicks: 0, durationTicks: 1_200_000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a2", versionId: "v1" }, clipType: "audio", volume: 0.8 }];
  p = addShot(p, "s1", { title: "Opening" } as never);
  return p;
}

async function seeded(storage: ReturnType<typeof createMemoryStorage>, p: Project) {
  await storage.blobs.put("a1/v1", new Blob([bytes(50_000, 1)], { type: "video/mp4" }));
  await storage.blobs.put("a1/v1.thumb", new Blob([bytes(900, 2)], { type: "image/jpeg" }));
  await storage.blobs.put("a1/v2", new Blob([bytes(70_000, 3)], { type: "video/mp4" }));
  await storage.blobs.put("a2/v1", new Blob([bytes(20_000, 4)], { type: "audio/mpeg" }));
  await storage.blobs.put("a3/v1", new Blob([bytes(50_000, 1)], { type: "video/mp4" }));
  await storage.projects.save(p);
}

async function exportZip(p: Project, storage: ReturnType<typeof createMemoryStorage>) {
  const sink = new BlobSink();
  const res = await exportProjectArchive(p, storage.blobs, sink);
  return { file: sink.blob(), ...res };
}

/** The project with blob keys replaced by their bytes' hashes, for comparing across key remaps. */
async function normalized(p: Project, storage: ReturnType<typeof createMemoryStorage>) {
  const q = structuredClone(p);
  for (const a of Object.values(q.assets)) for (const v of a.versions) {
    v.media.blobKey = createHash("sha256").update(await read((await storage.blobs.get(v.media.blobKey))!)).digest("hex");
    if (v.media.thumbKey) v.media.thumbKey = createHash("sha256").update(await read((await storage.blobs.get(v.media.thumbKey))!)).digest("hex");
  }
  return q;
}

describe("project archive (V2-CUT-PROJ)", () => {
  it("round-trips a v1.1 project with every version and thumbnail into another browser's storage", async () => {
    const src = createMemoryStorage();
    const p = richProject();
    await seeded(src, p);
    const { file, manifest } = await exportZip(p, src);
    expect(manifest).toMatchObject({ format: "dionysus.project", formatVersion: 1, app: { name: "Dionysus" }, schema: "dionysus/3.1", project: { id: p.id, name: p.name }, missing: [] });
    expect(manifest.media).toHaveLength(5);
    const idx = await readZipIndex(file);
    expect([...idx.keys()].filter((k) => k.startsWith("media/"))).toHaveLength(4); // a1/v1 and a3/v1 share bytes
    expect([...idx.values()].every((e) => e.method === 0)).toBe(true);

    const dst = createIndexedDbStorage(`arch-${Math.random()}`);
    const preview = await readProjectArchive(file);
    const progress: number[] = [];
    const got = await importProjectArchive(dst, preview, "new", { onProgress: (x) => progress.push(x.done / x.total) });
    expect(progress.at(-1)).toBe(1);
    expect(got.id).toBe(p.id);
    expect(Object.values(got.assets).flatMap((a) => a.versions.map((v) => v.media.blobKey)).every((k) => k.startsWith("imp_"))).toBe(true);
    const loaded = (await dst.projects.load(p.id))!;
    const a = await normalized(p, src), b = await normalized(loaded, dst as never);
    b.meta.updatedAt = a.meta.updatedAt;
    expect(b).toEqual(a);
    expect(loaded.storyboard).toEqual(p.storyboard);
  });

  it("streams from IndexedDB chunk by chunk (no whole-blob reads)", async () => {
    const src = createIndexedDbStorage(`arch-${Math.random()}`, { chunkBytes: 4096 });
    const p = richProject();
    await seeded(src as never, p);
    let gets = 0;
    const blobs = { ...src.blobs, get: async (k: string) => { gets++; return src.blobs.get(k); } };
    const sink = new BlobSink();
    await exportProjectArchive(p, blobs, sink);
    expect(gets).toBe(0);
    const pre = await readProjectArchive(sink.blob());
    const dst = createMemoryStorage();
    const got = await importProjectArchive(dst, pre, "new");
    expect(await read((await dst.blobs.get(got.assets.a1.versions[1].media.blobKey))!)).toEqual(bytes(70_000, 3));
  });

  it("imports as a copy with a new id and name, leaving the original untouched", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { file } = await exportZip(p, s);
    const copy = await importProjectArchive(s, await readProjectArchive(file), "copy");
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe("Ep 01 — Opening (copy)");
    expect((await s.projects.list()).map((x) => x.id).sort()).toEqual([p.id, copy.id].sort());
    expect(await s.projects.load(p.id)).toEqual(p);
  });

  it("replaces a project with the same id", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { file } = await exportZip(p, s);
    await s.projects.save({ ...p, name: "Edited since" });
    const r = await importProjectArchive(s, await readProjectArchive(file), "replace");
    expect(r.id).toBe(p.id);
    expect((await s.projects.load(p.id))!.name).toBe(p.name);
    expect((await s.projects.list())).toHaveLength(1);
  });

  it("exports a project whose media is missing and imports it with the gap recorded", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    await s.blobs.delete("a2/v1");
    const { file, manifest } = await exportZip(p, s);
    expect(manifest.missing).toEqual(["a2/v1"]);
    const dst = createMemoryStorage();
    const got = await importProjectArchive(dst, await readProjectArchive(file), "new");
    expect(await dst.blobs.get(got.assets.a2.versions[0].media.blobKey)).toBeUndefined();
    expect(got.assets.a2.versions[0].media.blobKey).toMatch(/^imp_.*\/missing\/a2\/v1$/);
  });

  it("rejects corrupted media by checksum and stores nothing", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { file } = await exportZip(p, s);
    const buf = await read(file);
    const e = [...(await readZipIndex(file)).values()].find((x) => x.name.startsWith("media/") && x.size === 70_000)!;
    buf[e.localOffset + 30 + e.name.length + 500] ^= 0xff; // flip a byte inside the media data
    const dst = createMemoryStorage();
    const pre = await readProjectArchive(new Blob([buf]));
    await expect(importProjectArchive(dst, pre, "new")).rejects.toThrow(/damaged.*checksum/);
    expect(await dst.blobs.keys()).toEqual([]);
    expect(await dst.projects.list()).toEqual([]);
  });

  it("rejects an archive with a media entry missing", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { manifest } = await exportZip(p, s);
    const sink = new BlobSink();
    const z = new ZipWriter(sink);
    await z.addBytes("manifest.json", enc.encode(JSON.stringify(manifest)));
    await z.addBytes("project.json", enc.encode(JSON.stringify(p)));
    await z.finish();
    await expect(readProjectArchive(sink.blob())).rejects.toThrow(/incomplete: 4 media file\(s\) are missing/);
  });

  it("rejects a truncated download and a file that isn't a zip", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { file } = await exportZip(p, s);
    await expect(readProjectArchive(file.slice(0, file.size - 2000))).rejects.toBeInstanceOf(ArchiveError);
    await expect(readProjectArchive(new Blob(["not a zip at all, just some text…".repeat(3)]))).rejects.toThrow(/not a zip/);
  });

  it("explains a version mismatch (newer archive format or newer project schema)", async () => {
    const make = async (m: Partial<ArchiveManifest>, project: unknown) => {
      const sink = new BlobSink();
      const z = new ZipWriter(sink);
      await z.addBytes("manifest.json", enc.encode(JSON.stringify({ format: "dionysus.project", formatVersion: 1, media: [], missing: [], app: { name: "Dionysus", version: "9.0.0" }, ...m })));
      await z.addBytes("project.json", enc.encode(JSON.stringify(project)));
      await z.finish();
      return sink.blob();
    };
    const p = createProject("x");
    await expect(readProjectArchive(await make({ formatVersion: ARCHIVE_VERSION + 1 }, p))).rejects.toThrow(/newer version of Dionysus.*Reload.*made by Dionysus 9\.0\.0/);
    await expect(readProjectArchive(await make({}, { ...p, schema: "dionysus/4.0" }))).rejects.toThrow(/newer version of Dionysus.*dionysus\/4\.0/);
    await expect(readProjectArchive(await make({ format: "other" as never }, p))).rejects.toThrow(/not a Dionysus project file/);
    // An older schema migrates on import.
    const old = await readProjectArchive(await make({}, { ...p, schema: "dionysus/3.0" }));
    expect(old.project.schema).toBe("dionysus/3.1");
  });

  it("can be cancelled; partially stored media is removed", async () => {
    const s = createMemoryStorage();
    const p = richProject();
    await seeded(s, p);
    const { file } = await exportZip(p, s);
    const dst = createMemoryStorage();
    const ac = new AbortController();
    const pre = await readProjectArchive(file);
    await expect(importProjectArchive(dst, pre, "new", { signal: ac.signal, onProgress: (x) => { if (x.done > x.total / 2) ac.abort(); } })).rejects.toThrow(/Cancelled/);
    expect(await dst.blobs.keys()).toEqual([]);
  });
});
