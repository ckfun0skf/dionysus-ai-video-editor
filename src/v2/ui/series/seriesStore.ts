import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Engine } from "../../engine";
import { series as S, type Project, type Series } from "../../domain";

/**
 * P5: Series live in local storage (one JSON record), shared by every project and every tab of this browser.
 * Media blobs stay in the project blob store; the blob collector keeps every key a Series uses.
 */
export const SERIES_KEY = "dionysus.series.v1";
type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Record<string, Series> | undefined;

function ls(): globalThis.Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function read(): Record<string, Series> {
  if (cache) return cache;
  const out: Record<string, Series> = {};
  try {
    const raw = JSON.parse(ls()?.getItem(SERIES_KEY) ?? "{}") as Record<string, unknown>;
    for (const v of Object.values(raw)) { const s = S.parseSeries(v); if (s) out[s.id] = s; }
  } catch { /* unreadable → empty */ }
  return (cache = out);
}
function write(all: Record<string, Series>) {
  cache = all;
  try { ls()?.setItem(SERIES_KEY, JSON.stringify(all)); } catch (e) { console.warn("v2: series not saved", e); }
  listeners.forEach((l) => l());
}
if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === SERIES_KEY || e.key === null) { cache = undefined; listeners.forEach((l) => l()); } });

export const seriesStore = {
  all: (): Series[] => Object.values(read()).sort((a, b) => a.name.localeCompare(b.name)),
  get: (id: string | undefined): Series | undefined => (id ? read()[id] : undefined),
  put(s: Series) { if (read()[s.id] !== s) write({ ...read(), [s.id]: s }); },
  remove(id: string) { const { [id]: _gone, ...rest } = read(); write(rest); },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** Every blob a Series uses (for the blob collector). */
  mediaKeys: (): string[] => Object.values(read()).flatMap((s) => S.seriesMediaKeys(s)),
  /** Tests: forget the in-memory copy. */
  reset() { cache = undefined; },
};

let snap: Record<string, Series> | undefined;
const getSnap = () => (snap === read() ? snap : (snap = read()));
export function useSeriesMap(): Record<string, Series> { return useSyncExternalStore(seriesStore.subscribe, getSnap, getSnap); }
export function useSeriesList(): Series[] { const m = useSeriesMap(); return Object.values(m).sort((a, b) => a.name.localeCompare(b.name)); }
export function useSeries(id: string | undefined): Series | undefined { return useSeriesMap()[id ?? ""]; }

/** Make a project an episode of a Series (or of none). One undo step; pulls the Series in. */
export function setProjectSeries(engine: Engine, id: string | undefined) {
  const s = seriesStore.get(id);
  engine.dispatch({ label: s ? `Series: ${s.name}` : "Leave series", apply: (p) => { const { seriesId: _o, ...rest } = p; const q: Project = s ? { ...rest, seriesId: s.id } : rest; return s ? S.pullSeries(q, s) : q; } });
}

/**
 * Keep the open project and its Series in step: Series changes (here, in another project or tab) are pulled into the
 * linked assets as one undo step labelled "Series update"; edits to linked assets and assets imported with
 * "series": true are written to the Series. Both directions are idempotent, so they don't loop.
 */
export function useSeriesSync(engine: Engine, project: Project) {
  const series = useSeries(project.seriesId);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Series → project.
  useEffect(() => {
    if (!series) return;
    const p = engine.getState().project;
    const q = S.pullSeries(p, series);
    if (q !== p) engine.dispatch({ label: "Series update", apply: (cur) => S.pullSeries(cur, series) });
  }, [series, engine]);
  // Project → Series (debounced: typing in a linked asset's prompt writes once).
  useEffect(() => {
    if (!project.seriesId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = seriesStore.get(project.seriesId);
      if (!s) return;
      let p = engine.getState().project;
      let next = s;
      if (Object.values(p.storyboard?.slots ?? {}).some((x) => x.seriesPromote)) {
        const r = S.promoteFlagged(next, p);
        next = r.series;
        if (r.project !== p) { engine.dispatch({ label: "Add to series", apply: (cur) => S.promoteFlagged(s, cur).project }); p = engine.getState().project; }
      }
      next = S.captureLinked(next, p);
      seriesStore.put(next);
    }, 400);
    return () => clearTimeout(timer.current);
  }, [project, engine]);
}
