import type { Storage } from "../ports/storage";

/** Delete blobs not referenced by any saved project. Run at boot (never while undo could restore them). */
export async function collectUnusedBlobs(storage: Storage): Promise<number> {
  const used = new Set<string>();
  for (const s of await storage.projects.list()) {
    const p = await storage.projects.load(s.id);
    for (const a of Object.values(p?.assets ?? {})) for (const v of a.versions) used.add(v.media.blobKey);
  }
  let n = 0;
  for (const k of await storage.blobs.keys()) if (!used.has(k)) { await storage.blobs.delete(k); n += 1; }
  return n;
}
