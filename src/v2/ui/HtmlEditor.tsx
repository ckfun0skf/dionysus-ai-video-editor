import { useEffect, useMemo, useRef, useState } from "react";
import { HTML_CLIP_FORMAT, lintHtmlClip, type HtmlClipManifest, type HtmlClipParam } from "../domain";
import { CLIP_LIBRARIES, HTML_SANDBOX, readClipConfig, selectedLibraries, withRuntime, writeClipConfig } from "../render";
import { ClipIssues, HtmlExportButtons } from "./HtmlImport";
import { LibraryPicker } from "./LibraryPicker";
import { joinHtml, splitHtml, type HtmlParts } from "./htmlSource";
/** V2-111: what an HTML clip can attach (so iOS offers Photos/Files rather than a generic picker). */
export const ATTACH_ACCEPT = "image/*,video/*,audio/*,.svg,.json,.csv,.txt,.js,.mjs,.css,.glb,.gltf,.bin,.woff,.woff2,.ttf,.otf";

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

/** Live preview: the same sandbox + CSP as HTML clips, driven at wall-clock time (looping over the manifest's length). */
function LivePreview({ src, loopSec }: { src: string; loopSec?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let raf = 0, seq = 0; const t0 = performance.now();
    const now = () => { const t = (performance.now() - t0) / 1000; return loopSec && loopSec > 0 ? t % loopSec : t; };
    const onMsg = (e: MessageEvent) => { if (e.source === ref.current?.contentWindow) (e.data?.bmp as ImageBitmap | undefined)?.close?.(); };
    addEventListener("message", onMsg);
    const tick = () => { ref.current?.contentWindow?.postMessage({ type: "dionysus:frame", seq: ++seq, t: now() }, "*"); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); removeEventListener("message", onMsg); };
  }, [src, loopSec]);
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
  const [cfg, setCfg] = useState<HtmlClipManifest>(() => clipConfig(source));
  const joined = writeClipConfig(joinHtml(parts), cfg);
  const [live, setLive] = useState(joined);
  useEffect(() => { const id = setTimeout(() => setLive(joined), 400); return () => clearTimeout(id); }, [joined]);
  const lint = useMemo(() => lintHtmlClip(live, { libs: CLIP_LIBRARIES }), [live]);
  const dirty = joined !== writeClipConfig(joinHtml(initial), clipConfig(source));
  const code = (p: Pane) => <Code key={p} label={PANES.find((x) => x.id === p)!.label} value={parts[p]} onChange={(v) => setParts({ ...parts, [p]: v })} />;
  return (
    <div className={`v2-code-editor ${mobile ? "is-mobile" : ""}`} role="dialog" aria-label="HTML clip editor">
      <div className="v2-code-bar">
        {mobile
          ? <div role="tablist" className="v2-tp-tabs">{[...PANES, { id: "preview" as const, label: "Preview" }].map((p) => <button key={p.id} role="tab" aria-selected={pane === p.id} className={`v2-tp-tab ${pane === p.id ? "is-active" : ""}`} onClick={() => setPane(p.id)}>{p.label}</button>)}</div>
          : <b>Edit HTML clip</b>}
        <span className="v2-code-actions">
          <HtmlExportButtons html={() => joined} name={cfg.name || "clip"} />
          <button className="v2-btn" onClick={onClose}>Cancel</button>
          <button className="v2-btn is-primary" disabled={!dirty} title={dirty ? "Save as a new version of this clip (undoable)" : "No changes"} onClick={() => onSave(joined)}>Save</button>
        </span>
      </div>
      <ClipSettings cfg={cfg} onChange={setCfg} mobile={mobile} />
      <ClipParams cfg={cfg} onChange={setCfg} />
      <ClipIssues issues={lint.issues} testId="v2-code-issues" />
      {mobile ? (
        <div className="v2-code-body">{pane === "preview" ? <LivePreview src={live} loopSec={cfg.durationSec} /> : code(pane)}</div>
      ) : (
        <div className="v2-code-split">
          {PANES.map((p) => <section key={p.id} className="v2-code-pane"><h4>{p.label}</h4>{code(p.id)}</section>)}
          <section className="v2-code-pane is-preview"><h4>Preview</h4><LivePreview src={live} loopSec={cfg.durationSec} /></section>
        </div>
      )}
    </div>
  );
}

