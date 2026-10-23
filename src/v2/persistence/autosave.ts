import type { Engine } from "../engine/engine";
import type { ProjectStore } from "../ports/storage";

/** Debounced save after each engine change. Returns { flush, dispose }. */
export function attachAutosave(engine: Engine, store: ProjectStore, delayMs = 500, onError?: (e: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = engine.getState().project;
  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    const p = engine.getState().project;
    if (p === lastSaved) return;
    lastSaved = p;
    try { await store.save(p); } catch (e) { onError?.(e); }
  };
  const unsub = engine.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  });
  return { flush, dispose: () => { unsub(); if (timer) clearTimeout(timer); } };
}
