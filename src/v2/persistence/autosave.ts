import type { ProjectSource } from "../ports/projectSource";
import type { ProjectStore } from "../ports/storage";

/**
 * Debounced save after each change. lastSaved only advances after a successful save;
 * failed saves are retried with backoff (capped) until they succeed or a newer change arrives.
 */
export function attachAutosave(source: ProjectSource, store: ProjectStore, delayMs = 500, onError?: (e: unknown) => void, maxRetryMs = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = source.getState().project;
  let failures = 0;
  let inflight: Promise<void> | undefined;
  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };
  const save = async () => {
    const p = source.getState().project;
    if (p === lastSaved) return;
    try {
      await store.save(p);
      lastSaved = p;
      failures = 0;
    } catch (e) {
      failures += 1;
      onError?.(e);
      if (!disposed) schedule(Math.min(maxRetryMs, delayMs * 2 ** failures));
    }
  };
  let disposed = false;
  const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    while (inflight) await inflight;
    inflight = save().finally(() => { inflight = undefined; });
    return inflight;
  };
  const unsub = source.subscribe(() => schedule(delayMs));
  return {
    flush,
    isDirty: () => source.getState().project !== lastSaved,
    dispose: () => { disposed = true; unsub(); if (timer) clearTimeout(timer); },
  };
}
