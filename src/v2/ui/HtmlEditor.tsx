import { useEffect, useMemo, useRef, useState } from "react";
import { HTML_LIBRARIES, HTML_SANDBOX, readClipConfig, selectedLibraries, withRuntime, writeClipConfig, type ClipConfig } from "../render";
import { joinHtml, splitHtml, type HtmlParts } from "./htmlSource";

type Pane = "html" | "css" | "js";
const PANES: { id: Pane; label: string }[] = [{ id: "html", label: "HTML" }, { id: "css", label: "CSS" }, { id: "js", label: "JS" }];

/** Monospace textarea with a line-number gutter. Tab inserts two spaces. */
function Code({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  return (
    <div className="v2-code">
      <div className="v2-code-gutter" ref={gutter} aria-hidden>{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
      <textarea aria-label={`${label} code`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          e.preventDefault();
          const t = e.currentTarget, s = t.selectionStart;
          onChange(value.slice(0, s) + "  " + value.slice(t.selectionEnd));
          requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
        }}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Live preview: the same sandbox + CSP as HTML clips, driven at wall-clock time. */
function LivePreview({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let raf = 0, seq = 0; const t0 = performance.now();
    const onMsg = (e: MessageEvent) => { if (e.source === ref.current?.contentWindow) (e.data?.bmp as ImageBitmap | undefined)?.close?.(); };
    addEventListener("message", onMsg);
    const tick = () => { ref.current?.contentWindow?.postMessage({ type: "dionysus:frame", seq: ++seq, t: (performance.now() - t0) / 1000 }, "*"); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); removeEventListener("message", onMsg); };
  }, [src]);
  return <iframe ref={ref} className="v2-code-preview" title="Live preview" sandbox={HTML_SANDBOX} srcDoc={withRuntime(src)} />;
}

/**
 * CodePen-like editor for an HTML clip: tabs on mobile, split panes on desktop, debounced live preview.
 * Save creates a new asset version (one undo step); Cancel discards.
 */
export function HtmlEditor({ source, mobile, onSave, onClose }: { source: string; mobile: boolean; onSave: (html: string) => void; onClose: () => void }) {
  const initial = useMemo(() => splitHtml(source), [source]);
  const [parts, setParts] = useState<HtmlParts>(initial);
  const [pane, setPane] = useState<Pane | "preview">("html");
  const [cfg, setCfg] = useState<ClipConfig>(() => ({ libs: selectedLibraries(source).map((l) => l.id), assets: readClipConfig(source).assets ?? {} }));
  const joined = writeClipConfig(joinHtml(parts), cfg);
  const [live, setLive] = useState(joined);
  useEffect(() => { const id = setTimeout(() => setLive(joined), 400); return () => clearTimeout(id); }, [joined]);
  const dirty = joined !== writeClipConfig(joinHtml(initial), { libs: selectedLibraries(source).map((l) => l.id), assets: readClipConfig(source).assets ?? {} });
  const code = (p: Pane) => <Code key={p} label={PANES.find((x) => x.id === p)!.label} value={parts[p]} onChange={(v) => setParts({ ...parts, [p]: v })} />;
  return (
    <div className={`v2-code-editor ${mobile ? "is-mobile" : ""}`} role="dialog" aria-label="HTML clip editor">
      <div className="v2-code-bar">
        {mobile
          ? <div role="tablist" className="v2-tp-tabs">{[...PANES, { id: "preview" as const, label: "Preview" }].map((p) => <button key={p.id} role="tab" aria-selected={pane === p.id} className={`v2-tp-tab ${pane === p.id ? "is-active" : ""}`} onClick={() => setPane(p.id)}>{p.label}</button>)}</div>
          : <b>Edit HTML clip</b>}
        <span className="v2-code-actions">
          <button className="v2-btn" onClick={onClose}>Cancel</button>
          <button className="v2-btn is-primary" disabled={!dirty} title={dirty ? "Save as a new version of this clip (undoable)" : "No changes"} onClick={() => onSave(joined)}>Save</button>
        </span>
      </div>
      <ClipSettings cfg={cfg} onChange={setCfg} />
      {mobile ? (
        <div className="v2-code-body">{pane === "preview" ? <LivePreview src={live} /> : code(pane)}</div>
      ) : (
        <div className="v2-code-split">
          {PANES.map((p) => <section key={p.id} className="v2-code-pane"><h4>{p.label}</h4>{code(p.id)}</section>)}
          <section className="v2-code-pane is-preview"><h4>Preview</h4><LivePreview src={live} /></section>
        </div>
      )}
    </div>
  );
}

const MAX_ATTACHMENT = 15 * 1024 * 1024;
const readData = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

/** Library toggles (from the registry) and file attachments referenced by relative name. */
function ClipSettings({ cfg, onChange }: { cfg: ClipConfig; onChange: (c: ClipConfig) => void }) {
  const libs = cfg.libs ?? [], assets = cfg.assets ?? {};
  const [err, setErr] = useState("");
  const attach = async (files: FileList | null) => {
    const next = { ...assets }; setErr("");
    for (const f of [...(files ?? [])]) {
      if (f.size > MAX_ATTACHMENT) { setErr(`${f.name} is over 15 MB`); continue; }
      next[f.name.replace(/[^\w.\-]/g, "_")] = await readData(f);
    }
    onChange({ ...cfg, assets: next });
  };
  return (
    <div className="v2-code-settings">
      <span className="v2-code-label">Libraries</span>
      {HTML_LIBRARIES.map((l) => (
        <label key={l.id} className="v2-chip" title={`Self-hosted ${l.name} ${l.version}, pinned by SRI. Import it as "${l.specifier}".`}>
          <input type="checkbox" checked={libs.includes(l.id)} onChange={(e) => onChange({ ...cfg, libs: e.target.checked ? [...libs, l.id] : libs.filter((x) => x !== l.id) })} />
          {l.name}
        </label>
      ))}
      <span className="v2-code-label">Files</span>
      {Object.keys(assets).length === 0 && <span className="v2-muted">None. Attach images, models or fonts, then use them by name, e.g. src="logo.png".</span>}
      {Object.keys(assets).map((n) => (
        <span key={n} className="v2-chip" title={`Use as "${n}" (src, href, fetch, CSS url())`}>{n}
          <button aria-label={`Remove ${n}`} title={`Remove ${n}`} onClick={() => { const a = { ...assets }; delete a[n]; onChange({ ...cfg, assets: a }); }}>×</button>
        </span>
      ))}
      <label className="v2-btn" title="Attach files to this clip">+ Attach<input type="file" multiple hidden aria-label="Attach files" onChange={(e) => void attach(e.target.files)} /></label>
      {err && <span role="alert" className="v2-err">{err}</span>}
    </div>
  );
}
