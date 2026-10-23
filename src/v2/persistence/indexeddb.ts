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
const DB_VERSION = 1;

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
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

export function createIndexedDbStorage(name = DB_NAME): Storage {
  const h = createDbHandle(name);
  const tx = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => h.run(store, mode, fn);
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
      put: async (k, b) => void (await tx("blobs", "readwrite", (s) => s.put(b, k))),
      get: async (k) => (await tx("blobs", "readonly", (s) => s.get(k))) as Blob | undefined,
      delete: async (k) => void (await tx("blobs", "readwrite", (s) => s.delete(k))),
      keys: async () => ((await tx("blobs", "readonly", (s) => s.getAllKeys())) as IDBValidKey[]).map(String),
    },
    lastProjectId: { get: () => localStorage.getItem(LAST_KEY), set: (id) => localStorage.setItem(LAST_KEY, id) },
  };
}
