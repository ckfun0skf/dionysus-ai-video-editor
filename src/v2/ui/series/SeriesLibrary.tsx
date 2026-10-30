import { useEffect, useRef, useState } from "react";
import { roundtrip, series as S, storyAgent, type Project, type Series } from "../../domain";
import { cmd, type Engine } from "../../engine";
import { SERIES_ARCHIVE_SUFFIX, exportSeriesArchive, importSeriesArchive, readAnyArchive } from "../../persistence";
import type { BlobStore, Storage } from "../../ports";
import { Ic } from "../Icon";
import { openExportTarget, dropTempExport } from "../ProjectFile";
import { safeName, saveFile } from "../saveFile";
import { grab } from "../useThumbs";
import { seriesStore, setProjectSeries, useSeries, useSeriesList } from "./seriesStore";

const NEW = "__new__";

/** P5: pick this project's Series (or none, or a new one). Shared by the library, Project settings and New project. */
export function SeriesSelect({ value, onChange, label = "Series" }: { value: string | undefined; onChange: (id: string | undefined) => void; label?: string }) {
  const list = useSeriesList();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const make = () => { const n = name.trim(); if (!n) return; const s = S.createSeries(n); seriesStore.put(s); setNaming(false); setName(""); onChange(s.id); };
  return (
    <div className="v2-series-select">
      <select aria-label={label} value={naming ? NEW : value ?? ""} onChange={(e) => { const v = e.target.value; if (v === NEW) setNaming(true); else { setNaming(false); onChange(v || undefined); } }}>
        <option value="">No series</option>
        {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value={NEW}>New series…</option>
      </select>
      {naming && <form className="v2-series-new" onSubmit={(e) => { e.preventDefault(); make(); }}>
        <input autoFocus aria-label="New series name" placeholder="Series name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="v2-btn primary" disabled={!name.trim()}>Create</button>
        <button type="button" className="v2-btn" onClick={() => setNaming(false)}>Cancel</button>
      </form>}
    </div>
  );
}

/** Preview of a Series asset: the selected version's thumbnail (or the image / first video frame). */
function useSeriesThumbs(series: Series | undefined, blobs: BlobStore): Record<string, string> {
  const [out, setOut] = useState<Record<string, string>>({});
  const started = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    for (const sa of Object.values(series?.assets ?? {})) {
      const a = sa.media[""]?.asset ?? Object.values(sa.media)[0]?.asset;
      const v = a && (a.versions.find((x) => x.id === a.selectedVersionId) ?? a.versions[0]);
      if (!a || !v || a.kind === "audio") continue;
      const k = `${sa.id}:${v.id}`;
      if (started.current.has(k)) continue;
      started.current.add(k);
      const key = v.media.thumbKey ?? v.media.blobKey;
      void blobs.get(key).then((b) => b && grab(v.media.thumbKey ? "image" : a.kind, b)).then((url) => { if (alive && url) setOut((t) => ({ ...t, [sa.id]: url })); }).catch(() => started.current.delete(k));
    }
    return () => { alive = false; };
  }, [series, blobs]);
  return out;
}

/**
 * P5 Series library: the project's Series, its shared assets with previews, "Use in episode", remove, and the Series
 * zip (export / import, which reconnects to the same Series or creates it).
 */
