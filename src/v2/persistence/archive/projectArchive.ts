/**
 * Project archive (V2-CUT-PROJ): one `<name>.dionysus.zip` holding a project and every media version it references,
 * so a project can move between browsers and devices or be kept as a backup.
 *
 * Layout (all entries STORE):
 *   manifest.json   format id + version, app version, project schema, media index (key → path, size, mime, sha256)
 *   project.json    the project document exactly as stored (schema dionysus/3.x)
 *   media/<sha256>.<ext>   one file per distinct blob (versions and thumbnails share a file when identical)
 *
 * Export reads every blob twice in chunks (hash, then write), so memory stays at one chunk even for long videos.
 * Import verifies the SHA-256 of every media entry before the project is saved, and stores media under fresh keys so
 * an imported copy never shares (or overwrites) blobs with a project already in this browser.
 */
import { SCHEMA, newId, type Project } from "../../domain/model";
import type { BlobStore, Storage } from "../../ports/storage";
import { SchemaError, migrateProject } from "../schema";
import { Sha256, crc32 } from "./sha256";
import { ZipError, ZipWriter, blobChunks, readBlobBytes, readZipIndex, zipEntryBlob, type ZipEntry, type ZipSink } from "./zip";

export const ARCHIVE_FORMAT = "dionysus.project";
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_SUFFIX = ".dionysus.zip";
/** Replaced at build time from package.json (vite.config `define`). */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

export interface ArchiveMedia { key: string; path: string; size: number; mime: string; sha256: string }

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  app: { name: "Dionysus"; version: string };
  schema: string;
  createdAt: string;
  project: { id: string; name: string };
  media: ArchiveMedia[];
  /** Keys the project referenced but this browser no longer had when the archive was made. */
  missing: string[];
}

export interface ArchiveProgress { done: number; total: number }

/** A problem the user should read as-is (bad file, newer version, damaged media). */
export class ArchiveError extends Error {}

const enc = new TextEncoder();

function abortIf(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

function extOf(mime: string) {
  const sub = (mime.split("/")[1] ?? "").split(";")[0].replace(/[^a-z0-9]/gi, "").toLowerCase();
  return ({ quicktime: "mov", jpeg: "jpg", mpeg: "mp3", xwav: "wav", svgxml: "svg" } as Record<string, string>)[sub] ?? (sub.slice(0, 8) || "bin");
}

/** Every stored blob the project references (all versions, plus thumbnails), with its mime type. */
export function projectMediaKeys(p: Project): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of Object.values(p.assets)) for (const v of a.versions) {
    out.set(v.media.blobKey, v.media.mime || "application/octet-stream");
    if (v.media.thumbKey && !out.has(v.media.thumbKey)) out.set(v.media.thumbKey, "image/jpeg");
  }
  return out;
}

interface Source { size: number; type: string; chunks: () => AsyncIterable<Uint8Array> }

async function openSource(blobs: BlobStore, key: string): Promise<Source | undefined> {
  if (blobs.chunks) {
    const first = await blobs.chunks(key);
    if (!first) return undefined;
    let used = false;
    const again = async function* () { const c = await blobs.chunks!(key); if (c) yield* c; };
    return { size: first.size, type: first.type, chunks: () => { if (used) return again(); used = true; return first; } };
  }
  const b = await blobs.get(key);
  return b ? { size: b.size, type: b.type, chunks: () => blobChunks(b) } : undefined;
}

export interface ExportResult { manifest: ArchiveManifest; bytes: number }

/**
 * Write `project` and its media to `sink` as a project archive. Progress counts media bytes read (both passes).
 * Blobs the browser no longer has are listed in `manifest.missing` instead of failing the export.
 */
