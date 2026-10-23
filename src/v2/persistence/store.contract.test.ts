import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "../domain/model";
import { Engine } from "../engine/engine";
import { renameProject } from "../engine/commands";
import type { Storage } from "../ports/storage";
import { attachAutosave } from "./autosave";
import { collectUnusedBlobs } from "./gc";
import { createIndexedDbStorage } from "./indexeddb";
import { createMemoryStorage } from "./memory";

const impls: [string, () => Storage][] = [["memory", createMemoryStorage], ["indexeddb (fake)", createIndexedDbStorage]];

describe.each(impls)("Storage contract: %s", (_name, make) => {
  it("saves, lists, loads and deletes projects", async () => {
    const s = make();
    const p = createProject("Contract");
    await s.projects.save(p);
    expect((await s.projects.list()).map((x) => x.id)).toContain(p.id);
    expect((await s.projects.load(p.id))?.name).toBe("Contract");
    await s.projects.delete(p.id);
    expect(await s.projects.load(p.id)).toBeUndefined();
  });
  it("stores blobs, lists keys and collects unused ones", async () => {
    const s = make();
    await s.blobs.put("orphan/1", new Blob(["x"]));
    expect(await s.blobs.keys()).toContain("orphan/1");
    expect(await s.blobs.get("orphan/1")).toBeDefined();
    await collectUnusedBlobs(s, { graceMs: 0, locks: null });
    expect(await s.blobs.get("orphan/1")).toBeUndefined();
  });

  it("GC: orphans survive the grace period; nothing is deleted if a project fails to load; never throws", async () => {
    const s = make();
    const p = createProject("keep");
    p.assets.a = { id: "a", kind: "image", name: "a", versions: [{ id: "1", createdAt: "", media: { blobKey: "a/1", mime: "image/png" }, provenance: { source: "import", inputs: [] } }] };
    await s.projects.save(p);
    await s.blobs.put("a/1", new Blob(["a"]));
    await s.blobs.put("orphan/2", new Blob(["x"]));
    let t = 1000;
    const opts = { graceMs: 500, now: () => t, locks: null };
    expect(await collectUnusedBlobs(s, opts)).toBe(0); // first sighting: marked only
    t = 1400;
    expect(await collectUnusedBlobs(s, opts)).toBe(0);
    const broken = { ...s, projects: { ...s.projects, load: async () => { throw new Error("corrupt"); } } };
    t = 2000;
    expect(await collectUnusedBlobs(broken, opts)).toBe(0); // references unknown: keep everything
    expect(await s.blobs.get("orphan/2")).toBeDefined();
    expect(await collectUnusedBlobs(s, opts)).toBe(1);
    expect(await s.blobs.get("orphan/2")).toBeUndefined();
    expect(await s.blobs.get("a/1")).toBeDefined();
    const onError = vi.fn();
    const dead = { ...s, projects: { ...s.projects, list: async () => { throw new Error("idb closed"); } } };
    await expect(collectUnusedBlobs(dead, { ...opts, onError })).resolves.toBe(0);
    expect(onError).toHaveBeenCalled();
  });

  it("GC: skips when another tab holds the lock", async () => {
    const s = make();
    await s.blobs.put("orphan/3", new Blob(["x"]));
    const busy = { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<number>) => cb(null) };
    expect(await collectUnusedBlobs(s, { graceMs: 0, locks: busy as never })).toBe(0);
    const free = { request: async (_n: string, _o: unknown, cb: (l: unknown) => Promise<number>) => cb({}) };
    expect(await collectUnusedBlobs(s, { graceMs: 0, locks: free as never })).toBe(1);
  });
});

describe("autosave", () => {
  it("retries failed saves and only marks saved on success", async () => {
    vi.useFakeTimers();
    const e = new Engine(createProject("t"));
    let fail = 2;
    const saved: string[] = [];
    const store = { ...createMemoryStorage().projects, save: async (p: { name: string }) => { if (fail-- > 0) throw new Error("quota"); saved.push(p.name); } };
    const onError = vi.fn();
    const auto = attachAutosave(e, store as never, 100, onError);
    e.dispatch(renameProject("x"));
    await vi.advanceTimersByTimeAsync(100);
    expect(auto.isDirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(saved).toEqual(["x"]);
    expect(auto.isDirty()).toBe(false);
    auto.dispose();
    vi.useRealTimers();
  });
});
