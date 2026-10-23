/** IndexedDB storage for v2 (separate database from the legacy app). */
import type { Storage } from "../ports/storage";
import type { Project } from "../domain/model";
import { migrateProject } from "./schema";

const DB_NAME = "dionysus-v2";
const LAST_KEY = "dionysus.v2.lastProjectId";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export function createIndexedDbStorage(): Storage {
  const dbp = open();
  const tx = async (store: string, mode: IDBTransactionMode) => (await dbp).transaction(store, mode).objectStore(store);
  return {
    projects: {
      list: async () => ((await req((await tx("projects", "readonly")).getAll())) as Project[]).map((p) => ({ id: p.id, name: p.name, updatedAt: p.meta.updatedAt })),
      load: async (id) => {
        const raw = await req((await tx("projects", "readonly")).get(id));
        return raw === undefined ? undefined : migrateProject(raw);
      },
      loadRaw: async (id) => req((await tx("projects", "readonly")).get(id)),
      save: async (p) => void (await req((await tx("projects", "readwrite")).put(p))),
      delete: async (id) => void (await req((await tx("projects", "readwrite")).delete(id))),
    },
    blobs: {
      put: async (k, b) => void (await req((await tx("blobs", "readwrite")).put(b, k))),
      get: async (k) => (await req((await tx("blobs", "readonly")).get(k))) as Blob | undefined,
      delete: async (k) => void (await req((await tx("blobs", "readwrite")).delete(k))),
      keys: async () => ((await req((await tx("blobs", "readonly")).getAllKeys())) as IDBValidKey[]).map(String),
    },
    lastProjectId: { get: () => localStorage.getItem(LAST_KEY), set: (id) => localStorage.setItem(LAST_KEY, id) },
  };
}
