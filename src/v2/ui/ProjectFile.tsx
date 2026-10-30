/**
 * Project file export / import (V2-CUT-PROJ) — the dialogs and the save targets. The archive logic itself lives in
 * persistence/archive; this file only picks where bytes go and drives the progress UI.
 *
 * Where an export is written, best first:
 *  1. Desktop Chromium: the native "Save as" picker, streamed straight to the chosen file.
 *  2. A temporary file in the browser's private storage (OPFS), streamed to disk — `createWritable` on Chrome/Android
 *     and Firefox, a worker sync handle on Safari/iOS — then handed to saveFile (share sheet on phones, download
 *     elsewhere). Nothing large is ever held in memory.
 *  3. Blob parts in memory (old browsers).
 */
import { useEffect, useRef, useState } from "react";
import type { Project } from "../domain";
import type { BlobStore, Storage } from "../ports";
import {
  ARCHIVE_SUFFIX, BlobSink, WritableSink, exportProjectArchive, importProjectArchive, readProjectArchive,
  type ArchivePreview, type ArchiveProgress, type ImportMode,
  type ZipSink,
} from "../persistence";
import { safeName, saveFile } from "./saveFile";
import { series as S } from "../domain";
import { seriesStore } from "./series/seriesStore";

export const projectFileName = (name: string) => `${safeName(name)}${ARCHIVE_SUFFIX}`;
const TEMP = "dionysus-export.zip";
const isTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const errText = (e: unknown) => {
  if (e instanceof DOMException && e.name === "QuotaExceededError") return "There isn't enough free storage on this device to build the file. Free some space and try again.";
  return e instanceof Error ? e.message : String(e);
};

/** Where an export goes; `done()` closes it and returns the file to hand to saveFile (undefined: already saved). */
export interface ExportTarget { sink: ZipSink; kind: "picker" | "opfs" | "memory"; done(): Promise<Blob | undefined>; abort(): Promise<void> }

type Win = typeof window & { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<FileSystemWritableFileStream> }> };

/**
 * Choose the export target. Call from the click handler before any other await: the desktop save picker needs the tap.
 * Resolves undefined when the user cancels the picker.
 */
export async function openExportTarget(fileName: string): Promise<ExportTarget | undefined> {
  const w = window as Win;
  if (typeof w.showSaveFilePicker === "function" && !isTouch()) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "Dionysus project", accept: { "application/zip": [".zip"] } }] });
      const s = new WritableSink(await h.createWritable() as never);
      return { sink: s, kind: "picker", done: async () => { await s.close(); return undefined; }, abort: () => s.abort() };
    } catch (e) {
      if (isAbort(e)) return undefined;
      // SecurityError (no gesture) etc.: fall through to OPFS.
    }
  }
  const opfs = await openOpfs().catch(() => undefined);
  if (opfs) return opfs;
  const s = new BlobSink();
  return { sink: s, kind: "memory", done: async () => s.blob(), abort: async () => undefined };
}

async function openOpfs(): Promise<ExportTarget | undefined> {
  if (!navigator.storage?.getDirectory) return undefined;
  const dir = await navigator.storage.getDirectory();
  const fh = await dir.getFileHandle(TEMP, { create: true });
  const file = async () => new File([await fh.getFile()], TEMP, { type: "application/zip" });
  if (typeof (fh as { createWritable?: unknown }).createWritable === "function") {
    const s = new WritableSink(await fh.createWritable() as never);
    return { sink: s, kind: "opfs", done: async () => { await s.close(); return file(); }, abort: () => s.abort() };
  }
  if (typeof Worker !== "function") return undefined;
  const worker = new Worker(new URL("./opfsWriter.worker.ts", import.meta.url), { type: "module" });
  let seq = 0;
  const waiting = new Map<number, [() => void, (e: Error) => void]>();
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; name?: string; message?: string }>) => {
    const w = waiting.get(e.data.id); waiting.delete(e.data.id);
    if (!w) return;
    if (e.data.ok) w[0](); else w[1](e.data.name === "QuotaExceededError" ? new DOMException(e.data.message ?? "", "QuotaExceededError") : new Error(e.data.message));
  };
  const call = (m: Record<string, unknown>, transfer: Transferable[] = []) => new Promise<void>((res, rej) => { const id = ++seq; waiting.set(id, [res, rej]); worker.postMessage({ ...m, id }, transfer); });
  try { await call({ op: "open", name: TEMP }); } catch { worker.terminate(); return undefined; }
  const s = new WritableSink({ write: (d) => { const c = d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d : d.slice(); return call({ op: "write", data: c }, [c.buffer]); }, close: () => call({ op: "close" }) });
  return {
    sink: s, kind: "opfs",
    done: async () => { await s.close(); worker.terminate(); return file(); },
    abort: async () => { await s.abort(); worker.terminate(); },
  };
}

