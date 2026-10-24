import { useEffect, useRef, useState } from "react";
import { exportName, exportProject, RESOLUTIONS, type ExportProgress, type ExportResult, type Resolution } from "../render";
import type { Project } from "../domain";
import type { BlobStore } from "../ports";
import { Ic } from "./Icon";

type Run = typeof exportProject;
type State = { s: "idle" } | { s: "running"; p: ExportProgress } | { s: "done"; r: ExportResult; url: string } | { s: "error"; msg: string };
const STAGE = { audio: "Mixing audio…", video: "Rendering frames", finalize: "Finishing file…" };

/** Export progress dialog: pick a size, watch progress, cancel, then download. */
export function ExportDialog({ project, blobs, res, onRes, onClose, run = exportProject }: { project: Project; blobs: BlobStore; res: Resolution; onRes: (r: Resolution) => void; onClose: () => void; run?: Run }) {
  const [st, setSt] = useState<State>({ s: "idle" });
  const ctl = useRef<AbortController>();
  const busy = st.s === "running";
  const url = st.s === "done" ? st.url : undefined;
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && (busy ? ctl.current?.abort() : onClose());
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  const start = async () => {
    const c = new AbortController(); ctl.current = c;
    setSt({ s: "running", p: { stage: "audio", done: 0, total: 1 } });
    try {
      const r = await run(project, blobs, { res, signal: c.signal, onProgress: (p) => !c.signal.aborted && setSt({ s: "running", p }) });
      if (!c.signal.aborted) setSt({ s: "done", r, url: URL.createObjectURL(r.blob) });
    } catch (e) {
      setSt(c.signal.aborted ? { s: "idle" } : { s: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };
  const pct = st.s === "running" ? (st.p.stage === "video" ? Math.round((st.p.done / Math.max(1, st.p.total)) * 100) : st.p.stage === "finalize" ? 100 : 0) : 0;
  return (
    <div className="v2-modal" role="dialog" aria-modal="true" aria-label="Export video">
      <div className="v2-modal-card">
        <h2>Export video</h2>
        {st.s === "idle" && <>
          <label className="v2-field">Resolution
            <select aria-label="Export resolution" value={res} onChange={(e) => onRes(e.target.value as Resolution)}>{Object.keys(RESOLUTIONS).map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <p className="v2-muted">MP4 (H.264 + AAC) where the browser supports WebCodecs; otherwise WebM, recorded in real time.</p>
          <div className="v2-modal-actions"><button className="v2-btn" onClick={onClose}>Cancel</button><button className="v2-btn primary" onClick={() => void start()}>Start export</button></div>
        </>}
        {st.s === "running" && <>
          <p role="status">{STAGE[st.p.stage]}{st.p.stage === "video" ? ` ${st.p.done} / ${st.p.total}` : ""}</p>
          <div className="v2-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
          <div className="v2-modal-actions"><button className="v2-btn" title="Stop the export (Esc)" onClick={() => ctl.current?.abort()}>Cancel export</button></div>
        </>}
        {st.s === "done" && <>
          <p role="status">Done — {st.r.ext.toUpperCase()}, {(st.r.blob.size / 1e6).toFixed(1)} MB.</p>
          {st.r.note && <p className="v2-muted">{st.r.note}</p>}
          {!!st.r.warnings?.length && <div className="v2-warn" role="alert"><b><Ic g="⚠" size={16} /> Some clip frames could not be rendered</b><ul>{st.r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
          <div className="v2-modal-actions"><button className="v2-btn" onClick={onClose}>Close</button><a className="v2-btn primary" href={st.url} download={exportName(project.name, st.r.ext)}>Download</a></div>
        </>}
        {st.s === "error" && <>
          <p role="alert">Export failed: {st.msg}</p>
          <div className="v2-modal-actions"><button className="v2-btn" onClick={onClose}>Close</button><button className="v2-btn primary" onClick={() => void start()}>Try again</button></div>
        </>}
      </div>
    </div>
  );
}