export async function exportProjectArchive(project: Project, blobs: BlobStore, sink: ZipSink, opts: { onProgress?: (p: ArchiveProgress) => void; signal?: AbortSignal; now?: Date } = {}): Promise<ExportResult> {
  const keys = projectMediaKeys(project);
  const media: ArchiveMedia[] = [];
  const missing: string[] = [];
  const sources = new Map<string, { chunks: () => AsyncIterable<Uint8Array>; size: number; crc: number }>();
  // Open every referenced blob; ones this browser no longer has are recorded as missing.
  const opened: { key: string; mime: string; src: Source }[] = [];
  for (const [key, mime] of keys) {
    abortIf(opts.signal);
    const src = await openSource(blobs, key);
    if (src) opened.push({ key, mime: mime || src.type, src }); else missing.push(key);
  }
  // Progress counts every byte twice (hash, then write); duplicate content is written once, so the total shrinks a little.
  let total = 2 * opened.reduce((a, o) => a + o.src.size, 0), done = 0;
  const tick = (n: number) => { done += n; opts.onProgress?.({ done, total: Math.max(total, done) }); };
  // Pass 1: hash.
  for (const o of opened) {
    const sha = new Sha256();
    let crc = 0, size = 0;
    for await (const c of o.src.chunks()) {
      abortIf(opts.signal);
      sha.update(c); crc = crc32(crc, c); size += c.length;
      tick(c.length);
    }
    const sha256 = sha.hex();
    const path = `media/${sha256}.${extOf(o.mime)}`;
    media.push({ key: o.key, path, size, mime: o.mime, sha256 });
    if (!sources.has(path)) { sources.set(path, { chunks: o.src.chunks, size, crc }); }
    else total -= size;
  }
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT, formatVersion: ARCHIVE_VERSION, app: { name: "Dionysus", version: APP_VERSION }, schema: project.schema,
    createdAt: (opts.now ?? new Date()).toISOString(), project: { id: project.id, name: project.name }, media, missing,
  };
  const zip = new ZipWriter(sink, opts.now);
  await zip.addBytes("manifest.json", enc.encode(JSON.stringify(manifest, null, 2)));
  await zip.addBytes("project.json", enc.encode(JSON.stringify(project)));
  // Pass 2: stream each distinct blob into its entry.
  for (const [path, s] of sources) {
    abortIf(opts.signal);
    await zip.add(path, s, s.chunks(), (n) => { abortIf(opts.signal); tick(n); });
  }
  await zip.finish();
  opts.onProgress?.({ done: total, total });
  return { manifest, bytes: zip.length };
}

// ---------------------------------------------------------------- import

export interface ArchivePreview {
  file: Blob;
  manifest: ArchiveManifest;
  project: Project;
  index: Map<string, ZipEntry>;
  /** Total media bytes to verify and store. */
  mediaBytes: number;
}

const schemaNum = (s: string) => { const m = /^dionysus\/(\d+)\.(\d+)$/.exec(s); return m ? Number(m[1]) * 1000 + Number(m[2]) : NaN; };
const NEWER = "This project file was made by a newer version of Dionysus. Reload the page to update the app, then import it again.";

async function readJson(file: Blob, index: Map<string, ZipEntry>, name: string): Promise<unknown> {
  const e = index.get(name);
  if (!e) throw new ArchiveError(name === "manifest.json" ? "This zip is not a Dionysus project file (manifest.json is missing)." : `The project file is incomplete (${name} is missing).`);
  try { return JSON.parse(new TextDecoder().decode(await readBlobBytes(await zipEntryBlob(file, e)))); }
  catch (err) { if (err instanceof ZipError) throw new ArchiveError(err.message); throw new ArchiveError(`The project file is damaged (${name} can't be read).`); }
}

/** Open and validate an archive without storing anything: format, version, project schema and media listing. */
export async function readProjectArchive(file: Blob): Promise<ArchivePreview> {
  let index: Map<string, ZipEntry>;
  try { index = await readZipIndex(file); } catch (e) { throw new ArchiveError(e instanceof Error ? e.message : String(e)); }
  const m = await readJson(file, index, "manifest.json") as Partial<ArchiveManifest> | null;
  if (!m || typeof m !== "object" || m.format !== ARCHIVE_FORMAT) throw new ArchiveError("This zip is not a Dionysus project file.");
  if (typeof m.formatVersion !== "number" || m.formatVersion < 1) throw new ArchiveError("The project file's manifest is damaged.");
  if (m.formatVersion > ARCHIVE_VERSION) throw new ArchiveError(`${NEWER} (file format ${m.formatVersion}, this app reads up to ${ARCHIVE_VERSION}${m.app?.version ? `; made by Dionysus ${m.app.version}` : ""})`);
  if (!Array.isArray(m.media) || m.media.some((x) => !x || typeof x.key !== "string" || typeof x.path !== "string" || typeof x.sha256 !== "string" || typeof x.size !== "number")) throw new ArchiveError("The project file's manifest is damaged.");
  const raw = await readJson(file, index, "project.json") as { schema?: unknown };
  let project: Project;
  try { project = migrateProject(raw); }
  catch (err) {
    if (err instanceof SchemaError && typeof raw?.schema === "string" && schemaNum(raw.schema) > schemaNum(SCHEMA)) throw new ArchiveError(`${NEWER} (project ${raw.schema}, this app reads ${SCHEMA})`);
    throw new ArchiveError(`The project in this file can't be opened: ${err instanceof Error ? err.message : String(err)}`);
  }
  const listed = new Set([...m.media.map((x) => x.key), ...(Array.isArray(m.missing) ? m.missing : [])]);
  const unlisted = [...projectMediaKeys(project).keys()].filter((k) => !listed.has(k));
  if (unlisted.length) throw new ArchiveError(`The project file is damaged: ${unlisted.length} media file(s) are not listed in its manifest.`);
  const absent = [...new Set(m.media.map((x) => x.path))].filter((p) => !index.has(p));
  if (absent.length) throw new ArchiveError(`The project file is incomplete: ${absent.length} media file(s) are missing (${absent[0]}${absent.length > 1 ? ", …" : ""}).`);
  const mediaBytes = [...new Map(m.media.map((x) => [x.path, x.size])).values()].reduce((a, b) => a + b, 0);
  return { file, manifest: { missing: [], ...m } as ArchiveManifest, project, index, mediaBytes };
}