/** Remove the temporary export file (later, so a download that is still reading it can finish). */
export function dropTempExport(delayMs = 60_000) {
  setTimeout(() => { void navigator.storage?.getDirectory?.().then((d) => d.removeEntry(TEMP)).catch(() => undefined); }, delayMs);
}

/**
 * Start `run` once per mounted dialog (StrictMode mounts twice in development) and abort it when the dialog really
 * unmounts. `alive()` tells the job whether it may still set state.
 */
function useJob(run: (alive: () => boolean, signal: AbortSignal) => void) {
  const ac = useRef<AbortController>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!ac.current) { ac.current = new AbortController(); run(() => mounted.current, ac.current.signal); }
    return () => { mounted.current = false; setTimeout(() => { if (!mounted.current) ac.current?.abort(); }, 0); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { cancel: () => ac.current?.abort(), signal: () => ac.current!.signal, alive: () => mounted.current };
}

function Bar({ p }: { p?: ArchiveProgress }) {
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  return <><div className="v2-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div><p className="v2-muted">{pct}%{p ? ` · ${mb(p.done / 2)} of ${mb(p.total / 2)}` : ""}</p></>;
}

/** Runs one export into `target` and shows its progress / result. */
export function ExportFileDialog({ load, blobs, fileName, target, onClose }: { load: () => Promise<Project | undefined>; blobs: BlobStore; fileName: string; target: ExportTarget; onClose: () => void }) {
  const [p, setP] = useState<ArchiveProgress>();
  const [state, setState] = useState<{ phase: "working" } | { phase: "ready"; file?: Blob; bytes: number; missing: number; saved?: string } | { phase: "error"; message: string }>({ phase: "working" });
  const job = useJob((alive, signal) => void (async () => {
    try {
      const project = await load();
      if (!project) throw new Error("This project could not be loaded.");
      // P5: an episode bundles the Series assets it uses (series.json + their media).
      const sr = seriesStore.get(project.seriesId);
      const r = await exportProjectArchive(project, blobs, target.sink, { signal, onProgress: (x) => alive() && setP(x), series: sr && S.seriesForProject(sr, project) });
      const file = await target.done();
      let saved: string | undefined;
      // Desktop: start the download right away. Phones need a fresh tap for the share sheet, so they get a button.
      if (file && !isTouch()) saved = await saveFile(file, fileName, { preferShare: false });
      if (target.kind === "picker") saved = "saved";
      if (alive()) setState({ phase: "ready", file, bytes: r.bytes, missing: r.manifest.missing.length, saved });
    } catch (e) {
      await target.abort();
      if (alive()) { if (isAbort(e)) close(); else setState({ phase: "error", message: errText(e) }); }
    }
  })());
  const close = () => { if (target.kind === "opfs") dropTempExport(); onClose(); };

  return (
    <div className="v2-modal v2-pfile" role="dialog" aria-modal="true" aria-label="Export project file">
      <div className="v2-modal-card">
        <h2>Export project file</h2>
        <p className="v2-pfile-name">{fileName}</p>
        {state.phase === "working" && <><p className="v2-muted">Packing the project and all its media. Keep this tab open.</p><Bar p={p} /></>}
        {state.phase === "ready" && <>
          <p role="status">{state.saved === "saved" ? "Saved." : state.saved === "downloaded" ? "Downloaded." : state.saved === "shared" ? "Shared." : "Ready."} {mb(state.bytes)}</p>
          {state.missing > 0 && <p className="v2-pfile-warn">{state.missing} media file{state.missing === 1 ? " was" : "s were"} missing from this browser and {state.missing === 1 ? "is" : "are"} not in the file.</p>}
          {state.file && !state.saved && <p className="v2-muted">Tap Save file, then choose “Save to Files” or Downloads.</p>}
        </>}
        {state.phase === "error" && <p className="v2-pfile-err" role="alert">{state.message}</p>}
        <div className="v2-modal-actions">
          {state.phase === "working" && <button className="v2-btn" onClick={job.cancel}>Cancel</button>}
          {state.phase === "ready" && state.file && <button className={`v2-btn${state.saved ? "" : " primary"}`} onClick={async () => { const r = await saveFile(state.file!, fileName); if (r !== "cancelled") setState({ ...state, saved: r }); }}>{state.saved ? "Save again" : "Save file"}</button>}
          {state.phase !== "working" && <button className="v2-btn" onClick={close}>Done</button>}
        </div>
      </div>
    </div>
  );
}

type ImportState =
  | { phase: "checking" }
  | { phase: "confirm"; a: ArchivePreview; clash?: { name: string; current: boolean } }
  | { phase: "replace"; a: ArchivePreview; clash: { name: string; current: boolean } }
  | { phase: "working"; a: ArchivePreview }
  | { phase: "done"; project: Project; missing: number }
  | { phase: "error"; message: string };

