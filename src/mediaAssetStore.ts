const DB_NAME = "dionysus-media-assets";
const STORE_NAME = "media";
const MEDIA_PREFIX = "idb://media/";

export interface ResolvedMediaSource {
  src: string;
  remote: boolean;
  release?: () => void;
}

function openMediaDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not support IndexedDB media storage."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local media storage."));
    request.onblocked = () => reject(new Error("Local media storage is blocked by another open tab."));
  });
}

export function mediaAssetPath(assetId: string): string {
  return MEDIA_PREFIX + encodeURIComponent(assetId);
}

export function isStoredMediaPath(path: string): boolean {
  return path.startsWith(MEDIA_PREFIX);
}

function assetIdFromPath(path: string): string {
  if (!isStoredMediaPath(path)) throw new Error("This path is not a local media asset reference.");
  return decodeURIComponent(path.slice(MEDIA_PREFIX.length));
}

export async function storeMediaAsset(assetId: string, blob: Blob): Promise<string> {
  const database = await openMediaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(blob, assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save imported media."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving imported media was aborted."));
    });
  } finally { database.close(); }
  return mediaAssetPath(assetId);
}

export async function getStoredMediaAsset(assetId: string): Promise<Blob> {
  const database = await openMediaDatabase();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(assetId);
      request.onsuccess = () => {
        if (request.result instanceof Blob) resolve(request.result);
        else reject(new Error("The local media file is missing. Re-import the source file in this browser."));
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read imported media."));
    });
  } finally { database.close(); }
}

export async function deleteStoredMediaAsset(assetId: string): Promise<void> {
  const database = await openMediaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(assetId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove stored media."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Removing stored media was aborted."));
    });
  } finally { database.close(); }
}

export async function resolveMediaSource(path: string): Promise<ResolvedMediaSource> {
  if (isStoredMediaPath(path)) {
    const blob = await getStoredMediaAsset(assetIdFromPath(path));
    const src = URL.createObjectURL(blob);
    return { src, remote: false, release: () => URL.revokeObjectURL(src) };
  }
  return { src: path, remote: /^https?:/i.test(path) };
}

export async function loadMediaBlobFromPath(path: string): Promise<Blob> {
  if (isStoredMediaPath(path)) return getStoredMediaAsset(assetIdFromPath(path));
  const response = await fetch(path);
  if (!response.ok) throw new Error("Could not read media source (HTTP " + response.status + ").");
  return response.blob();
}
