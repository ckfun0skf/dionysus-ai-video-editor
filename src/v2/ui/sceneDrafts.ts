/**
 * P80: unsaved scene editor drafts, kept on this device so closing the tab (or a crash) loses nothing. One draft per
 * project and clip; the record names the scene version the draft was made from, so the editor can tell the user when
 * the clip shows another version now (restoring then saves as a new version). Drafts live in their own IndexedDB
 * database (they are not project media, so cleaning up unused media never touches them); without IndexedDB (tests,
 * private modes that refuse it) they stay in memory for the page's life.
 */
import type { SceneDoc } from "../domain";

export interface SceneDraft {
  key: string;
  projectId: string;
  clipId: string;
  assetId: string;
  /** The version the draft was made from, and its blob (a "replace" keeps the id but changes the blob). */
  baseVersionId: string;
  baseBlobKey: string;
  doc: SceneDoc;
  /** ISO time of the last autosave. */
  savedAt: string;
}

export interface SceneDraftStore {
  get(key: string): Promise<SceneDraft | undefined>;
  put(draft: SceneDraft): Promise<void>;
  delete(key: string): Promise<void>;
}

export const sceneDraftKey = (projectId: string, clipId: string) => `${projectId}/${clipId}`;

export function memorySceneDrafts(): SceneDraftStore & { map: Map<string, SceneDraft> } {
  const map = new Map<string, SceneDraft>();
  return { map, async get(k) { return map.get(k); }, async put(d) { map.set(d.key, structuredClone(d)); }, async delete(k) { map.delete(k); } };
}

const DB = "dionysus-scene-drafts", STORE = "drafts";
function idbSceneDrafts(): SceneDraftStore {
  let dbp: Promise<IDBDatabase> | undefined;
  const db = () => (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "key" }); };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = undefined; }; res(d); };
    r.onerror = () => { dbp = undefined; rej(r.error); };
  }));
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const s = (await db()).transaction(STORE, mode).objectStore(STORE);
    return new Promise<T>((res, rej) => { const q = fn(s); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  };
  return {
    get: (k) => run<SceneDraft | undefined>("readonly", (s) => s.get(k) as IDBRequest<SceneDraft | undefined>),
    put: async (d) => { await run("readwrite", (s) => s.put(d)); },
    delete: async (k) => { await run("readwrite", (s) => s.delete(k)); },
  };
}

let shared: SceneDraftStore | undefined;
/** The device's draft store (IndexedDB, or memory when it is missing). */
export function sceneDrafts(): SceneDraftStore {
  return (shared ??= typeof indexedDB !== "undefined" ? idbSceneDrafts() : memorySceneDrafts());
}