/** Validates a picked file, asks how to handle an id clash, imports with progress and offers to open the result. */
export function ImportFileDialog({ file, storage, current, onOpen, onDone, onClose }: { file: File; storage: Storage; current: Project; onOpen: (id: string) => void; onDone: () => void; onClose: () => void }) {
  const [s, setS] = useState<ImportState>({ phase: "checking" });
  const [p, setP] = useState<ArchiveProgress>();
  const job = useJob((alive) => void (async () => {
    try {
      const a = await readProjectArchive(file);
      const id = a.project.id;
      const existing = id === current.id ? current : await storage.projects.load(id).catch(() => undefined);
      if (alive()) setS({ phase: "confirm", a, clash: existing ? { name: existing.name, current: id === current.id } : undefined });
    } catch (e) { if (alive()) setS({ phase: "error", message: errText(e) }); }
  })());

  const run = async (a: ArchivePreview, mode: ImportMode) => {
    setS({ phase: "working", a });
    try {
      // P5: the bundled Series reconnects to the one here (same id) or is added.
      const project = await importProjectArchive(storage, a, mode, { signal: job.signal(), onProgress: (x) => job.alive() && setP(x),
        onSeries: (incoming) => { const here = seriesStore.get(incoming.id); seriesStore.put(here ? S.mergeSeries(here, incoming) : incoming); } });
      onDone();
      if (job.alive()) setS({ phase: "done", project, missing: a.manifest.missing.length });
    } catch (e) {
      if (!job.alive()) return;
      if (isAbort(e)) onClose(); else setS({ phase: "error", message: errText(e) });
    }
  };

  const name = "a" in s ? s.a.project.name : undefined;
  return (
    <div className="v2-modal v2-pfile" role="dialog" aria-modal="true" aria-label="Import project file">
      <div className="v2-modal-card">
        <h2>Import project file</h2>
        <p className="v2-pfile-name">{file.name}</p>
        {s.phase === "checking" && <p className="v2-muted" role="status">Checking the file…</p>}
        {s.phase === "confirm" && <>
          <p><b>{name}</b> · {s.a.manifest.media.length} media file{s.a.manifest.media.length === 1 ? "" : "s"} · {mb(s.a.mediaBytes)}{s.a.manifest.app?.version ? ` · Dionysus ${s.a.manifest.app.version}` : ""}</p>
          {s.a.series && <p className="v2-muted">Episode of the series “{s.a.series.name}” ({Object.keys(s.a.series.assets).length} series asset(s) included). {seriesStore.get(s.a.series.id) ? "It reconnects to that series here." : "The series is added here."}</p>}
          {s.a.manifest.missing.length > 0 && <p className="v2-pfile-warn">{s.a.manifest.missing.length} media file(s) were missing when this file was made; those clips will show as offline.</p>}
          {s.clash && <p className="v2-pfile-warn">This project is already here as “{s.clash.name}”.{s.clash.current ? " It's open now, so it can only be imported as a copy." : ""}</p>}
        </>}
        {s.phase === "replace" && <p className="v2-pfile-warn" role="alert">Replace “{s.clash.name}” with the version in this file? Changes made to it here will be lost.</p>}
        {s.phase === "working" && <><p className="v2-muted">Checking and storing media. Keep this tab open.</p><Bar p={p} /></>}
        {s.phase === "done" && <>
          <p role="status">Imported “{s.project.name}”.</p>
          {s.missing > 0 && <p className="v2-pfile-warn">{s.missing} media file(s) were not in the file; those clips show as offline.</p>}
        </>}
        {s.phase === "error" && <p className="v2-pfile-err" role="alert">{s.message}</p>}
        <div className="v2-modal-actions">
          {s.phase === "confirm" && !s.clash && <><button className="v2-btn" onClick={onClose}>Cancel</button><button className="v2-btn primary" onClick={() => void run(s.a, "new")}>Import</button></>}
          {s.phase === "confirm" && s.clash && <>
            <button className="v2-btn" onClick={onClose}>Cancel</button>
            {!s.clash.current && <button className="v2-btn danger" onClick={() => setS({ phase: "replace", a: s.a, clash: s.clash! })}>Replace</button>}
            <button className="v2-btn primary" onClick={() => void run(s.a, "copy")}>Import as a copy</button>
          </>}
          {s.phase === "replace" && <><button className="v2-btn" onClick={() => setS({ phase: "confirm", a: s.a, clash: s.clash })}>Back</button><button className="v2-btn danger" onClick={() => void run(s.a, "replace")}>Replace</button></>}
          {s.phase === "working" && <button className="v2-btn" onClick={job.cancel}>Cancel</button>}
          {s.phase === "done" && <><button className="v2-btn" onClick={onClose}>Close</button><button className="v2-btn primary" onClick={() => onOpen(s.project.id)}>Open</button></>}
          {s.phase === "error" && <button className="v2-btn" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