export function SeriesLibrary({ engine, project, storage, onClose }: { engine: Engine; project: Project; storage: Storage; onClose: () => void }) {
  const series = useSeries(project.seriesId);
  const thumbs = useSeriesThumbs(series, storage.blobs);
  const [type, setType] = useState<string>("all");
  const [note, setNote] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose, busy]);
  const rows = series ? S.seriesAssetList(series) : [];
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const shown = rows.filter((r) => type === "all" || r.type === type);
  const linked = new Set(S.linkedSlots(project).values());

  const use = (id: string) => {
    if (!series) return;
    const sb = project.storyboard;
    const res = storyAgent.runStoryTool("use_series_asset", { id }, sb ? roundtrip.storyboardToDoc(sb) : undefined, { guide: () => "", series });
    if (res.ok && res.doc) { engine.dispatch(cmd.mergeStoryboardDoc(res.doc), `Use series asset ${id}`); setNote(`Added “${id}” to this episode, linked to the series.`); }
    else setNote(res.text);
  };
  const remove = (id: string) => { setConfirm(undefined); if (series) { seriesStore.put(S.removeSeriesAsset(series, id)); setNote(`Removed “${id}” from the series. Episodes keep their own copy.`); } };
  const exportZip = async () => {
    if (!series) return;
    const name = `${safeName(series.name)}${SERIES_ARCHIVE_SUFFIX}`;
    const target = await openExportTarget(name);
    if (!target) return;
    setBusy(true); setNote("Packing the series and its media…");
    try {
      const r = await exportSeriesArchive(series, storage.blobs, target.sink);
      const file = await target.done();
      if (file) await saveFile(file, name);
      if (target.kind === "opfs") dropTempExport();
      setNote(`Exported ${r.manifest.series.assets} asset(s)${r.manifest.missing.length ? `; ${r.manifest.missing.length} media file(s) were missing` : ""}.`);
    } catch (e) { await target.abort(); setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const importZip = async (file: File) => {
    setBusy(true); setNote("Checking the file…");
    try {
      const a = await readAnyArchive(file);
      if (!("series" in a) || "project" in a) throw new Error("This is a project file. Import it from Projects; its series assets come with it.");
      const incoming = await importSeriesArchive(storage, a);
      const here = seriesStore.get(incoming.id);
      seriesStore.put(here ? S.mergeSeries(here, incoming) : incoming);
      if (!project.seriesId) setProjectSeries(engine, incoming.id);
      setNote(`${here ? "Updated" : "Added"} series “${incoming.name}” (${Object.keys(incoming.assets).length} asset(s)).`);
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="v2-modal v2-series" role="dialog" aria-modal="true" aria-label="Series library">
      <div className="v2-modal-card v2-series-card">
        <div className="v2-panel-head"><h2>Series library</h2><span className="v2-spacer" />
          <button className="v2-icon v2-series-close" aria-label="Close series library" title="Close (Esc)" disabled={busy} onClick={onClose}><Ic g="✕" size={18} /></button>
        </div>
        <label className="v2-series-row"><span>This project's series</span>
          <SeriesSelect value={project.seriesId} onChange={(id) => setProjectSeries(engine, id)} label="This project's series" />
        </label>
        <div className="v2-series-actions">
          <button className="v2-btn" disabled={busy} title="Import a series zip: reconnects to the same series or adds it" onClick={() => picker.current?.click()}><Ic g="⇪" size={16} /> Import series zip</button>
          <button className="v2-btn" disabled={busy || !series} title="Download the whole series (definitions, versions and media) as one zip" onClick={() => void exportZip()}><Ic g="⇩" size={16} /> Export series zip</button>
          <input ref={picker} type="file" hidden accept=".zip,application/zip,application/x-zip-compressed" aria-label="Series file to import" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void importZip(f); }} />
        </div>
        {note && <p className="v2-series-note" role="status">{note}</p>}
        {!series ? <p className="v2-empty">Pick or create a series to share characters, props, locations and styles between episodes.</p> : <>
          {types.length > 1 && <div className="v2-series-chips" role="radiogroup" aria-label="Asset type">
            {["all", ...types].map((t) => <button key={t} role="radio" aria-checked={type === t} className={`v2-chip ${type === t ? "is-active" : ""}`} onClick={() => setType(t)}>{t === "all" ? "All" : t}</button>)}
          </div>}
          {rows.length === 0 ? <p className="v2-empty">“{series.name}” has no assets yet. Open an asset on the storyboard and choose Promote to series, or import a storyboard whose assets have "series": true.</p> : (
            <ul className="v2-series-grid" aria-label={`${series.name} assets`}>
              {shown.map((r) => (
                <li key={r.id} className="v2-series-tile" data-testid={`series-asset-${r.id}`}>
                  <div className="v2-series-thumb">{thumbs[r.id] ? <img src={thumbs[r.id]} alt="" /> : <Ic g="image" size={28} />}</div>
                  <div className="v2-series-meta"><strong>{r.name}</strong><small>{r.id} · {r.type}{r.versions ? ` · ${r.versions} version${r.versions === 1 ? "" : "s"}` : ""}</small>
                    {r.description && <p>{r.description}</p>}{r.states.length > 0 && <small>States: {r.states.join(", ")}</small>}</div>
                  <div className="v2-series-tile-actions">
                    {confirm === r.id ? <>
                      <button className="v2-btn danger" onClick={() => remove(r.id)}>Remove</button><button className="v2-btn" onClick={() => setConfirm(undefined)}>Keep</button>
                    </> : <>
                      <button className="v2-btn primary" disabled={linked.has(r.id) || !project.storyboard} title={linked.has(r.id) ? "Already in this episode" : !project.storyboard ? "Create or import this episode's storyboard first" : "Add it to this episode's storyboard, linked"} onClick={() => use(r.id)}>{linked.has(r.id) ? "In episode" : "Use in episode"}</button>
                      <button className="v2-btn" aria-label={`Remove ${r.name} from the series`} onClick={() => setConfirm(r.id)}>Remove</button>
                    </>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>}
      </div>
    </div>
  );
}
