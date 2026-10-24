import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDbHandle, createIndexedDbStorage, STORAGE_FULL } from "./indexeddb";
import { importFile, mimeOf } from "./media";

let n = 0;
const name = () => `chunk-test-${++n}`;
const bytes = (len: number) => { const a = new Uint8Array(len); for (let i = 0; i < len; i++) a[i] = (i * 7 + 3) & 255; return a; };
const read = async (b: Blob) => new Uint8Array(await new Response(b).arrayBuffer());
afterEach(() => vi.restoreAllMocks());

describe("V2-108 chunked media storage (iOS Safari can't store File/Blob in IndexedDB)", () => {
  it("round-trips a multi-chunk file byte-for-byte with its type, storing only ArrayBuffers", async () => {
    const db = name();
    const s = createIndexedDbStorage(db, { chunkBytes: 1000 });
    const src = bytes(12_345); // 13 chunks: also checks "k:10" sorts after "k:2"
    await s.blobs.put("ast/ver", new File([src], "IMG_5669.mov", { type: "video/quicktime" }));
    const h = createDbHandle(db);
    const manifest = await h.run("blobs", "readonly", (st) => st.get("ast/ver"));
    expect(manifest).toEqual({ v2chunks: 1, type: "video/quicktime", size: 12_345, count: 13 });
    const chunk = await h.run("chunks", "readonly", (st) => st.get("ast/ver:12"));
    expect(chunk).toBeInstanceOf(ArrayBuffer);
    expect((chunk as ArrayBuffer).byteLength).toBe(345);
    const out = (await s.blobs.get("ast/ver"))!;
    expect(out.type).toBe("video/quicktime");
    expect(out.size).toBe(12_345);
    expect(await read(out)).toEqual(src);
    expect(await s.blobs.keys()).toEqual(["ast/ver"]); // chunks never show up as blob keys (GC-safe)
  });

  it("reads records stored before V2-108 (raw Blob values)", async () => {
    const db = name();
    const h = createDbHandle(db);
    await h.run("blobs", "readwrite", (st) => st.put(new Blob(["legacy"], { type: "text/plain" }), "old/1"));
    const s = createIndexedDbStorage(db);
    const b = (await s.blobs.get("old/1"))!;
    expect(await b.text()).toBe("legacy");
    await s.blobs.delete("old/1");
    expect(await s.blobs.get("old/1")).toBeUndefined();
  });

  it("handles empty blobs, overwrites (dropping stale chunks) and deletes chunks", async () => {
    const db = name();
    const s = createIndexedDbStorage(db, { chunkBytes: 10 });
    await s.blobs.put("e", new Blob([]));
    expect((await s.blobs.get("e"))!.size).toBe(0);
    await s.blobs.put("k", new Blob([bytes(95)]));
    await s.blobs.put("k", new Blob([bytes(15)]));
    expect(await read((await s.blobs.get("k"))!)).toEqual(bytes(15));
    const h = createDbHandle(db);
    expect(await h.run("chunks", "readonly", (st) => st.count())).toBe(3); // e:0 + k:0,k:1
    await s.blobs.delete("k");
    expect(await h.run("chunks", "readonly", (st) => st.count())).toBe(1);
  });

  it("quota errors give a clear message and leave nothing half-written", async () => {
    const db = name();
    const s = createIndexedDbStorage(db, { chunkBytes: 10 });
    const real = new Blob([bytes(30)]);
    let reads = 0;
    const flaky = { size: 30, type: "video/mp4", slice: (a: number, b: number) => ({ arrayBuffer: () => (++reads === 2 ? Promise.reject(new DOMException("full", "QuotaExceededError")) : real.slice(a, b).arrayBuffer()) }) } as unknown as Blob;
    await expect(s.blobs.put("q", flaky)).rejects.toThrow(STORAGE_FULL);
    expect(await s.blobs.get("q")).toBeUndefined();
    expect(await createDbHandle(db).run("chunks", "readonly", (st) => st.count())).toBe(0);
  });

  it("asks for persistent storage (best effort)", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persist } });
    vi.resetModules();
    const { createIndexedDbStorage: fresh } = await import("./indexeddb");
    await fresh(name()).blobs.put("p", new Blob(["x"]));
    expect(persist).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("importFile stores picker files that arrive without a MIME type under a guessed one", async () => {
    expect(mimeOf({ name: "IMG_5669.MOV", type: "" })).toBe("video/quicktime");
    const s = createIndexedDbStorage(name(), { chunkBytes: 4 });
    const asset = (await importFile(new File([bytes(9)], "IMG_5669.mov", { type: "" }), s.blobs, async () => ({ durationTicks: 120000, width: 1080, height: 1920 })))!;
    const v = asset.versions[0].media;
    expect(v.mime).toBe("video/quicktime");
    const b = (await s.blobs.get(v.blobKey))!;
    expect(b.type).toBe("video/quicktime");
    expect(await read(b)).toEqual(bytes(9));
  });
});
