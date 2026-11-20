/**
 * P84 (Phase 3 step 3.2): plugin packages, the content hash, the project lock, archives, GC, runtime registration and
 * the device library. docs/v2/PLUGIN_PACKAGE.md, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3.
 */
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, PLUGIN_LIMITS, TEXT_SOURCE, timelineReview, validateComposition, type Placement, type Project } from "../domain";
import { CLIP_TYPES, clipTypeOf, isKnownClipType, pluginIssueOf, setPluginIssues } from "../clipTypes";
import { createIndexedDbStorage } from "./indexeddb";
import { createMemoryStorage } from "./memory";
import { collectUnusedBlobs } from "./gc";
import { BlobSink, exportProjectArchive, importProjectArchive, readProjectArchive } from "./archive/projectArchive";
import { ZipWriter } from "./archive/zip";
import {
  PluginConflictError, PluginPackageError, addPluginToProject, createIndexedDbPluginLibrary, createMemoryPluginLibrary, fetchPluginPackage,
  loadProjectPlugins, pluginBlobKey, pluginContentHash, pluginUrlProblem, pluginZipBlob, readPluginZip, syncProjectPlugins, type PluginPackage,
} from "./plugins";

const S = 120_000;
const enc = new TextEncoder();
const LIBS = ["three"];
const DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
const sampleManifest = readFileSync(resolve(DIR, "manifest.json"));
const sampleRender = readFileSync(resolve(DIR, "render.js"));

async function zipOf(entries: [string, Uint8Array | string][]): Promise<Blob> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  for (const [n, d] of entries) await z.addBytes(n, typeof d === "string" ? enc.encode(d) : d);
  await z.finish();
  return sink.blob();
}
const sampleZip = () => zipOf([["manifest.json", sampleManifest], ["render.js", sampleRender]]);
const manifestWith = (over: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(sampleManifest.toString()), ...over });
const pluginClip = (id = "pc", clipType = "x-dionysus-stripes", params?: Record<string, string | number | boolean>): Placement =>
  ({ id, startTicks: 0, durationTicks: 3 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: clipType as Placement["clipType"], ...(params ? { plugin: { data: { params }, v: "1.0.0" } } : {}) });
function projectWithClip(p: Project = createProject("plugins"), pl = pluginClip("pc", "x-dionysus-stripes", { title: "Hi", count: 12 })): Project {
  const comp = p.compositions[p.rootCompositionId];
  comp.tracks.find((t) => t.kind === "video")!.placements.push(pl);
  return p;
}

afterEach(() => { CLIP_TYPES.setRuntime([]); setPluginIssues([]); });

