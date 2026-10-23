import { useEffect, useState, useSyncExternalStore } from "react";
import { Engine } from "../engine";
import { createProject, type Project } from "../domain";
import { attachAutosave, collectUnusedBlobs, createIndexedDbStorage, createMemoryStorage } from "../persistence";
import type { Storage } from "../ports";

/** Set when the last project failed to load; the stored record is kept untouched for recovery. */
export interface LoadFailure { projectId: string; error: string }
export interface EditorContext { engine: Engine; storage: Storage; recovery?: LoadFailure; flush: () => Promise<void> }
export type BootState = { status: "loading" } | { status: "ready"; ctx: EditorContext } | { status: "error"; error: string };

async function openStorage(): Promise<Storage> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    const s = createIndexedDbStorage();
    await s.projects.list();
    return s;
  } catch {
    return createMemoryStorage();
  }
}

/** Boot: open storage, load last project (or create one), wire autosave. Cleans up on unmount. */
/** `key` re-runs the boot (used to switch projects: set lastProjectId, then bump the key). */
export function useEditorBoot(open: () => Promise<Storage> = openStorage, key = 0): BootState {
  const [state, setState] = useState<BootState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    (async () => {
      const storage = await open();
      await collectUnusedBlobs(storage, { onError: (e) => console.warn("v2: blob GC skipped", e) });
      const lastId = storage.lastProjectId.get();
      let recovery: LoadFailure | undefined;
      let project: Project | undefined;
      if (lastId) {
        try { project = await storage.projects.load(lastId); } catch (e) {
          recovery = { projectId: lastId, error: e instanceof Error ? e.message : String(e) };
          console.error("v2: last project failed to load; starting a new one and keeping the original", e);
        }
      }
      if (!project) { project = createProject(recovery ? "Recovered session" : "My first v2 project"); await storage.projects.save(project); }
      if (cancelled) return;
      storage.lastProjectId.set(project.id);
      const engine = new Engine(project);
      const auto = attachAutosave(engine, storage.projects, 500, (e) => console.warn("v2 autosave failed; retrying", e));
      const onHide = () => void auto.flush();
      window.addEventListener("pagehide", onHide);
      document.addEventListener("visibilitychange", onHide);
      dispose = () => { void auto.flush(); auto.dispose(); window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onHide); };
      setState({ status: "ready", ctx: { engine, storage, recovery, flush: auto.flush } });
    })().catch((e) => { if (!cancelled) setState({ status: "error", error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; dispose?.(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function useEngineState(engine: Engine) {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

export function useIsMobile(query = "(max-width: 820px)") {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}
