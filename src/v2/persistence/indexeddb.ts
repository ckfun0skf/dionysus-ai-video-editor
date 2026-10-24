/** IndexedDB storage for v2 (separate database from the legacy app). */
import type { Storage } from "../ports/storage";
import type { Project } from "../domain/model";
import { migrateProject } from "./schema";

const DB_NAME = "dionysus-v2";
const LAST_KEY = "dionysus.v2.lastProjectId";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export const RELOAD_NEEDED = "Reload needed: another tab updated the editor";
/** v2 adds the "chunks" store (V2-108: chunked media, iOS Safari can't store File/Blob in IndexedDB). */
export const DB_VERSION = 2;
/** Media is written as ArrayBuffer chunks of this size, read via file.slice() so no huge buffer is ever held. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
export const STORAGE_FULL = "Not enough storage space on this device";

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error?.name === "VersionError" ? new Error(RELOAD_NEEDED) : r.error);
    // Another tab holds an older connection open and won't let go.
    r.onblocked = () => reject(new Error(RELOAD_NEEDED));
  });
}

/** True for the errors a closed / closing connection throws (Chrome: "The database connection is closing"). */
export function isClosedError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | undefined;
  return !!err && (err.name === "InvalidStateError" || /connection is closing|database.*closed/i.test(err.message ?? ""));
}

/**
 * V2-102: one shared connection, reopened lazily whenever the browser closes it (versionchange from a newer
 * tab, Android reclaiming it, …). Normal operation never calls close() on it except on versionchange.
 */
export function createDbHandle(name = DB_NAME) {
  let dbp: Promise<IDBDatabase> | undefined;
  let stale = true;
  const getDb = (): Promise<IDBDatabase> => {
    if (!dbp || stale) {
      stale = false;
      dbp = open(name).then((db) => {
        db.onversionchange = () => { stale = true; db.close(); };
        db.onclose = () => { stale = true; };
        return db;
      }, (e) => { stale = true; throw e; });
    }
    return dbp;
  };
  /** Run `fn` against a fresh store; on a closed-connection error, reopen and retry once. */
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const db = await getDb();
        return await req(fn(db.transaction(store, mode).objectStore(store)));
      } catch (e) {
        if (attempt > 0 || !isClosedError(e)) throw e;
        stale = true;
      }
    }
  };
  return { getDb, run, markStale: () => { stale = true; } };
}

/** What the "blobs" store holds for chunked media; the bytes live in "chunks" under `${key}:${index}`. */
interface ChunkManifest { v2chunks: 1; type: string; size: number; count: number }
const isManifest = (x: unknown): x is ChunkManifest => !!x && typeof x === "object" && (x as ChunkManifest).v2chunks === 1;
const chunkKey = (key: string, i: number) => `${key}:${i}`;
const chunkRange = (key: string) => IDBKeyRange.bound(`${key}:`, `${key}:\uffff`);

function readBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
}

/** A Blob as a stream of chunks (records stored before V2-108 hold the Blob itself). */
async function* blobParts(b: Blob, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < b.size; i += size) yield new Uint8Array(await readBytes(b.slice(i, Math.min(b.size, i + size))));
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | undefined;
  return !!err && (err.name === "QuotaExceededError" || /quota|disk.*full|not enough space/i.test(err.message ?? ""));
}
const mb = (n: number) => `${Math.max(1, Math.round(n / 1048576))} MB`;

let persistAsked = false;
/** Ask once for persistent storage so iOS/Safari doesn't evict imported media. Best effort, never throws. */
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { void (globalThis.navigator as Navigator | undefined)?.storage?.persist?.().catch(() => undefined); } catch { /* unsupported */ }
}

export function createIndexedDbStorage(name = DB_NAME, { chunkBytes = CHUNK_BYTES }: { chunkBytes?: number } = {}): Storage {
  const h = createDbHandle(name);
  const tx = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => h.run(store, mode, fn);
  const deleteChunks = (k: string) => tx("chunks", "readwrite", (s) => s.delete(chunkRange(k)));
  return {
    projects: {
      list: async () => ((await tx("projects", "readonly", (s) => s.getAll())) as Project[]).map((p) => ({ id: p.id, name: p.name, updatedAt: p.meta.updatedAt })),
      load: async (id) => {
        const raw = await tx("projects", "readonly", (s) => s.get(id));
        return raw === undefined ? undefined : migrateProject(raw);
      },
      loadRaw: async (id) => tx("projects", "readonly", (s) => s.get(id)),
      save: async (p) => void (await tx("projects", "readwrite", (s) => s.put(p))),
      delete: async (id) => void (await tx("projects", "readwrite", (s) => s.delete(id))),
    },
    blobs: {
      /**
       * V2-108: never hand a File/Blob to IndexedDB (WebKit: "Error preparing Blob/File data to be stored in object
       * store", esp. Photos-picker files). Bytes go in as ArrayBuffer chunks read one slice at a time; the manifest is
       * written last, so a failed import leaves nothing visible (partial chunks are removed).
       */
      put: async (k, b) => {
        askPersist();
        const count = Math.max(1, Math.ceil(b.size / chunkBytes));
        try {
          await deleteChunks(k);
          for (let i = 0; i < count; i++) {
            const bytes = await readBytes(b.slice(i * chunkBytes, Math.min(b.size, (i + 1) * chunkBytes)));
            await tx("chunks", "readwrite", (s) => s.put(bytes, chunkKey(k, i)));
          }
          const m: ChunkManifest = { v2chunks: 1, type: b.type, size: b.size, count };
          await tx("blobs", "readwrite", (s) => s.put(m, k));
        } catch (e) {
          await deleteChunks(k).catch(() => undefined);
          if (isQuotaError(e)) throw new Error(`${STORAGE_FULL} to keep this file (${mb(b.size)}). Free up space or remove unused media, then try again.`);
          throw e;
        }
      },
      get: async (k) => {
        const v = await tx("blobs", "readonly", (s) => s.get(k));
        if (!isManifest(v)) return v as Blob | undefined; // pre-V2-108 records stored the Blob itself
        const parts: ArrayBuffer[] = [];
        for (let i = 0; i < v.count; i++) {
          const part = await tx("chunks", "readonly", (s) => s.get(chunkKey(k, i)));
          if (!(part instanceof ArrayBuffer)) throw new Error("Stored media is incomplete; re-import the file");
          parts.push(part);
        }
        return new Blob(parts, { type: v.type });
      },
      delete: async (k) => { await deleteChunks(k); await tx("blobs", "readwrite", (s) => s.delete(k)); },
      chunks: async (k) => {
        const v = await tx("blobs", "readonly", (s) => s.get(k));
        if (v === undefined) return undefined;
        if (!isManifest(v)) { const b = v as Blob; return Object.assign(blobParts(b, chunkBytes), { size: b.size, type: b.type }); }
        return Object.assign((async function* () {
          for (let i = 0; i < v.count; i++) {
            const part = await tx("chunks", "readonly", (s) => s.get(chunkKey(k, i)));
            if (!(part instanceof ArrayBuffer)) throw new Error("Stored media is incomplete; re-import the file");
            yield new Uint8Array(part);
          }
        })(), { size: v.size, type: v.type });
      },
      keys: async () => ((await tx("blobs", "readonly", (s) => s.getAllKeys())) as IDBValidKey[]).map(String),
    },
    lastProjectId: { get: () => localStorage.getItem(LAST_KEY), set: (id) => localStorage.setItem(LAST_KEY, id) },
  };
}