describe("plugin package and content hash (P84)", () => {
  it("hashes manifest.json then each listed file in path order (path, NUL, length, NUL, bytes)", () => {
    const files = new Map<string, Uint8Array>([["b.js", enc.encode("bb")], ["a/x.json", enc.encode("{}")]]);
    const m = enc.encode("{\"m\":1}");
    const raw = Buffer.concat([
      Buffer.from("manifest.json\u00007\u0000"), Buffer.from(m),
      Buffer.from("a/x.json\u00002\u0000{}"), Buffer.from("b.js\u00002\u0000bb"),
    ]);
    expect(pluginContentHash(m, files)).toBe(`sha256-${createHash("sha256").update(raw).digest("hex")}`);
    // Order of the map doesn't matter; any byte change does.
    expect(pluginContentHash(m, new Map([...files].reverse()))).toBe(pluginContentHash(m, files));
    expect(pluginContentHash(m, new Map([["b.js", enc.encode("bc")], ["a/x.json", enc.encode("{}")]]))).not.toBe(pluginContentHash(m, files));
  });

  it("reads the sample package from a zip, at the root or inside one folder, with the same hash", async () => {
    const a = await readPluginZip(await sampleZip(), { libs: LIBS });
    expect(a.manifest.id).toBe("x-dionysus-stripes");
    expect([...a.files.keys()]).toEqual(["render.js"]);
    expect(a.hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(a.size).toBe(sampleManifest.length + sampleRender.length);
    const b = await readPluginZip(await zipOf([["stripes/manifest.json", sampleManifest], ["stripes/render.js", sampleRender], ["__MACOSX/._x", "junk"], ["stripes/extra.txt", "x"]]));
    expect(b.hash).toBe(a.hash);
    expect(b.warnings).toEqual([expect.objectContaining({ level: "warning", message: expect.stringMatching(/extra\.txt/) })]);
    // The canonical stored zip reads back to the same hash.
    expect((await readPluginZip(await pluginZipBlob(a))).hash).toBe(a.hash);
  });

  it("refuses packages that aren't plugins, are incomplete, invalid, too new or too big", async () => {
    await expect(readPluginZip(new Blob(["nope"]))).rejects.toThrow(PluginPackageError);
    await expect(readPluginZip(await zipOf([["render.js", sampleRender]]))).rejects.toThrow(/manifest\.json is missing/);
    await expect(readPluginZip(await zipOf([["manifest.json", sampleManifest]]))).rejects.toThrow(/"render\.js" is listed but not in the package/);
    const bad = readPluginZip(await zipOf([["manifest.json", manifestWith({ id: "stripes", caps: { sound: true } })], ["render.js", sampleRender]]));
    await expect(bad).rejects.toThrow(/2 problems: id: .*caps\.sound/);
    await expect(readPluginZip(await zipOf([["manifest.json", manifestWith({ api: 9 })], ["render.js", sampleRender]]))).rejects.toThrow(/needs a newer Dionysus \(host API 9/);
    await expect(readPluginZip(await zipOf([["manifest.json", manifestWith({ render: { entry: "render.js", libs: ["jquery"] } })], ["render.js", sampleRender]]), { libs: LIBS })).rejects.toThrow(/jquery/);
    const big = new Uint8Array(PLUGIN_LIMITS.fileBytes + 1);
    await expect(readPluginZip(await zipOf([["manifest.json", manifestWith({ files: ["render.js", "big.bin"] })], ["render.js", sampleRender], ["big.bin", big]]))).rejects.toThrow(/"big\.bin" is 10\.0 MB; the most is 10 MB/);
  });

  it("fetches a package from a manifest URL (files relative to it) or a zip URL, without credentials", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const files: Record<string, Uint8Array> = { "https://cdn.example/p/manifest.json": sampleManifest, "https://cdn.example/p/render.js": sampleRender };
    const fakeFetch = (async (u: string, init?: RequestInit) => {
      calls.push([u, init]);
      if (u.endsWith(".zip")) return new Response(await sampleZip());
      return files[u] ? new Response(files[u]) : new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    const pkg = await fetchPluginPackage("https://cdn.example/p/manifest.json", { fetch: fakeFetch, libs: LIBS });
    expect(pkg.manifest.name).toBe("Moving stripes");
    expect(calls.map(([u]) => u)).toEqual(["https://cdn.example/p/manifest.json", "https://cdn.example/p/render.js"]);
    expect(calls.every(([, i]) => i?.credentials === "omit")).toBe(true);
    expect((await fetchPluginPackage("https://cdn.example/stripes.dionysus-cliptype.zip", { fetch: fakeFetch })).hash).toBe(pkg.hash);
    await expect(fetchPluginPackage("https://cdn.example/q/manifest.json", { fetch: fakeFetch })).rejects.toThrow(/HTTP 404/);
    expect(pluginUrlProblem("http://example.com/m.json")).toMatch(/https/);
    expect(pluginUrlProblem("ftp://x")).toMatch(/https/);
    expect(pluginUrlProblem("http://localhost:5173/plugins/samples/x/manifest.json")).toBeUndefined();
    await expect(fetchPluginPackage("http://example.com/m.json", { fetch: fakeFetch })).rejects.toThrow(/https/);
  });
});

describe("project lock, registration and the not-enabled state (P84)", () => {
  it("stores the package in the project (one blob, a lock) and refuses a changed package with the same version", async () => {
    const storage = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = await addPluginToProject(createProject("p"), pkg, storage.blobs);
    expect(p.plugins).toEqual({ "x-dionysus-stripes": { version: "1.0.0", hash: pkg.hash, name: "Moving stripes", publisher: "Dionysus samples", blobKey: pluginBlobKey(pkg.hash) } });
    expect(await storage.blobs.keys()).toEqual([pluginBlobKey(pkg.hash)]);
    expect(await addPluginToProject(p, pkg, storage.blobs)).toEqual(p);
    const changed = await readPluginZip(await zipOf([["manifest.json", sampleManifest], ["render.js", "dionysus.clip({render(){}})"]]));
    await expect(addPluginToProject(p, changed, storage.blobs)).rejects.toThrow(PluginConflictError);
    const v2 = await readPluginZip(await zipOf([["manifest.json", manifestWith({ version: "1.1.0" })], ["render.js", sampleRender]]));
    expect((await addPluginToProject(p, v2, storage.blobs)).plugins!["x-dionysus-stripes"].version).toBe("1.1.0");
  });

  it("registers a core built from the manifest; the clip is a visual, silent plugin clip described to agents", async () => {
    const storage = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = projectWithClip(await addPluginToProject(createProject("p"), pkg, storage.blobs));
    const pl = p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === "pc")!;
    expect(isKnownClipType("x-dionysus-stripes")).toBe(false);
    let told = 0;
    const off = CLIP_TYPES.subscribe(() => { told += 1; });
    const r = await syncProjectPlugins(p, storage.blobs, { libs: LIBS });
    expect(r.issues.size).toBe(0);
    expect(told).toBe(1);
    const core = clipTypeOf(pl);
    expect(core.id).toBe("x-dionysus-stripes");
    expect(core.caps).toEqual({ sourceTime: false, still: false, sound: false, visual: true, keyable: true, thumb: false, asset: "none" });
    expect(core.plugin).toMatchObject({ name: "Moving stripes", version: "1.0.0", hash: pkg.hash, durationSec: 5 });
    expect(validateComposition(p.compositions[p.rootCompositionId])).toEqual([]);
    const json = timelineReview.clipJson(p, pl);
    expect(json).not.toHaveProperty("unknown");
    expect(json).toMatchObject({ type: "x-dionysus-stripes", plugin: { name: "Moving stripes", version: "1.0.0" }, params: { title: "Hi", count: 12, colorA: "#111111", band: true } });
    // The same project again: same core objects, no change signal.
    await syncProjectPlugins(p, storage.blobs, { libs: LIBS });
    expect(told).toBe(1);
    // Another project without plugins: the type is gone and its clips are unknown again.
    await syncProjectPlugins(createProject("other"), storage.blobs);
    expect(told).toBe(2);
    expect(clipTypeOf(pl).id).toBe("unknown");
    off();
  });

  it("reports locked plugins it can't use (missing, damaged, newer) and falls back to the device library", async () => {
    const storage = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = await addPluginToProject(createProject("p"), pkg, storage.blobs);
    await storage.blobs.delete(pluginBlobKey(pkg.hash));
    let r = await syncProjectPlugins(p, storage.blobs);
    expect(r.cores).toEqual([]);
    expect(pluginIssueOf("x-dionysus-stripes")).toMatchObject({ state: "missing", name: "Moving stripes" });
    const library = createMemoryPluginLibrary();
    await library.add(pkg, "file:stripes.zip");
    r = await loadProjectPlugins(p, storage.blobs, { library });
    expect(r.cores.map((c) => c.id)).toEqual(["x-dionysus-stripes"]);
    // A package whose bytes don't match the lock.
    const other = await readPluginZip(await zipOf([["manifest.json", manifestWith({ version: "1.0.1" })], ["render.js", sampleRender]]));
    await storage.blobs.put(pluginBlobKey(pkg.hash), await pluginZipBlob(other));
    r = await loadProjectPlugins(p, storage.blobs);
    expect(r.issues.get("x-dionysus-stripes")).toMatchObject({ state: "damaged", message: expect.stringMatching(/doesn't match the project's lock/) });
    // A package that needs a newer editor (lock hash matches the stored bytes).
    const newer = await zipOf([["manifest.json", manifestWith({ api: 2 })], ["render.js", sampleRender]]);
    const q = { ...p, plugins: { "x-dionysus-stripes": { ...p.plugins!["x-dionysus-stripes"], blobKey: "plugin/newer" } } };
    await storage.blobs.put("plugin/newer", newer);
    r = await loadProjectPlugins(q, storage.blobs);
    expect(r.issues.get("x-dionysus-stripes")?.state).toBe("newer");
    // Malformed locks are ignored, not fatal.
    r = await loadProjectPlugins({ plugins: { "x-a": { version: "x" } as never, video: p.plugins!["x-dionysus-stripes"] } }, storage.blobs);
    expect(r).toEqual({ cores: [], issues: new Map() });
  });

  it("refuses runtime ids that aren't x-… or shadow a built-in", () => {
    const core = { id: "video", version: 1, description: "d", trackKind: "video" as const, caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: true, thumb: false, asset: "none" as const } };
    expect(() => CLIP_TYPES.setRuntime([core])).toThrow(/start with "x-"/);
    expect(() => CLIP_TYPES.setRuntime([{ ...core, id: "x-a" }, { ...core, id: "x-a" }])).toThrow(/listed twice/);
    expect(CLIP_TYPES.setRuntime([{ ...core, id: "x-a" }])).toBe(true);
    expect(CLIP_TYPES.runtime().map((c) => c.id)).toEqual(["x-a"]);
  });
});

describe("plugins in saved projects, archives and GC (P84)", () => {
  it("round-trips Project.plugins and Placement.plugin through IndexedDB unchanged", async () => {
    const storage = createIndexedDbStorage(`plug-${Math.random()}`);
    const pkg = await readPluginZip(await sampleZip());
    const p = projectWithClip(await addPluginToProject(createProject("p"), pkg, storage.blobs));
    await storage.projects.save(p);
    const back = (await storage.projects.load(p.id))!;
    expect(back.plugins).toEqual(p.plugins);
    expect(back.compositions[back.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === "pc")!.plugin).toEqual({ data: { params: { title: "Hi", count: 12 } }, v: "1.0.0" });
    expect(await storage.blobs.get(pluginBlobKey(pkg.hash))).toBeDefined();
  });

  it("carries the package in a project archive and re-points the lock on import", async () => {
    const src = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = projectWithClip(await addPluginToProject(createProject("p"), pkg, src.blobs));
    const sink = new BlobSink();
    const { manifest } = await exportProjectArchive(p, src.blobs, sink);
    expect(manifest.media).toEqual([expect.objectContaining({ key: pluginBlobKey(pkg.hash), mime: "application/zip" })]);
    const dst = createIndexedDbStorage(`plug-arch-${Math.random()}`);
    const imported = await importProjectArchive(dst, await readProjectArchive(sink.blob()), "copy");
    const lock = imported.plugins!["x-dionysus-stripes"];
    expect(lock).toMatchObject({ hash: pkg.hash, version: "1.0.0" });
    expect(lock.blobKey).not.toBe(pluginBlobKey(pkg.hash));
    const r = await syncProjectPlugins(imported, dst.blobs);
    expect(r.cores.map((c) => c.id)).toEqual(["x-dionysus-stripes"]);
    expect(r.issues.size).toBe(0);
  });

  it("exports a project whose package is gone with the gap recorded; the import reports it missing", async () => {
    const src = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = await addPluginToProject(createProject("p"), pkg, src.blobs);
    await src.blobs.delete(pluginBlobKey(pkg.hash));
    const sink = new BlobSink();
    expect((await exportProjectArchive(p, src.blobs, sink)).manifest.missing).toEqual([pluginBlobKey(pkg.hash)]);
    const dst = createMemoryStorage();
    const imported = await importProjectArchive(dst, await readProjectArchive(sink.blob()), "new");
    expect((await loadProjectPlugins(imported, dst.blobs)).issues.get("x-dionysus-stripes")?.state).toBe("missing");
  });

  it("never collects a locked package", async () => {
    const storage = createMemoryStorage();
    const pkg = await readPluginZip(await sampleZip());
    const p = await addPluginToProject(createProject("p"), pkg, storage.blobs);
    await storage.projects.save(p);
    await storage.blobs.put("orphan", new Blob(["x"]));
    let t = 0;
    await collectUnusedBlobs(storage, { now: () => t, locks: null });
    t = 2 * 24 * 3600_000;
    expect(await collectUnusedBlobs(storage, { now: () => t, locks: null })).toBe(1);
    expect(await storage.blobs.keys()).toContain(pluginBlobKey(pkg.hash));
  });
});

describe("device plugin library and trust (P84)", () => {
  async function exercise(lib: ReturnType<typeof createMemoryPluginLibrary>) {
    const pkg: PluginPackage = await readPluginZip(await sampleZip());
    const e = await lib.add(pkg, "file:stripes.zip", "2026-11-19T00:00:00.000Z");
    expect(e).toEqual({ hash: pkg.hash, id: "x-dionysus-stripes", version: "1.0.0", name: "Moving stripes", publisher: "Dionysus samples", size: pkg.size, source: "file:stripes.zip", installedAt: "2026-11-19T00:00:00.000Z" });
    expect(await lib.add(pkg, "https://other")).toEqual(e);
    const changed = await readPluginZip(await zipOf([["manifest.json", sampleManifest], ["render.js", "dionysus.clip({render(){}})"]]));
    await expect(lib.add(changed, "file:x")).rejects.toThrow(/already installed with different contents/);
    const v2 = await readPluginZip(await zipOf([["manifest.json", manifestWith({ version: "1.1.0" })], ["render.js", sampleRender]]));
    await lib.add(v2, "file:v2");
    expect((await lib.list()).map((x) => x.version)).toEqual(["1.0.0", "1.1.0"]);
    expect((await readPluginZip((await lib.blob(pkg.hash))!)).hash).toBe(pkg.hash);
    expect(await lib.isTrusted("proj-1", pkg.hash)).toBe(false);
    await lib.setTrusted("proj-1", pkg.hash, true);
    expect([await lib.isTrusted("proj-1", pkg.hash), await lib.isTrusted("proj-2", pkg.hash), await lib.isTrusted("proj-1", v2.hash)]).toEqual([true, false, false]);
    await lib.setTrusted("proj-1", pkg.hash, false);
    expect(await lib.isTrusted("proj-1", pkg.hash)).toBe(false);
    await lib.remove(pkg.hash);
    expect((await lib.list()).map((x) => x.version)).toEqual(["1.1.0"]);
    expect(await lib.blob(pkg.hash)).toBeUndefined();
  }
  it("adds, lists, refuses conflicts, removes and keeps trust per project and hash (memory)", () => exercise(createMemoryPluginLibrary()));
  it("does the same in IndexedDB, and keeps it across connections", async () => {
    const name = `plug-lib-${Math.random()}`;
    await exercise(createIndexedDbPluginLibrary(name));
    expect((await createIndexedDbPluginLibrary(name).list()).map((x) => x.version)).toEqual(["1.1.0"]);
  });
});