export type ImportMode = "new" | "copy" | "replace";

/**
 * Verify and store the archive's media under fresh keys, then save the project: with its own id ("new" / "replace")
 * or a new id and a " (copy)" name ("copy"). Nothing is saved unless every media file verifies; blobs already
 * written are removed on failure or cancel. Returns the saved project.
 */
export async function importProjectArchive(storage: Storage, a: ArchivePreview, mode: ImportMode, opts: { onProgress?: (p: ArchiveProgress) => void; signal?: AbortSignal; now?: string } = {}): Promise<Project> {
  const tag = newId("imp");
  const byPath = new Map<string, ArchiveMedia>();
  for (const x of a.manifest.media) if (!byPath.has(x.path)) byPath.set(x.path, x);
  const newKeyOf = (path: string) => `${tag}/${path.replace(/^media\//, "")}`;
  const written: string[] = [];
  const total = a.mediaBytes * 2;
  let done = 0;
  const tick = (n: number) => { done += n; opts.onProgress?.({ done, total }); };
  try {
    for (const [path, x] of byPath) {
      abortIf(opts.signal);
      let data: Blob;
      try { data = await zipEntryBlob(a.file, a.index.get(path)!); } catch (e) { throw new ArchiveError(e instanceof Error ? e.message : String(e)); }
      if (data.size !== x.size) throw new ArchiveError(`The project file is damaged: ${path} has the wrong size.`);
      const sha = new Sha256();
      for await (const c of blobChunks(data)) { abortIf(opts.signal); sha.update(c); tick(c.length); }
      if (sha.hex() !== x.sha256) throw new ArchiveError(`The project file is damaged: ${path} doesn't match its checksum.`);
      const key = newKeyOf(path);
      written.push(key);
      await storage.blobs.put(key, new Blob([data], { type: x.mime }));
      tick(x.size);
    }
    abortIf(opts.signal);
    const keyMap = new Map(a.manifest.media.map((x) => [x.key, newKeyOf(x.path)]));
    const p = structuredClone(a.project);
    for (const asset of Object.values(p.assets)) for (const v of asset.versions) {
      // Media missing at export keeps a key that can't collide with anything stored here.
      v.media.blobKey = keyMap.get(v.media.blobKey) ?? `${tag}/missing/${v.media.blobKey}`;
      if (v.media.thumbKey) { const t = keyMap.get(v.media.thumbKey); if (t) v.media.thumbKey = t; else delete v.media.thumbKey; }
    }
    const now = opts.now ?? new Date().toISOString();
    if (mode === "copy") { p.id = newId("proj"); p.name = `${p.name} (copy)`; p.meta = { ...p.meta, createdAt: now }; }
    p.meta = { ...p.meta, updatedAt: now };
    await storage.projects.save(p);
    opts.onProgress?.({ done: total, total });
    return p;
  } catch (e) {
    await Promise.all(written.map((k) => storage.blobs.delete(k).catch(() => undefined)));
    throw e;
  }
}

// ---------------------------------------------------------------- sinks

/** Collects the archive in memory as Blob parts (browsers without OPFS; the Blob is still built from parts, not one buffer). */
export class BlobSink implements ZipSink {
  private parts: BlobPart[] = [];
  async write(d: Uint8Array) { this.parts.push(d); }
  blob() { return new Blob(this.parts, { type: "application/zip" }); }
}

interface Writable { write(d: Uint8Array): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }

/** Streams into a File System Access writable (save picker or OPFS file). Small writes are batched to 1 MB. */
export class WritableSink implements ZipSink {
  private buf: Uint8Array[] = [];
  private n = 0;
  constructor(private w: Writable) {}
  async write(d: Uint8Array) {
    if (d.length >= 1 << 20) { await this.flush(); await this.w.write(d); return; }
    this.buf.push(d.slice()); this.n += d.length;
    if (this.n >= 1 << 20) await this.flush();
  }
  private async flush() {
    if (!this.n) return;
    const all = new Uint8Array(this.n);
    let o = 0;
    for (const b of this.buf) { all.set(b, o); o += b.length; }
    this.buf = []; this.n = 0;
    await this.w.write(all);
  }
  async close() { await this.flush(); await this.w.close(); }
  async abort() { this.buf = []; this.n = 0; try { await (this.w.abort ? this.w.abort() : this.w.close()); } catch { /* already closed */ } }
}
