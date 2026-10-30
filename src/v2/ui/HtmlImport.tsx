/**
 * V2-HTML-PKG: paste or import an HTML clip package (docs/v2/HTML_CLIP_PACKAGE.md) and export one.
 * The paste box takes the AI's whole reply (the ```html block is extracted) or raw HTML; a .html/.htm/.zip file can be
 * chosen (phones: the system picker) or, on desktop, dropped on the box. Validation runs as you type; errors block
 * "Add as new version", warnings don't.
 */
import { useMemo, useState, type DragEvent } from "react";
import { extractHtml, HTML_CLIP_ZIP_SUFFIX, lintHtmlClip, type BindingType, type HtmlClipIssue, type HtmlClipParam } from "../domain";
import { CLIP_LIBRARIES } from "../render";
import { exportHtmlFile, exportHtmlZip, HTML_IMPORT_ACCEPT, importHtmlPackage, packageBaseName } from "./htmlPackage";
import { saveFile } from "./saveFile";

/** Errors first, then warnings; each with its code for the spec's table. */
export function ClipIssues({ issues, testId = "v2-clip-issues" }: { issues: readonly HtmlClipIssue[]; testId?: string }) {
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  const errors = issues.filter((i) => i.level === "error").length;
  return (
    <div className="v2-clip-issues" data-testid={testId}>
      <span className="v2-muted">{errors ? `${errors} error${errors > 1 ? "s" : ""}` : "No errors"}{issues.length > errors ? `, ${issues.length - errors} warning${issues.length - errors > 1 ? "s" : ""}` : ""}</span>
      <ul>
        {sorted.map((i, n) => (
          <li key={n} className={i.level === "error" ? "is-error" : "is-warning"} role={i.level === "error" ? "alert" : undefined}>
            <b>{i.level === "error" ? "Error" : "Warning"}</b> {i.message} <code>{i.code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Export .html" (the canonical single file) and "Export .zip" (the portable package) for one clip source. */
export function HtmlExportButtons({ html, name, small, label }: { html: () => Promise<string | undefined> | string | undefined; name: string; small?: boolean; label?: string }) {
  const [msg, setMsg] = useState("");
  const run = async (zip: boolean) => {
    setMsg("");
    try {
      const src = await html();
      if (!src) { setMsg("This version's file is missing."); return; }
      const base = packageBaseName(src, name);
      if (zip) await saveFile(await exportHtmlZip(src), `${base}${HTML_CLIP_ZIP_SUFFIX}`);
      else await saveFile(exportHtmlFile(src), `${base}.html`);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const cls = `v2-btn${small ? " v2-btn-small" : ""}`;
  return (
    <span className="v2-clip-export">
      <button className={cls} aria-label={small ? `Export ${label ?? name} as .html` : undefined} title="Download the clip as one self-contained .html file (dionysus.htmlclip/1)" onClick={() => void run(false)}>{small ? "⇩ .html" : "Export .html"}</button>
      <button className={cls} aria-label={small ? `Export ${label ?? name} as .zip` : undefined} title={`Download a ${HTML_CLIP_ZIP_SUFFIX} with manifest.json, index.html, style.css, script.js and the clip's files`} onClick={() => void run(true)}>{small ? "⇩ .zip" : "Export .zip"}</button>
      {msg && <span role="alert" className="v2-err">{msg}</span>}
    </span>
  );
}

const canPaste = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";
const finePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

/** Paste box + file picker (+ drop on desktop) with live validation; `onAdd` receives the single-file HTML. */
export function HtmlImport({ expectBindings, expectParams, onAdd, busy, actionLabel = "Add as new version", actionTitle = "Add this clip as a new version (undoable)", dropHint }: { expectBindings?: Record<string, BindingType>; expectParams?: Record<string, HtmlClipParam>; onAdd: (html: string, name: string) => Promise<void> | void; busy?: boolean; actionLabel?: string; actionTitle?: string; dropHint?: boolean }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; html: string }>();
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const html = file?.html ?? (text.trim() ? extractHtml(text) ?? "" : "");
  const lint = useMemo(() => (html ? lintHtmlClip(html, { libs: CLIP_LIBRARIES, expectBindings, expectParams }) : undefined), [html, expectBindings, expectParams]);
  const blocked = !text.trim() && !file;
  const notFound = !file && !!text.trim() && !extractHtml(text);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    try { setFile({ name: f.name, html: await importHtmlPackage(f) }); setText(""); }
    catch (e) { setFile(undefined); setErr(e instanceof Error ? e.message : String(e)); }
  };
  const paste = async () => {
    setErr("");
    try { const t = await navigator.clipboard.readText(); setFile(undefined); setText(t); if (!t.trim()) setErr("The clipboard is empty."); }
    catch { setErr("Couldn't read the clipboard; long-press the box and paste instead."); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files?.[0]); };
  const add = async () => {
    if (!lint?.ok) return;
    await onAdd(html, file?.name.replace(/(\.dionysus-html)?\.(zip|html?)$/i, "") || lint.manifest.name || "clip");
    setText(""); setFile(undefined);
  };

  return (
    <div className={`v2-html-import ${drag ? "is-drag" : ""}`} data-testid="v2-html-import"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      {dropHint && !file && <div className="v2-html-dropzone" aria-hidden><b>Drop the .zip or .html here</b><span>or choose the file the AI gave you</span></div>}
      {file
        ? <div className="v2-html-import-file"><span>Loaded <b>{file.name}</b></span><button className="v2-btn" onClick={() => setFile(undefined)}>Clear</button></div>
        : <textarea aria-label="Paste the AI's reply or the HTML" placeholder={"Paste the AI's reply (the ```html block is picked out) or the HTML itself" + (finePointer() ? ", or drop a .html / .zip file here" : "")}
            spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={5} value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} />}
      <div className="v2-html-import-actions">
        {canPaste() && <button className="v2-btn" onClick={() => void paste()}>Paste</button>}
        <label className="v2-btn" title="Import a .html file or a .dionysus-html.zip package">Choose file…
          <input type="file" hidden accept={HTML_IMPORT_ACCEPT} aria-label="Import HTML clip file" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <button className="v2-btn is-primary" data-testid="v2-html-import-add" disabled={blocked || !lint?.ok || busy}
          title={lint && !lint.ok ? "Fix the errors first" : actionTitle} onClick={() => void add()}>{actionLabel}</button>
      </div>
      {err && <span role="alert" className="v2-err">{err}</span>}
      {notFound && <span role="alert" className="v2-err">No HTML found: paste the ```html code block or a whole HTML document.</span>}
      {lint && <ClipIssues issues={lint.issues} />}
      {lint?.ok && !lint.issues.length && <span className="v2-muted">Valid {lint.legacy ? "legacy clip" : `${lint.manifest.name ? `"${lint.manifest.name}" · ` : ""}${lint.manifest.durationSec ? `${lint.manifest.durationSec} s · ` : ""}${lint.manifest.width ?? "?"}×${lint.manifest.height ?? "?"}`}</span>}
    </div>
  );
}