/** The editable manifest: the page's own, the selected libraries made explicit, and a "format" (saving makes it a package). */
function clipConfig(source: string): HtmlClipManifest {
  const m = readClipConfig(source);
  return { ...m, format: m.format ?? HTML_CLIP_FORMAT, libs: selectedLibraries(source).map((l) => l.id) };
}

/** The manifest's params: edit their defaults (a saved version keeps them; V2-HTML-PKG). */
function ClipParams({ cfg, onChange }: { cfg: HtmlClipManifest; onChange: (c: HtmlClipManifest) => void }) {
  const params = cfg.params ?? {};
  const keys = Object.keys(params);
  if (!keys.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...cfg, params: { ...params, [k]: { ...params[k], default: v } as HtmlClipParam } });
  return (
    <div className="v2-code-settings v2-clip-params" data-testid="v2-clip-params">
      <span className="v2-code-label">Params</span>
      {keys.map((k) => {
        const p = params[k], label = p.label || k, id = `v2-clip-param-${k}`;
        const input = p.type === "number"
          ? <input id={id} type="number" inputMode="decimal" min={p.min} max={p.max} step={p.step ?? "any"} value={Number(p.default)} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) set(k, n); }} />
          : p.type === "color"
            ? <input id={id} type="color" value={String(p.default)} onChange={(e) => set(k, e.target.value)} />
            : p.type === "boolean"
              ? <input id={id} type="checkbox" checked={!!p.default} onChange={(e) => set(k, e.target.checked)} />
              : p.type === "select"
                ? <select id={id} value={String(p.default)} onChange={(e) => set(k, e.target.value)}>{(p.options ?? []).map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>
                : <input id={id} type="text" value={String(p.default ?? "")} onChange={(e) => set(k, e.target.value)} />;
        return <label key={k} className="v2-clip-param" htmlFor={id} title={p.description}>{label}{input}</label>;
      })}
    </div>
  );
}

const MAX_ATTACHMENT = 15 * 1024 * 1024;
const readData = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

/** Library toggles (from the registry) and file attachments referenced by relative name. */
function ClipSettings({ cfg, onChange, mobile }: { cfg: HtmlClipManifest; onChange: (c: HtmlClipManifest) => void; mobile: boolean }) {
  const libs = cfg.libs ?? [], assets = cfg.files ?? {};
  const [err, setErr] = useState("");
  const attach = async (files: FileList | null) => {
    const next = { ...assets }; setErr("");
    for (const f of [...(files ?? [])]) {
      if (f.size > MAX_ATTACHMENT) { setErr(`${f.name} is over 15 MB`); continue; }
      next[f.name.replace(/[^\w.\-]/g, "_")] = await readData(f);
    }
    onChange({ ...cfg, files: next });
  };
  return (
    <div className="v2-code-settings">
      <LibraryPicker mobile={mobile} value={libs} onChange={(l) => onChange({ ...cfg, libs: l })} />
      <span className="v2-code-label">Files</span>
      {Object.keys(assets).length === 0 && <span className="v2-muted">None. Attach images, models or fonts, then use them by name, e.g. src="logo.png".</span>}
      {Object.keys(assets).map((n) => (
        <span key={n} className="v2-chip" title={`Use as "${n}" (src, href, fetch, CSS url())`}>{n}
          <button aria-label={`Remove ${n}`} title={`Remove ${n}`} onClick={() => { const a = { ...assets }; delete a[n]; onChange({ ...cfg, files: a }); }}>×</button>
        </span>
      ))}
      <label className="v2-btn" title="Attach files to this clip">+ Attach<input type="file" multiple hidden accept={ATTACH_ACCEPT} aria-label="Attach files" onChange={(e) => void attach(e.target.files)} /></label>
      {err && <span role="alert" className="v2-err">{err}</span>}
    </div>
  );
}
