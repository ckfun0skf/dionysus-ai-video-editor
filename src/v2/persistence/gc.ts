import type { Storage } from "../ports/storage";

/** Orphan marks live in the blob store itself so they survive reloads; never collected. */
export const GC_MARKS_KEY = "__gc/marks";
export const GC_GRACE_MS = 24 * 60 * 60 * 1000;

type Locks = { request<T>(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<T>): Promise<T> };
export interface GcOptions {
  /** A blob must be unreferenced for this long (across runs) before it is deleted. */
  graceMs?: number;
  now?: () => number;
  /** Cross-tab lock (Web Locks). Omitted/unsupported → run unlocked (single-tab browsers). */
  locks?: Locks | null;
  onError?: (e: unknown) => void;
}

/**
 * Delete blobs unreferenced by every saved project for at least `graceMs`. Two-phase: the first run
 * only marks orphans, so a blob written by another tab/import that has not been saved into a project
 * yet is never deleted. Runs under a cross-tab Web Lock (skips if another tab holds it). If any project
 * fails to load, its references are unknown, so nothing is deleted. Never throws.
 */
export async function collectUnusedBlobs(storage: Storage, opts: GcOptions = {}): Promise<number> {
  const locks = opts.locks !== undefined ? opts.locks : (globalThis.navigator as { locks?: Locks } | undefined)?.locks ?? null;
  try {
    if (!locks) return await run(storage, opts);
    return await locks.request("dionysus-v2-gc", { ifAvailable: true }, async (lock) => (lock ? run(storage, opts) : 0));
  } catch (e) {
    opts.onError?.(e);
    return 0;
  }
}

async function run(storage: Storage, { graceMs = GC_GRACE_MS, now = Date.now, onError }: GcOptions): Promise<number> {
  const used = new Set<string>();
  let complete = true;
  for (const s of await storage.projects.list()) {
    try {
      const p = await storage.projects.load(s.id);
      if (!p) { complete = false; continue; }
      for (const a of Object.values(p.assets ?? {})) for (const v of a.versions) used.add(v.media.blobKey);
    } catch (e) { complete = false; onError?.(e); }
  }
  const marks = await readMarks(storage);
  const t = now();
  const next: Record<string, number> = {};
  let n = 0;
  for (const k of await storage.blobs.keys()) {
    if (k === GC_MARKS_KEY || used.has(k)) continue;
    const since = marks[k] ?? t;
    if (complete && t - since >= graceMs) {
      try { await storage.blobs.delete(k); n += 1; } catch (e) { onError?.(e); next[k] = since; }
    } else next[k] = since;
  }
  await storage.blobs.put(GC_MARKS_KEY, new Blob([JSON.stringify(next)], { type: "application/json" }));
  return n;
}

async function readMarks(storage: Storage): Promise<Record<string, number>> {
  try {
    const b = await storage.blobs.get(GC_MARKS_KEY);
    const v: unknown = b ? JSON.parse(await b.text()) : {};
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch { return {}; }
}
