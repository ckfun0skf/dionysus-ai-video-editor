/**
 * P84 (Phase 3 step 3.2, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3, docs/v2/PLUGIN_PACKAGE.md): third-party clip
 * type plugin packages on the persistence side.
 *
 * - Read a package from a zip (`*.dionysus-cliptype.zip`) or from an https URL to its manifest.json, with the size caps,
 *   and validate it (domain/pluginManifest.ts).
 * - The content hash (`sha256-<hex>` over manifest.json, then every listed file in path order: UTF-8 path, NUL, byte
 *   length in decimal, NUL, bytes).
 * - Store a package in a project: one canonical zip blob (`plugin/<hex>`) in the project's blob store and a lock in
 *   `Project.plugins` (an optional field within `dionysus/3.1`). Project archives and the blob GC follow the lock.
 * - Load the open project's plugins: verify each locked package, build its core (data only, no plugin code runs) and
 *   register it at runtime (`CLIP_TYPES.setRuntime`); locked plugins that can't be used are reported
 *   (`setPluginIssues`) and their clips keep the unknown-type slate.
 * - The device library (IndexedDB `dionysus-plugins`): packages by hash for reuse across projects, and trust per
 *   project, per hash (decision 12). The UI for both comes in P86.
 */
import { PLUGIN_API, PLUGIN_LIMITS, comparePluginVersions, PLUGIN_MANIFEST_FILE, checkPluginFiles, parsePluginManifest, pluginLocks, setPluginLock, type PluginIssue, type PluginLock, type PluginManifest, type Project } from "../domain";
import { CLIP_TYPES, pluginCoreOf, setPluginIssues, setPluginsEnabled, type ClipTypeCore, type PluginIssueState } from "../clipTypes";
import type { BlobStore } from "../ports/storage";
import { Sha256 } from "./archive/sha256";
import { readBlobBytes, readZipIndex, zipEntryBlob, ZipWriter, type ZipEntry } from "./archive/zip";

export const PLUGIN_BLOB_PREFIX = "plugin/";
const enc = new TextEncoder();

export class PluginPackageError extends Error {
  constructor(message: string, readonly issues: PluginIssue[] = []) { super(message); }
}

/** A package read into memory and checked: the validated manifest, its exact bytes, the listed files and the hash. */
export interface PluginPackage {
  manifest: PluginManifest;
  manifestBytes: Uint8Array;
  files: Map<string, Uint8Array>;
  hash: string;
  /** Total bytes (manifest + files). */
  size: number;
  /** Warnings from validation (shown at install). */
  warnings: PluginIssue[];
}

export interface PluginReadOptions {
  /** Library ids the host allows (render/htmlLibs.ts `CLIP_LIBRARIES`); omitted = not checked. */
  libs?: readonly string[];
}

/** The content hash of a package (docs/v2/PLUGIN_PACKAGE.md §1). */
export function pluginContentHash(manifestBytes: Uint8Array, files: ReadonlyMap<string, Uint8Array>): string {
  const sha = new Sha256();
  const part = (path: string, bytes: Uint8Array) => {
    sha.update(enc.encode(path)); sha.update(new Uint8Array([0])); sha.update(enc.encode(String(bytes.length))); sha.update(new Uint8Array([0])); sha.update(bytes);
  };
  part(PLUGIN_MANIFEST_FILE, manifestBytes);
  for (const path of [...files.keys()].sort()) part(path, files.get(path)!);
  return `sha256-${sha.hex()}`;
}

/** Hex part of a hash, for blob keys and file names. */
const hexOf = (hash: string) => hash.replace(/^sha256-/, "");
/** The project blob key of a package. */
export const pluginBlobKey = (hash: string) => `${PLUGIN_BLOB_PREFIX}${hexOf(hash)}`;

const tooBig = (what: string, bytes: number, max: number) =>
  new PluginPackageError(`${what} is ${(bytes / 1048576).toFixed(1)} MB; the most is ${Math.round(max / 1048576)} MB.`);

