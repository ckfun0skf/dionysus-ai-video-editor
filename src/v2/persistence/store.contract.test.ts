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
    await collectUnusedBlobs(s);
    expect(await s.blobs.get("orphan/1")).toBeUndefined();
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
