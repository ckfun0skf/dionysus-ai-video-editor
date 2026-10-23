import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Engine } from "../engine/engine";
import { createProject, type Project } from "../domain/model";
import { createIndexedDbStorage } from "../persistence/indexeddb";
import { createMemoryStorage } from "../persistence/memory";
import { attachAutosave } from "../persistence/autosave";
import type { Storage } from "../ports/storage";

export interface EditorContext { engine: Engine; storage: Storage }

/** Boot: open storage, load last project (or create one), wire autosave. */
export function useEditorBoot(): EditorContext | undefined {
  const [ctx, setCtx] = useState<EditorContext>();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let dispose = () => {};
    (async () => {
      let storage: Storage;
      try { storage = typeof indexedDB !== "undefined" ? createIndexedDbStorage() : createMemoryStorage(); await storage.projects.list(); }
      catch { storage = createMemoryStorage(); }
      const lastId = storage.lastProjectId.get();
      let project: Project | undefined = lastId ? await storage.projects.load(lastId).catch(() => undefined) : undefined;
      if (!project) { project = createProject("My first v2 project"); await storage.projects.save(project); }
      storage.lastProjectId.set(project.id);
      const engine = new Engine(project);
      const auto = attachAutosave(engine, storage.projects);
      const onHide = () => void auto.flush();
      window.addEventListener("pagehide", onHide);
      document.addEventListener("visibilitychange", onHide);
      dispose = () => { auto.dispose(); window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onHide); };
      setCtx({ engine, storage });
    })();
    return () => dispose();
  }, []);
  return ctx;
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