/** Build a checked package from a manifest's bytes and a way to get each listed file. */
export async function pluginPackageFrom(manifestBytes: Uint8Array, present: readonly string[], read: (path: string) => Promise<Uint8Array>, opts: PluginReadOptions = {}): Promise<PluginPackage> {
  if (manifestBytes.length > PLUGIN_LIMITS.fileBytes) throw tooBig("manifest.json", manifestBytes.length, PLUGIN_LIMITS.fileBytes);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes); } catch { throw new PluginPackageError("manifest.json is not UTF-8 text."); }
  const { manifest, issues } = parsePluginManifest(text, opts);
  if (!manifest) {
    const errs = issues.filter((i) => i.level === "error");
    const newer = errs.find((i) => i.path === "api" && /needs a newer Dionysus/.test(i.message));
    throw new PluginPackageError(newer ? newer.message : `The plugin's manifest has ${errs.length} problem${errs.length === 1 ? "" : "s"}: ${errs.slice(0, 3).map((i) => `${i.path || "manifest"}: ${i.message}`).join(" ")}`, issues);
  }
  const fileIssues = checkPluginFiles(manifest, present);
  const missing = fileIssues.filter((i) => i.level === "error");
  if (missing.length) throw new PluginPackageError(`The package is incomplete: ${missing.map((i) => i.message).join(" ")}`, [...issues, ...fileIssues]);
  const files = new Map<string, Uint8Array>();
  let size = manifestBytes.length;
  for (const f of manifest.files) {
    const bytes = await read(f);
    if (bytes.length > PLUGIN_LIMITS.fileBytes) throw tooBig(`"${f}"`, bytes.length, PLUGIN_LIMITS.fileBytes);
    size += bytes.length;
    if (size > PLUGIN_LIMITS.packageBytes) throw tooBig("The package", size, PLUGIN_LIMITS.packageBytes);
    files.set(f, bytes);
  }
  return { manifest, manifestBytes, files, hash: pluginContentHash(manifestBytes, files), size, warnings: [...issues, ...fileIssues] };
}

const IGNORED = (name: string) => name.endsWith("/") || /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(name);

/**
 * Read a package zip. manifest.json is at the root, or inside one top-level folder (a zipped folder). Declared sizes
 * are checked against the caps before anything is unpacked.
 */
export async function readPluginZip(file: Blob, opts: PluginReadOptions = {}): Promise<PluginPackage> {
  if (file.size > PLUGIN_LIMITS.packageBytes) throw tooBig("The package", file.size, PLUGIN_LIMITS.packageBytes);
  let index: Map<string, ZipEntry>;
  try { index = await readZipIndex(file); } catch (e) { throw new PluginPackageError(e instanceof Error ? e.message : String(e)); }
  const names = [...index.keys()].filter((n) => !IGNORED(n));
  let root = "";
  if (!index.has(PLUGIN_MANIFEST_FILE)) {
    const tops = new Set(names.map((n) => n.split("/")[0]));
    const only = tops.size === 1 ? [...tops][0] : undefined;
    if (only && index.has(`${only}/${PLUGIN_MANIFEST_FILE}`)) root = `${only}/`;
    else throw new PluginPackageError("This zip is not a Dionysus plugin (manifest.json is missing).");
  }
  const inside = names.filter((n) => n.startsWith(root)).map((n) => n.slice(root.length));
  if (inside.length > PLUGIN_LIMITS.files + 1) throw new PluginPackageError(`A package may have at most ${PLUGIN_LIMITS.files} files; this zip has ${inside.length - 1}.`);
  let declared = 0;
  for (const n of inside) {
    const e = index.get(root + n)!;
    if (e.size > PLUGIN_LIMITS.fileBytes) throw tooBig(`"${n}"`, e.size, PLUGIN_LIMITS.fileBytes);
    declared += e.size;
  }
  if (declared > PLUGIN_LIMITS.packageBytes) throw tooBig("The package", declared, PLUGIN_LIMITS.packageBytes);
  const read = async (path: string): Promise<Uint8Array> => {
    const e = index.get(root + path);
    if (!e) throw new PluginPackageError(`"${path}" is not in the package.`);
    let bytes: Uint8Array;
    try { bytes = await readBlobBytes(await zipEntryBlob(file, e)); } catch (err) { throw new PluginPackageError(err instanceof Error ? err.message : String(err)); }
    if (bytes.length !== e.size) throw new PluginPackageError(`"${path}" is damaged in the zip.`);
    return bytes;
  };
  return pluginPackageFrom(await read(PLUGIN_MANIFEST_FILE), inside, read, opts);
}

/** May the editor fetch a plugin from this URL? https, or http on this device (localhost) for development. */
export function pluginUrlProblem(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return "That is not a web address."; }
  if (u.protocol === "https:") return undefined;
  if (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return undefined;
  return "Plugins can only be loaded from https:// addresses.";
}

/**
 * Fetch a package from a URL: a `.zip`, or a manifest.json whose listed files are fetched relative to it. Requests
 * carry no cookies or credentials; the server must allow CORS.
 */
export async function fetchPluginPackage(url: string, opts: PluginReadOptions & { fetch?: typeof fetch } = {}): Promise<PluginPackage> {
  const problem = pluginUrlProblem(url);
  if (problem) throw new PluginPackageError(problem);
  const get = async (u: string, max: number): Promise<Uint8Array> => {
    let r: Response;
    try { r = await (opts.fetch ?? fetch)(u, { credentials: "omit", redirect: "follow", cache: "no-cache" }); }
    catch { throw new PluginPackageError(`Couldn't download ${u}. The server may not allow downloads from other sites (CORS).`); }
    if (!r.ok) throw new PluginPackageError(`Couldn't download ${u} (HTTP ${r.status}).`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > max) throw tooBig(u, len, max);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > max) throw tooBig(u, bytes.length, max);
    return bytes;
  };
  if (/\.zip(?:[?#]|$)/i.test(url)) return readPluginZip(new Blob([await get(url, PLUGIN_LIMITS.packageBytes)]), opts);
  const manifestBytes = await get(url, PLUGIN_LIMITS.fileBytes);
  let listed: string[] = [];
  try { const m = JSON.parse(new TextDecoder().decode(manifestBytes)); if (Array.isArray(m?.files)) listed = m.files.filter((f: unknown) => typeof f === "string"); } catch { /* reported by validation */ }
  return pluginPackageFrom(manifestBytes, listed, (path) => get(new URL(path, url).href, PLUGIN_LIMITS.fileBytes), opts);
}

/** The canonical stored form of a package: a zip with manifest.json first, then the listed files in path order. */
export async function pluginZipBlob(pkg: Pick<PluginPackage, "manifestBytes" | "files">): Promise<Blob> {
  const parts: BlobPart[] = [];
  const zip = new ZipWriter({ write: async (d) => { parts.push(d); } }, new Date(Date.UTC(2026, 0, 1)));
  await zip.addBytes(PLUGIN_MANIFEST_FILE, pkg.manifestBytes);
  for (const path of [...pkg.files.keys()].sort()) await zip.addBytes(path, pkg.files.get(path)!);
  await zip.finish();
  return new Blob(parts, { type: "application/zip" });
}

export class PluginConflictError extends Error {}

/**
 * Store a package in the project: its zip blob in `blobs` and a lock in `Project.plugins`. Returns the new project
 * (the caller saves it or dispatches it as one undo step). The same id and version with another hash is a conflict.
 */
export async function addPluginToProject(project: Project, pkg: PluginPackage, blobs: BlobStore): Promise<Project> {
  const id = pkg.manifest.id;
  const old = project.plugins?.[id];
  if (old && old.version === pkg.manifest.version && old.hash !== pkg.hash) {
    throw new PluginConflictError(`This project already uses “${old.name}” ${old.version} with different contents. A changed plugin needs a new version number.`);
  }
  return setPluginLock(project, id, await storePluginPackage(pkg, blobs));
}

/** P86: the lock that pins a package in a project. */
export const pluginLockOf = (pkg: Pick<PluginPackage, "manifest" | "hash">): PluginLock =>
  ({ version: pkg.manifest.version, hash: pkg.hash, name: pkg.manifest.name, blobKey: pluginBlobKey(pkg.hash), ...(pkg.manifest.publisher ? { publisher: pkg.manifest.publisher } : {}) });

/** P86: store a package's blob in the project's store (if not there yet) and return its lock; the caller dispatches the lock. */
export async function storePluginPackage(pkg: PluginPackage, blobs: BlobStore): Promise<PluginLock> {
  const lock = pluginLockOf(pkg);
  if (!(await blobs.get(lock.blobKey))) await blobs.put(lock.blobKey, await pluginZipBlob(pkg));
  return lock;
}

/**
 * P86: why a package can't be added to this project as is, if it can't: the same id is already locked at the same
 * version with other contents (a conflict). Another version is a switch (P87: update or downgrade, see `pluginSwitchOf`).
 */
export function pluginProjectProblem(project: Pick<Project, "plugins">, pkg: Pick<PluginPackage, "manifest" | "hash">): string | undefined {
  const old = project.plugins?.[pkg.manifest.id];
  if (!old || old.hash === pkg.hash) return undefined;
  if (old.version === pkg.manifest.version) return `This project already uses “${old.name}” ${old.version} with different contents. A changed plugin needs a new version number.`;
  return undefined;
}

/** P87: whether adding `pkg` to the project switches the version it uses: "update" (newer) or "downgrade" (older). */
export function pluginSwitchOf(project: Pick<Project, "plugins">, pkg: Pick<PluginPackage, "manifest" | "hash">): { kind: "update" | "downgrade"; from: string } | undefined {
  const old = project.plugins?.[pkg.manifest.id];
  if (!old || old.hash === pkg.hash || old.version === pkg.manifest.version) return undefined;
  return { kind: comparePluginVersions(pkg.manifest.version, old.version) > 0 ? "update" : "downgrade", from: old.version };
}

// ---------------------------------------------------------------- loading the open project's plugins

export interface PluginLoadResult {
  /** Cores to register, one per usable locked plugin. */
  cores: ClipTypeCore[];
  /** Locked plugins that can't be used, and why. */
  issues: Map<string, { state: PluginIssueState; name?: string; message: string }>;
}

/** Cores built from verified packages, by hash: a re-sync reuses the same objects, so the registry doesn't change. */
const coreCache = new Map<string, ClipTypeCore>();

/**
 * Read and verify every package the project locks. A package must be in the project's blob store (or, as a fallback,
 * in the device library with the same hash), match the lock's hash and id, and validate. Nothing is registered here.
 */
export async function loadProjectPlugins(project: Pick<Project, "plugins">, blobs: BlobStore, opts: PluginReadOptions & { library?: Pick<PluginLibrary, "blob"> } = {}): Promise<PluginLoadResult> {
  const cores: ClipTypeCore[] = [];
  const issues: PluginLoadResult["issues"] = new Map();
  for (const [id, lock] of pluginLocks(project)) {
    if (CLIP_TYPES.core(id) && !CLIP_TYPES.core(id)!.plugin) { issues.set(id, { state: "conflict", name: lock.name, message: `“${id}” is a built-in clip type.` }); continue; }
    let blob: Blob | undefined;
    try { blob = (await blobs.get(lock.blobKey)) ?? (await opts.library?.blob(lock.hash)); } catch { blob = undefined; }
    if (!blob) { issues.set(id, { state: "missing", name: lock.name, message: `The package of “${lock.name}” ${lock.version} is not in this project or on this device.` }); continue; }
    try {
      const pkg = await readPluginZip(blob, opts);
      if (pkg.hash !== lock.hash) throw new PluginPackageError(`The stored package of “${lock.name}” doesn't match the project's lock (content hash).`);
      if (pkg.manifest.id !== id) throw new PluginPackageError(`The stored package is “${pkg.manifest.id}”, not “${id}”.`);
      const cached = coreCache.get(lock.hash);
      const core = cached && cached.id === id ? cached : pluginCoreOf(pkg.manifest, lock, pkg.files);
      coreCache.set(lock.hash, core);
      cores.push(core);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      issues.set(id, { state: /needs a newer Dionysus/.test(message) ? "newer" : "damaged", name: lock.name, message });
    }
  }
  return { cores, issues };
}

/**
 * Load the project's plugins and make them the registered runtime types (replacing the previous project's). P85:
 * `trusted(hash)` says which may run on this device (decision 12; without it none are enabled).
 */
export async function syncProjectPlugins(project: Pick<Project, "plugins">, blobs: BlobStore, opts: PluginReadOptions & { library?: Pick<PluginLibrary, "blob">; trusted?: (hash: string) => Promise<boolean> } = {}): Promise<PluginLoadResult> {
  const r = await loadProjectPlugins(project, blobs, opts);
  const on: [string, string][] = [];
  for (const c of r.cores) {
    const hash = c.plugin!.hash;
    if (opts.trusted && (await opts.trusted(hash).catch(() => false))) on.push([c.id, hash]);
  }
  const issuesChanged = setPluginIssues(r.issues);
  const enabledChanged = setPluginsEnabled(on);
  if (!CLIP_TYPES.setRuntime(r.cores) && (issuesChanged || enabledChanged)) CLIP_TYPES.notify();
  return r;
}

/** Host API this build implements (re-exported for the UI). */
export { PLUGIN_API };

// ---------------------------------------------------------------- device library and trust

export interface PluginLibraryEntry {
  hash: string;
  id: string;
  version: string;
  name: string;
  publisher?: string;
  size: number;
  /** "file:<name>" or the URL it came from. */
  source: string;
  installedAt: string;
}

export interface PluginLibrary {
  list(): Promise<PluginLibraryEntry[]>;
  /** The stored package zip of a hash. */
  blob(hash: string): Promise<Blob | undefined>;
  /** Add a package (same hash = the existing entry). The same id and version with another hash is a conflict. */
  add(pkg: PluginPackage, source: string, now?: string): Promise<PluginLibraryEntry>;
  remove(hash: string): Promise<void>;
  /** Decision 12: is package `hash` allowed to run in project `projectId` on this device? */
  isTrusted(projectId: string, hash: string): Promise<boolean>;
  setTrusted(projectId: string, hash: string, trusted: boolean): Promise<void>;
}

interface StoredEntry extends PluginLibraryEntry { bytes: Uint8Array }
const trustKey = (projectId: string, hash: string) => `${projectId}\n${hash}`;
const entryOf = ({ bytes: _b, ...e }: StoredEntry): PluginLibraryEntry => e;

/** Shared add logic over a tiny key-value backend. */
function makeLibrary(kv: {
  all(): Promise<StoredEntry[]>; get(hash: string): Promise<StoredEntry | undefined>; put(e: StoredEntry): Promise<void>; del(hash: string): Promise<void>;
  trusted(k: string): Promise<boolean>; setTrust(k: string, on: boolean): Promise<void>;
}): PluginLibrary {
  return {
    list: async () => (await kv.all()).map(entryOf).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
    blob: async (hash) => { const e = await kv.get(hash); return e ? new Blob([e.bytes], { type: "application/zip" }) : undefined; },
    async add(pkg, source, now = new Date().toISOString()) {
      const same = await kv.get(pkg.hash);
      if (same) return entryOf(same);
      const clash = (await kv.all()).find((e) => e.id === pkg.manifest.id && e.version === pkg.manifest.version);
      if (clash) throw new PluginConflictError(`“${clash.name}” ${clash.version} is already installed with different contents. A changed plugin needs a new version number.`);
      const e: StoredEntry = {
        hash: pkg.hash, id: pkg.manifest.id, version: pkg.manifest.version, name: pkg.manifest.name, size: pkg.size, source, installedAt: now,
        ...(pkg.manifest.publisher ? { publisher: pkg.manifest.publisher } : {}), bytes: await readBlobBytes(await pluginZipBlob(pkg)),
      };
      await kv.put(e);
      return entryOf(e);
    },
    remove: (hash) => kv.del(hash),
    isTrusted: (projectId, hash) => kv.trusted(trustKey(projectId, hash)),
    setTrusted: (projectId, hash, on) => kv.setTrust(trustKey(projectId, hash), on),
  };
}

/** In-memory library (tests, and browsers without IndexedDB). */
export function createMemoryPluginLibrary(): PluginLibrary {
  const entries = new Map<string, StoredEntry>();
  const trust = new Set<string>();
  return makeLibrary({
    all: async () => [...entries.values()], get: async (h) => entries.get(h), put: async (e) => { entries.set(e.hash, e); }, del: async (h) => { entries.delete(h); },
    trusted: async (k) => trust.has(k), setTrust: async (k, on) => { if (on) trust.add(k); else trust.delete(k); },
  });
}

export const PLUGIN_DB_NAME = "dionysus-plugins";

/** The device library in its own IndexedDB database (stores "packages" by hash and "trust" by project + hash). */
export function createIndexedDbPluginLibrary(name = PLUGIN_DB_NAME): PluginLibrary {
  let dbp: Promise<IDBDatabase> | undefined;
  const db = () => (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("packages", { keyPath: "hash" }); r.result.createObjectStore("trust"); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = undefined; }; res(d); };
    r.onerror = () => { dbp = undefined; rej(r.error); };
  }));
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const d = await db();
    return new Promise<T>((res, rej) => {
      const tx = d.transaction(store, mode);
      const rq = fn(tx.objectStore(store));
      let out: T;
      rq.onsuccess = () => { out = rq.result as T; };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error ?? rq.error);
      tx.onabort = () => rej(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  };
  return makeLibrary({
    all: () => run<StoredEntry[]>("packages", "readonly", (s) => s.getAll()),
    get: (h) => run<StoredEntry | undefined>("packages", "readonly", (s) => s.get(h)),
    put: (e) => run<void>("packages", "readwrite", (s) => s.put(e)),
    del: (h) => run<void>("packages", "readwrite", (s) => s.delete(h)),
    trusted: async (k) => (await run<unknown>("trust", "readonly", (s) => s.get(k))) === true,
    setTrust: (k, on) => run<void>("trust", "readwrite", (s) => (on ? s.put(true, k) : s.delete(k))),
  });
}
