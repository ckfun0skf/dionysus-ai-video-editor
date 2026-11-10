import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HTML_CLIP_ASPECTS, HTML_CLIP_FORMAT, MAX_CLIP_SEC, PARAM_TYPES, lintHtmlClip, resolveHtmlParams, sizeForAspect, type HtmlClipIssue, type HtmlClipManifest, type HtmlClipParam, type HtmlParamValues, type ParamType, REF_TYPES, refType, type RefType, type HtmlClipInput } from "../domain";
import { CLIP_LIBRARIES, selectedLibraries } from "../render";
import {
  FONT_EXT, IMAGE_EXT, DEFAULT_FOR, fontFamily, freeKey, generateClip, generateRaw, paramRows, paramSnippet, parseClip, retype, rowsToParams, syntaxCheck, validateRows,
  type CodeClipModel, type ParamRow,
} from "./codeClip";
import { CODE_SAMPLES, type CodeSample } from "./codeSamples";
import { CodeReviseWizard } from "./CodeReviseWizard";
import { HtmlExportButtons } from "./HtmlImport";
import { CodeClipPreview } from "./CodeClipPreview";
import type { MixUnderlayFn } from "./codeClipMix";
import { Ic as Icon } from "./Icon";
import { LibraryPicker } from "./LibraryPicker";
import { Sheet } from "./Sheet";
import { fileMatchesAccept, useFileDrag } from "./fileDrop";

/** V2-111: what an HTML clip can attach (so iOS offers Photos/Files rather than a generic picker). */
export const ATTACH_ACCEPT = "image/*,video/*,audio/*,.svg,.json,.csv,.txt,.js,.mjs,.css,.glb,.gltf,.bin,.woff,.woff2,.ttf,.otf";
/** What the Files tab offers: images and fonts (anything else can still be attached from Advanced → Other files). */
export const CODE_FILE_ACCEPT = "image/*,.svg,.woff,.woff2,.ttf,.otf,.glb,.gltf,.bin,.hdr";
/** Files above this still embed, with a warning: they make the project and every export heavier. */
const WARN_FILE = 15 * 1024 * 1024;
const MAX_FILE = 60 * 1024 * 1024;
/** MIME for 3D files the browser reports as empty or octet-stream, so the clip's loaders see the right type. */
const MODEL_MIME: Record<string, string> = { glb: "model/gltf-binary", gltf: "model/gltf+json", bin: "application/octet-stream", hdr: "image/vnd.radiance" };
export const MODEL_EXT = /\.(glb|gltf|bin|hdr)$/i;
export function withModelMime(name: string, data: string): string {
  const m = MODEL_MIME[name.split(".").pop()!.toLowerCase()];
  return m ? data.replace(/^data:[^;,]*/, `data:${m}`) : data;
}

type Tab = "script" | "params" | "files" | "settings" | "advanced";
const TABS: { id: Tab; label: string }[] = [
  { id: "script", label: "Script" }, { id: "params", label: "Params" }, { id: "files", label: "Files" }, { id: "settings", label: "Settings" }, { id: "advanced", label: "Advanced" },
];
const TYPE_LABEL: Record<ParamType, string> = { number: "Number", color: "Colour", text: "Text", boolean: "Switch", select: "Choice" };

/** One problem shown under the code; `line` is a line of the Script (or raw HTML) the user can jump to. */
export interface EditorIssue { level: "error" | "warning"; message: string; source: "syntax" | "runtime" | "package"; line?: number; code?: string }

const readData = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
const dataBytes = (d: string) => Math.round((d.length - d.indexOf(",") - 1) * 0.75);
const fmtBytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
export const fileKey = (name: string) => name.replace(/[^\w.-]+/g, "-");

/** Embed picked or dropped files the same way as Files → Add files (type, size, name sanitise). */
export async function readAttachedFiles(list: ArrayLike<File>, current: Record<string, string>, accept = CODE_FILE_ACCEPT): Promise<{ next: Record<string, string>; notes: string[] }> {
  const next = { ...current };
  const notes: string[] = [];
  for (const f of Array.from(list)) {
    if (!fileMatchesAccept(f, accept)) { notes.push(`${f.name} isn't a supported type and wasn't added.`); continue; }
    if (f.size > MAX_FILE) { notes.push(`${f.name} is larger than 60 MB and wasn't added.`); continue; }
    if (f.size > WARN_FILE) notes.push(`${f.name} is ${fmtBytes(f.size)}: large files slow saving and export.`);
    try { next[fileKey(f.name)] = withModelMime(f.name, await readData(f)); }
    catch { notes.push(`Couldn't read ${f.name}.`); }
  }
  return { next, notes };
}

/** The manifest the editor starts from: libraries made explicit (legacy CDN tags count) and the format stamped. */
function startManifest(source: string, m: HtmlClipManifest): HtmlClipManifest {
  return { ...m, format: HTML_CLIP_FORMAT, libs: selectedLibraries(source).map((l) => l.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Code area

/** Replace [from, to) through the browser's editing (so native undo keeps working), falling back to a plain set. */
function editText(t: HTMLTextAreaElement, from: number, to: number, text: string, onChange: (v: string) => void, sel?: [number, number]) {
  t.focus();
  t.setSelectionRange(from, to);
  let ok = false;
  try { ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text); } catch { ok = false; }
  const [s, e] = sel ?? [from + text.length, from + text.length];
  if (ok) { t.setSelectionRange(s, e); return; }
  onChange(t.value.slice(0, from) + text + t.value.slice(to));
  requestAnimationFrame(() => t.setSelectionRange(s, e));
}

const TOUCH_KEYS = ["⇥", "{", "}", "(", ")", "[", "]", ";", "=", "\"", "'", "`", ".", ",", ":", "<", ">", "/", "+", "-", "*"];
const PAIRS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };

/**
 * Monospace code area with a line-number gutter: Tab / Shift+Tab indent and outdent (whole lines when several are
 * selected), Enter keeps the indent (and opens a block after "{"), "}" on an empty line outdents. On touch it is 16px
 * (so iOS doesn't zoom) with a key row for the symbols phone keyboards hide.
 */
export function CodeArea({ label, value, onChange, touch, errorLines, jump, minRows }: {
  label: string; value: string; onChange: (v: string) => void; touch: boolean; errorLines?: ReadonlySet<number>; jump?: { line: number; n: number }; minRows?: number;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  useEffect(() => {
    const t = area.current;
    if (!jump || !t) return;
    const starts = [0];
    for (let i = 0; i < t.value.length; i++) if (t.value[i] === "\n") starts.push(i + 1);
    const l = Math.min(Math.max(1, jump.line), starts.length);
    const end = l < starts.length ? starts[l] - 1 : t.value.length;
    t.focus();
    t.setSelectionRange(starts[l - 1], end);
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 20;
    t.scrollTop = Math.max(0, (l - 1) * lh - t.clientHeight / 3);
  }, [jump]);
  const indent = (t: HTMLTextAreaElement, out: boolean) => {
    const v = t.value, s = t.selectionStart, e = t.selectionEnd;
    if (!out && !v.slice(s, e).includes("\n")) { editText(t, s, e, "  ", onChange); return; }
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = e > s && v[e - 1] === "\n" ? e - 1 : e;
    const nl = v.indexOf("\n", le);
    le = nl < 0 ? v.length : nl;
    const block = v.slice(ls, le).split("\n").map((l) => out ? l.replace(/^ {1,2}|^\t/, "") : `  ${l}`).join("\n");
    editText(t, ls, le, block, onChange, [ls, ls + block.length]);
  };
  const insert = (k: string) => {
    const t = area.current;
    if (!t) return;
    if (k === "⇥") { indent(t, false); return; }
    editText(t, t.selectionStart, t.selectionEnd, k, onChange);
  };
  return (
    <div className="v2-ce-codewrap">
      {touch && (
        <div className="v2-ce-keys" role="toolbar" aria-label="Code keys">
          {TOUCH_KEYS.map((k) => (
            <button key={k} type="button" className="v2-ce-key" aria-label={k === "⇥" ? "Indent" : `Insert ${k}`}
              onPointerDown={(e) => e.preventDefault()} onClick={() => insert(k)}>{k}</button>
          ))}
        </div>
      )}
      <div className="v2-code v2-ce-code" style={minRows ? { minHeight: `${minRows * 1.5}em` } : undefined}>
        <div className="v2-code-gutter" ref={gutter} aria-hidden>
          {Array.from({ length: lines }, (_, i) => <div key={i} className={errorLines?.has(i + 1) ? "is-error" : undefined}>{i + 1}</div>)}
        </div>
        <textarea ref={area} aria-label={label} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" wrap="off" value={value}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          onKeyDown={(e) => {
            const t = e.currentTarget;
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); indent(t, e.shiftKey); return; }
            if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              const v = t.value, s = t.selectionStart, ls = v.lastIndexOf("\n", s - 1) + 1;
              const ind = /^[ \t]*/.exec(v.slice(ls, s))![0];
              const before = v.slice(ls, s).trimEnd().slice(-1), after = v[t.selectionEnd];
              e.preventDefault();
              if (PAIRS[before]) {
                const open = `\n${ind}  `;
                if (after === PAIRS[before]) editText(t, s, t.selectionEnd, `${open}\n${ind}`, onChange, [s + open.length, s + open.length]);
                else editText(t, s, t.selectionEnd, open, onChange);
              } else editText(t, s, t.selectionEnd, `\n${ind}`, onChange);
              return;
            }
            if (e.key === "}" && t.selectionStart === t.selectionEnd) {
              const v = t.value, s = t.selectionStart, ls = v.lastIndexOf("\n", s - 1) + 1;
              if (s - ls >= 2 && /^ +$/.test(v.slice(ls, s))) { e.preventDefault(); editText(t, s - 2, s, "}", onChange); }
            }
          }}
          onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Preview (shared with the storyboard via CodeClipPreview)

export { previewDoc, scriptLineOf, HtmlLivePreview, CodeClipPreview } from "./CodeClipPreview";

// ---------------------------------------------------------------------------------------------------------------
// Small inputs

/** A number field that keeps what's typed ("-", "0.") until it parses; empty → undefined when optional. */
function NumField({ label, value, onChange, optional, min, max, step }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean; min?: number; max?: number; step?: number }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => { setDraft((d) => (d.trim() === "" ? undefined : Number(d)) === value ? d : value === undefined ? "" : String(value)); }, [value]);
  return (
    <label className="v2-ce-field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" value={draft} min={min} max={max} step={step ?? "any"} placeholder={optional ? "—" : undefined}
        onChange={(e) => {
          const s = e.target.value;
          setDraft(s);
          if (s.trim() === "") { if (optional) onChange(undefined); return; }
          const n = Number(s);
          if (Number.isFinite(n)) onChange(n);
        }} />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <label className="v2-ce-field v2-ce-colorfield">
      <span>{label}</span>
      <span className="v2-ce-color">
        <input type="color" aria-label={`${label} picker`} value={hex} onChange={(e) => onChange(e.target.value)} />
        <input type="text" aria-label={label} value={value} spellCheck={false} autoCapitalize="off" onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="v2-ce-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="v2-btn v2-ce-copy" aria-label={`Copy ${text}`} title="Copy"
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }, () => undefined); }}>
      <Icon g={done ? "✓" : "⎘"} />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Params tab

function DefaultField({ p, onChange }: { p: HtmlClipParam; onChange: (p: HtmlClipParam) => void }) {
  const set = (v: HtmlClipParam["default"]) => onChange({ ...p, default: v });
  switch (p.type) {
    case "number": return <NumField label="Default" value={typeof p.default === "number" ? p.default : undefined} min={p.min} max={p.max} step={p.step} onChange={(v) => set(v ?? 0)} />;
    case "color": return <ColorField label="Default" value={String(p.default)} onChange={set} />;
    case "boolean": return <Switch label="Default on" checked={p.default === true} onChange={set} />;
    case "select": return (
      <label className="v2-ce-field"><span>Default</span>
        <select value={String(p.default)} onChange={(e) => set(e.target.value)}>
          {!(p.options ?? []).includes(String(p.default)) && <option value={String(p.default)}>{String(p.default) || "(none)"}</option>}
          {(p.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
    default: return <label className="v2-ce-field"><span>Default</span><input type="text" value={String(p.default)} onChange={(e) => set(e.target.value)} /></label>;
  }
}

/** Options for a Choice param, one per line (kept as typed; trimmed and de-duplicated in the manifest). */
function OptionsField({ p, onChange }: { p: HtmlClipParam; onChange: (p: HtmlClipParam) => void }) {
  const [draft, setDraft] = useState((p.options ?? []).join("\n"));
  return (
    <label className="v2-ce-field v2-ce-wide">
      <span>Options (one per line)</span>
      <textarea rows={3} value={draft} spellCheck={false} autoCapitalize="off" onChange={(e) => {
        setDraft(e.target.value);
        const options = [...new Set(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))];
        onChange({ ...p, options, default: options.includes(String(p.default)) ? p.default : options[0] ?? "" });
      }} />
    </label>
  );
}

function ParamCard({ row, index, count, issues, open, onToggle, onChange, onMove, onRemove }: {
  row: ParamRow; index: number; count: number; issues: readonly HtmlClipIssue[]; open: boolean; onToggle: () => void;
  onChange: (r: ParamRow) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const p = row.param;
  const set = (param: HtmlClipParam) => onChange({ ...row, param });
  const summary = p.type === "boolean" ? (p.default ? "on" : "off") : String(p.default);
  return (
    <li className={`v2-ce-param ${issues.length ? "has-error" : ""} ${open ? "is-open" : ""}`}>
      <div className="v2-ce-paramhead">
        <button type="button" className="v2-ce-paramtoggle" aria-expanded={open} onClick={onToggle} aria-label={`${row.key || "(no key)"} — ${TYPE_LABEL[p.type]}, ${open ? "collapse" : "edit"}`}>
          <code>{row.key || "(no key)"}</code>
          <span className="v2-ce-chip">{TYPE_LABEL[p.type]}</span>
          {p.type === "color" && <span className="v2-ce-swatch" style={{ background: String(p.default) }} />}
          <span className="v2-ce-paramval">{summary}</span>
        </button>
        <button type="button" className="v2-btn v2-ce-icon" aria-label={`Move ${row.key} up`} disabled={index === 0} onClick={() => onMove(-1)}><Icon g="↑" /></button>
        <button type="button" className="v2-btn v2-ce-icon" aria-label={`Move ${row.key} down`} disabled={index === count - 1} onClick={() => onMove(1)}><Icon g="↓" /></button>
        <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove ${row.key}`} onClick={onRemove}><Icon g="🗑" /></button>
      </div>
      {issues.length > 0 && <ul className="v2-ce-rowissues">{issues.map((i, n) => <li key={n} role="alert">{i.message}</li>)}</ul>}
      {open && (
        <div className="v2-ce-paramgrid">
          <label className="v2-ce-field"><span>Key</span>
            <input type="text" value={row.key} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => onChange({ ...row, key: e.target.value.trim() })} />
          </label>
          <label className="v2-ce-field"><span>Label</span>
            <input type="text" value={p.label ?? ""} placeholder={row.key} onChange={(e) => set({ ...p, label: e.target.value || undefined })} />
          </label>
          <label className="v2-ce-field"><span>Type</span>
            <select value={p.type} onChange={(e) => set(retype(p, e.target.value as ParamType))}>
              {PARAM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <DefaultField p={p} onChange={set} />
          {p.type === "number" && <>
            <NumField label="Min" optional value={p.min} onChange={(v) => set({ ...p, min: v })} />
            <NumField label="Max" optional value={p.max} onChange={(v) => set({ ...p, max: v })} />
            <NumField label="Step" optional value={p.step} onChange={(v) => set({ ...p, step: v })} />
          </>}
          {p.type === "select" && <OptionsField key={row.id + p.type} p={p} onChange={set} />}
          <div className="v2-ce-snippet v2-ce-wide"><span className="v2-muted">In the script</span><code>{paramSnippet(row.key || "key")}</code><Copy text={paramSnippet(row.key || "key")} /></div>
        </div>
      )}
    </li>
  );
}

const REF_LABEL: Record<RefType, string> = { graphic: "Graphic", audio: "Audio", tracker: "Tracker" };
const REF_HINT: Record<RefType, string> = { graphic: "luma, avgColor, motion, histogram", audio: "rms, peak, bands, onset, envelope", tracker: "x, y, width, height, scale, rotation, found" };
const REF_KEY: Record<RefType, string> = { graphic: "picture", audio: "sound", tracker: "target" };

/**
 * P43: references (manifest `inputs`) — Graphic, Audio and Tracker. Each use picks what it reads in the clip's
 * Params → Inputs (only valid targets are listed); the script reads ctx.inputs.<name>.
 */
function RefsSection({ inputs, setInputs, taken }: { inputs: Record<string, HtmlClipInput>; setInputs: (i: Record<string, HtmlClipInput> | undefined) => void; taken: string[] }) {
  const names = Object.keys(inputs);
  const add = (t: RefType) => {
    let k = REF_KEY[t], n = 2;
    while (names.includes(k) || taken.includes(k)) k = `${REF_KEY[t]}${n++}`;
    setInputs({ ...inputs, [k]: { type: t } });
  };
  const rename = (from: string, to: string) => {
    if (!to || to === from || names.includes(to)) return;
    setInputs(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k === from ? to : k, v])));
  };
  const remove = (k: string) => { const next = { ...inputs }; delete next[k]; setInputs(Object.keys(next).length ? next : undefined); };
  return (
    <section className="v2-ce-refs" aria-label="References">
      <h4 className="v2-ce-refs-head">References</h4>
      <p className="v2-ce-hint">A reference reads part of the edit each frame — a picture, a sound or a tracker. Where it reads from is picked where the clip is used (Params → Inputs). The script gets numbers only: <code>ctx.inputs.&lt;name&gt;</code>.</p>
      {names.length > 0 && <ul className="v2-ce-params">{names.map((k) => {
        const t = refType(inputs[k].type);
        return (
          <li key={k} className="v2-ce-param v2-ce-ref">
            <div className="v2-ce-paramhead">
              <input className="v2-ce-refname" aria-label={`Name of ${REF_LABEL[t]} reference ${k}`} defaultValue={k} spellCheck={false} autoCapitalize="off" autoCorrect="off"
                onBlur={(e) => rename(k, e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              <span className="v2-ce-chip"><Icon g={t === "graphic" ? "eye" : t === "audio" ? "♫" : "track"} /> {REF_LABEL[t]}</span>
              <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove ${k}`} onClick={() => remove(k)}><Icon g="🗑" /></button>
            </div>
            <div className="v2-ce-snippet"><code>{`ctx.inputs.${k} // ${REF_HINT[t]}`}</code><Copy text={`ctx.inputs.${k}`} /></div>
          </li>
        );
      })}</ul>}
      <div className="v2-ce-addparam" role="group" aria-label="Add reference">
        {REF_TYPES.map((t) => <button key={t} type="button" className="v2-btn" onClick={() => add(t)}><Icon g="+" /> {REF_LABEL[t]}</button>)}
      </div>
    </section>
  );
}

function ParamsTab({ rows, setRows, issues, inputs, setInputs }: { rows: ParamRow[]; setRows: (r: ParamRow[]) => void; issues: Map<string, HtmlClipIssue[]>; inputs: Record<string, HtmlClipInput>; setInputs: (i: Record<string, HtmlClipInput> | undefined) => void }) {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const add = (type: ParamType) => {
    const key = freeKey(rows, type === "color" ? "color" : type === "text" ? "title" : type === "boolean" ? "enabled" : type === "select" ? "style" : "amount");
    const row: ParamRow = { id: `n${Date.now()}${rows.length}`, key, param: { ...DEFAULT_FOR[type], options: DEFAULT_FOR[type].options && [...DEFAULT_FOR[type].options!] } };
    setRows([...rows, row]);
    setOpen(row.id);
  };
  return (
    <div className="v2-ce-panel" data-testid="v2-ce-params">
      <p className="v2-ce-hint">Params are values that can change each time the clip is used (Params panel). Read them in the script as <code>ctx.params.&lt;key&gt;</code>; the preview uses the defaults.</p>
      {rows.length === 0 && <p className="v2-muted v2-ce-empty">No params yet.</p>}
      <ul className="v2-ce-params">
        {rows.map((r, i) => (
          <ParamCard key={r.id} row={r} index={i} count={rows.length} issues={issues.get(r.id) ?? []} open={open === r.id}
            onToggle={() => setOpen(open === r.id ? undefined : r.id)}
            onChange={(n) => setRows(rows.map((x) => (x.id === r.id ? n : x)))}
            onMove={(d) => { const next = [...rows]; [next[i], next[i + d]] = [next[i + d], next[i]]; setRows(next); }}
            onRemove={() => setRows(rows.filter((x) => x.id !== r.id))} />
        ))}
      </ul>
      <div className="v2-ce-addparam" role="group" aria-label="Add param">
        {PARAM_TYPES.map((t) => <button key={t} type="button" className="v2-btn" onClick={() => add(t)}><Icon g="+" /> {TYPE_LABEL[t]}</button>)}
      </div>
      <RefsSection inputs={inputs} setInputs={setInputs} taken={rows.map((r) => r.key)} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Files tab

function FilesTab({ files, onChange, msg, onAttach, drag }: {
  files: Record<string, string>;
  onChange: (f: Record<string, string> | undefined) => void;
  msg: string;
  onAttach: (list: FileList | null) => void;
  drag?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const names = Object.keys(files);
  const remove = (n: string) => { const next = { ...files }; delete next[n]; onChange(Object.keys(next).length ? next : undefined); };
  return (
    <div className={`v2-ce-panel${drag ? " is-drag" : ""}`} data-testid="v2-ce-files">
      <p className="v2-ce-hint">Fonts, images and 3D models are embedded in the clip. Fonts get an <code>@font-face</code> rule automatically; images load with <code>await ctx.image("name")</code>; a <code>.glb</code> loads with three.js GLTFLoader from <code>ctx.asset("name")</code>.</p>
      <div className="v2-ce-dropzone" data-testid="v2-ce-dropzone">
        <b>Drop files here</b>
        <span>Fonts, images and 3D models — or choose them</span>
        <input ref={input} type="file" multiple hidden accept={CODE_FILE_ACCEPT} aria-label="Add files" onChange={(e) => { onAttach(e.target.files); e.target.value = ""; }} />
        <button type="button" className="v2-btn primary v2-ce-addfile" onClick={() => input.current?.click()}><Icon g="⇪" /> Add files</button>
      </div>
      {msg && <p className="v2-ce-error" role="alert">{msg}</p>}
      {names.length === 0 && <p className="v2-muted v2-ce-empty">No files yet.</p>}
      <ul className="v2-ce-files">
        {names.map((n) => {
          const model = MODEL_EXT.test(n), font = FONT_EXT.test(n), image = !model && (IMAGE_EXT.test(n) || files[n].startsWith("data:image/"));
          const snippet = font ? `await document.fonts.load('48px "${fontFamily(n)}"'); g.font = '48px "${fontFamily(n)}"';` : image ? `const img = await ctx.image(${JSON.stringify(n)});` : model && /\.(glb|gltf)$/i.test(n) ? `const gltf = await new GLTFLoader().loadAsync(ctx.asset(${JSON.stringify(n)}));` : `await ctx.asset(${JSON.stringify(n)})`;
          return (
            <li key={n} className="v2-ce-file">
              <span className="v2-ce-thumb" aria-hidden>{image ? <img src={files[n]} alt="" /> : font ? "Aa" : model ? "3D" : "…"}</span>
              <span className="v2-ce-fileinfo">
                <b>{n}</b>
                <span className="v2-muted">{font ? `Font "${fontFamily(n)}"` : image ? "Image" : model ? "3D file" : "File"} · {fmtBytes(dataBytes(files[n]))}</span>
                <code>{snippet}</code>
              </span>
              <Copy text={snippet} />
              <button type="button" className="v2-btn v2-ce-icon" aria-label={`Remove ${n}`} onClick={() => remove(n)}><Icon g="🗑" /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Settings tab

function SettingsTab({ m, set, mobile, html }: { m: HtmlClipManifest; set: (m: HtmlClipManifest) => void; mobile: boolean; html: () => string }) {
  const aspect = HTML_CLIP_ASPECTS.includes((m.aspect ?? "") as (typeof HTML_CLIP_ASPECTS)[number]) ? m.aspect! : "custom";
  const transparent = !m.background || m.background === "transparent";
  return (
    <div className="v2-ce-panel v2-ce-settings" data-testid="v2-ce-settings">
      <label className="v2-ce-field v2-ce-wide"><span>Name</span><input type="text" value={m.name ?? ""} placeholder="Code clip" onChange={(e) => set({ ...m, name: e.target.value || undefined })} /></label>
      <label className="v2-ce-field v2-ce-wide"><span>Description</span><input type="text" value={m.description ?? ""} placeholder="What the clip shows (optional)" onChange={(e) => set({ ...m, description: e.target.value || undefined })} /></label>
      <fieldset className="v2-ce-field v2-ce-wide">
        <legend>Use as</legend>
        <div className="v2-ce-seg" role="radiogroup" aria-label="Use as">
          {(["clip", "effect", "transition"] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={(m.role ?? "clip") === r} className={`v2-btn ${(m.role ?? "clip") === r ? "is-active" : ""}`}
              title={r === "clip" ? "A clip on a video track" : r === "effect" ? "An effect: draws ctx.source, the picture under the effect clip" : "A transition: draws ctx.from and ctx.to over ctx.progress"}
              onClick={() => set(r === "clip" ? { ...m, role: undefined } : { ...m, role: r })}>{r === "clip" ? "Clip" : r === "effect" ? "Effect" : "Transition"}</button>
          ))}
        </div>
      </fieldset>
      <NumField label="Duration (s)" value={m.durationSec} min={0.1} max={MAX_CLIP_SEC} step={0.5} onChange={(v) => set({ ...m, durationSec: v })} />
      <fieldset className="v2-ce-field v2-ce-wide">
        <legend>Size</legend>
        <div className="v2-ce-seg" role="radiogroup" aria-label="Aspect ratio">
          {[...HTML_CLIP_ASPECTS, "custom"].map((a) => (
            <button key={a} type="button" role="radio" aria-checked={aspect === a} className={`v2-btn ${aspect === a ? "is-active" : ""}`}
              onClick={() => set(a === "custom" ? { ...m, aspect: undefined } : { ...m, aspect: a, ...sizeForAspect(a) })}>{a === "custom" ? "Custom" : a}</button>
          ))}
        </div>
      </fieldset>
      <NumField label="Width (px)" value={m.width} min={16} max={8192} step={1} onChange={(v) => set({ ...m, width: v, aspect: undefined })} />
      <NumField label="Height (px)" value={m.height} min={16} max={8192} step={1} onChange={(v) => set({ ...m, height: v, aspect: undefined })} />
      <div className="v2-ce-field v2-ce-wide">
        <span>Background</span>
        <div className="v2-ce-bgrow">
          <Switch label="Transparent" checked={transparent} onChange={(v) => set({ ...m, background: v ? "transparent" : "#000000" })} />
          {!transparent && <ColorField label="Colour" value={m.background ?? "#000000"} onChange={(v) => set({ ...m, background: v })} />}
        </div>
      </div>
      <div className="v2-ce-field v2-ce-wide">
        <span>Libraries</span>
        <LibraryPicker value={m.libs ?? []} onChange={(libs) => set({ ...m, libs })} mobile={mobile} />
        <span className="v2-muted">Import a library by its name, e.g. <code>import * as THREE from "three";</code></span>
      </div>
      <div className="v2-ce-field v2-ce-wide">
        <span>Export</span>
        <span className="v2-ce-export"><HtmlExportButtons html={html} name={m.name || "clip"} /></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dialog pieces

export function Confirm({ title, body, ok, onOk, onCancel }: { title: string; body: string; ok: string; onOk: () => void; onCancel: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { okRef.current?.focus(); }, []);
  return (
    <div className="v2-ce-confirmback" onClick={onCancel}>
      <div className="v2-ce-confirm" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
        <b>{title}</b>
        <p>{body}</p>
        <div className="v2-ce-confirmbar">
          <button type="button" className="v2-btn" onClick={onCancel}>Cancel</button>
          <button type="button" ref={okRef} className="v2-btn danger" onClick={onOk}>{ok}</button>
        </div>
      </div>
    </div>
  );
}

function SampleList({ onPick }: { onPick: (s: CodeSample) => void }) {
  return (
    <ul className="v2-ce-samples" aria-label="Samples">
      {CODE_SAMPLES.map((s) => (
        <li key={s.id}>
          <button type="button" className="v2-ce-sample" onClick={() => onPick(s)}>
            <span className="v2-ce-sampleicon" aria-hidden><Icon g={s.id === "three" ? "layers" : "</>"} /></span>
            <span><b>{s.name}</b><span className="v2-muted">{s.description}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function IssueList({ issues, onJump }: { issues: readonly EditorIssue[]; onJump: (line: number) => void }) {
  const errors = issues.filter((i) => i.level === "error").length, warnings = issues.length - errors;
  const [open, setOpen] = useState(true);
  if (!issues.length) return <div className="v2-ce-issues is-ok" data-testid="v2-code-issues"><Icon g="ok" /> No problems</div>;
  return (
    <div className="v2-ce-issues" data-testid="v2-code-issues">
      <button type="button" className="v2-ce-issuesum" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon g={errors ? "alert" : "⚠"} />
        {errors ? `${errors} error${errors > 1 ? "s" : ""}` : ""}{errors && warnings ? " · " : ""}{warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : ""}
      </button>
      {open && (
        <ul>
          {issues.map((i, n) => (
            <li key={n} className={i.level === "error" ? "is-error" : "is-warning"} role={i.level === "error" ? "alert" : undefined}>
              {i.line
                ? <button type="button" className="v2-ce-issueline" onClick={() => onJump(i.line!)} aria-label={`Go to line ${i.line}`}>Line {i.line}</button>
                : <span className="v2-ce-issuetag">{i.source === "package" ? "Clip" : i.source === "runtime" ? "Preview" : "Script"}</span>}
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The editor

interface Draft { manifest: HtmlClipManifest; rows: ParamRow[]; script: string; css: string; markup: string; raw?: string; rawNote?: string }

function draftOf(source: string): Draft {
  const p = parseClip(source);
  if (p.kind === "raw") return { manifest: startManifest(source, p.manifest), rows: paramRows(p.manifest.params), script: "", css: "", markup: "", raw: p.html, rawNote: p.reason };
  const { manifest, script, css, markup } = p.model;
  return { manifest: startManifest(source, manifest), rows: paramRows(manifest.params), script, css, markup };
}

function draftFromModel(m: CodeClipModel): Draft {
  return { manifest: { ...m.manifest, format: HTML_CLIP_FORMAT }, rows: paramRows(m.manifest.params), script: m.script, css: m.css, markup: m.markup };
}

function htmlOf(d: Draft): string {
  const manifest = { ...d.manifest, params: rowsToParams(d.rows) };
  return d.raw !== undefined ? generateRaw(d.raw, manifest) : generateClip({ manifest, script: d.script, css: d.css, markup: d.markup });
}

/**
 * V2-CODE-EDITOR: the JS-first Code Editor. A clip is a script that draws on the page's canvas
 * (`dionysus.clip({ init, render })`) plus its params, files and settings; the editor writes the one-file
 * `dionysus.htmlclip/1` package and reads back files of the shape it writes (others open as raw HTML in Advanced).
 * Mobile: preview on top, tabs below, full screen. Desktop: tabs on the left, preview and problems on the right.
 * Save creates a new asset version (one undo step); Cancel discards (asking first when there are edits).
 * Revise with AI (an existing clip) uses the same wizard shell as Create code → AI mode: the open package
 * stays put until a reply is imported, and Save then makes the new version.
 */
export function CodeEditor({ source, mobile, onSave, onClose, create, onAiMode, previewParams, mixUnderlay, mixPlacement }: {
  source: string; mobile: boolean; onSave: (html: string) => void; onClose: () => void;
  /** P4B: open the AI-mode wizard (Create code only). */ onAiMode?: () => void;
  /** A new clip (Add Media → Code → Create): the primary action adds it to the timeline. */ create?: boolean;
  /** Per-use overrides (placement.htmlParams or a shot's params) applied live on top of the draft defaults. */
  previewParams?: HtmlParamValues;
  mixUnderlay?: MixUnderlayFn;
  mixPlacement?: import("../domain").Placement;
}) {
  const start = useMemo(() => draftOf(source), [source]);
  const [d, setD] = useState<Draft>(start);
  const [tab, setTab] = useState<Tab>(start.raw !== undefined ? "advanced" : "script");
  const [samples, setSamples] = useState(false);
  const [revise, setRevise] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; ok: string; run: () => void } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [runtimeError, setRuntimeError] = useState<{ message: string; line?: number } | null>(null);
  const [jump, setJump] = useState<{ line: number; n: number } | undefined>(undefined);
  const touch = mobile || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

  const html = useMemo(() => htmlOf(d), [d]);
  const baseline = useMemo(() => htmlOf(start), [start]);
  const dirty = html !== baseline;
  const [live, setLive] = useState(html);
  useEffect(() => { const id = setTimeout(() => setLive(html), 400); return () => clearTimeout(id); }, [html]);
  const [liveScript, setLiveScript] = useState(d.script);
  useEffect(() => { const id = setTimeout(() => setLiveScript(d.script), 400); return () => clearTimeout(id); }, [d.script]);

  const rowIssues = useMemo(() => validateRows(d.rows), [d.rows]);
  const lint = useMemo(() => lintHtmlClip(live, { libs: CLIP_LIBRARIES }), [live]);
  const syntax = useMemo(() => (d.raw === undefined ? syntaxCheck(liveScript) : undefined), [liveScript, d.raw]);
  const issues = useMemo<EditorIssue[]>(() => {
    const out: EditorIssue[] = [];
    if (syntax) out.push({ level: "error", source: "syntax", message: `Syntax: ${syntax.message}`, line: syntax.line });
    if (runtimeError && !(syntax && runtimeError.message.includes(syntax.message))) out.push({ level: "error", source: "runtime", message: runtimeError.message, line: d.raw === undefined ? runtimeError.line : undefined });
    // Param problems are shown on their rows; the package lint repeats them, so skip param-* codes here.
    for (const i of lint.issues) if (!i.code.startsWith("param")) out.push({ level: i.level, source: "package", message: i.message, code: i.code });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  }, [syntax, runtimeError, lint, d.raw]);
  const errorLines = useMemo(() => new Set(issues.filter((i) => i.line && i.level === "error").map((i) => i.line!)), [issues]);
  const paramErrors = [...rowIssues.values()].flat().filter((i) => i.level === "error").length;
  const blocked = paramErrors > 0;
  const canSave = (create || dirty) && !blocked;

  const onPreviewError = useCallback((e: { message: string; line?: number } | null) => setRuntimeError((prev) => (e === null ? null : prev ?? e)), []);
  const setManifest = (manifest: HtmlClipManifest) => setD((x) => ({ ...x, manifest }));
  const [fileMsg, setFileMsg] = useState("");
  const filesRef = useRef<Record<string, string>>({});
  filesRef.current = d.manifest.files ?? {};
  const attachFiles = useCallback((list: FileList | null) => {
    void (async () => {
      const { next, notes } = await readAttachedFiles(list ?? [], filesRef.current);
      filesRef.current = next;
      setD((x) => ({ ...x, manifest: { ...x.manifest, files: Object.keys(next).length ? next : undefined } }));
      setFileMsg(notes.join(" "));
      setTab("files");
    })();
  }, []);
  const fileDrop = useFileDrag((files) => attachFiles(files));
  const fileDrag = fileDrop.over;
  const ask = (title: string, body: string, ok: string, run: () => void) => (dirty ? setConfirm({ title, body, ok, run }) : run());
  const loadSample = (s: CodeSample) => {
    setSamples(false);
    ask(`Load "${s.name}"?`, "This replaces the script, params, files and settings you're editing. You can still Cancel the editor afterwards to keep the saved clip.", "Replace", () => { setD(draftFromModel(s.model())); setTab("script"); });
  };
  const save = () => { if (canSave && !revise) onSave(html); };
  const close = () => ask("Discard your changes?", "Your edits to this clip will be lost.", "Discard", onClose);
  const goLine = (line: number) => { setTab(d.raw !== undefined ? "advanced" : "script"); setJump({ line, n: Date.now() }); };
  const toRaw = () => setConfirm({
    title: "Edit the full HTML?", ok: "Switch to HTML",
    body: "The clip becomes one HTML page you edit by hand. The Script tab and generated @font-face rules stop applying; params, files and settings still work.",
    run: () => setD((x) => ({ ...x, raw: generateRaw(htmlOf(x), {}).replace(/^\s*<script\s+type="application\/json"[^>]*>[\s\S]*?<\/script>\s*/i, ""), rawNote: "Edited as full HTML." })),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const m = d.manifest;
  const previewValues = useMemo(() => resolveHtmlParams(rowsToParams(d.rows), previewParams), [d.rows, previewParams]);
  const duration = m.durationSec && m.durationSec > 0 ? m.durationSec : 5;
  const transparent = !m.background || m.background === "transparent";
  const fileCount = Object.keys(m.files ?? {}).length;
  const badge = (t: Tab) => t === "params" ? (d.rows.length + Object.keys(d.manifest.inputs ?? {}).length || "") : t === "files" ? (fileCount || "") : "";
  const tabError = (t: Tab) => (t === "params" && paramErrors > 0) || (t === (d.raw !== undefined ? "advanced" : "script") && errorLines.size > 0);

  const panel: ReactNode = (() => {
    switch (tab) {
      case "script":
        if (d.raw !== undefined) return (
          <div className="v2-ce-panel">
            <div className="v2-ce-note" role="note"><b>This clip is edited as HTML.</b><span>{d.rawNote}</span></div>
            <p className="v2-ce-hint">Open <b>Advanced</b> to edit its page, or load a sample to start a script clip.</p>
            <span className="v2-ce-rowbtns">
              <button type="button" className="v2-btn" onClick={() => setTab("advanced")}>Open Advanced</button>
              <button type="button" className="v2-btn" onClick={() => setSamples(true)}>Load sample…</button>
            </span>
          </div>
        );
        return (
          <div className="v2-ce-panel v2-ce-scriptpanel">
            <p className="v2-ce-hint">JavaScript module. The page has one canvas (<code>ctx.canvas</code>). Draw each frame in <code>render(t, ctx)</code> from <code>t</code> and <code>ctx.params</code>.</p>
            <CodeArea label="Script" value={d.script} onChange={(script) => setD((x) => ({ ...x, script }))} touch={touch} errorLines={errorLines} jump={jump} />
          </div>
        );
      case "params": return <ParamsTab rows={d.rows} setRows={(rows) => setD((x) => ({ ...x, rows }))} issues={rowIssues}
        inputs={d.manifest.inputs ?? {}} setInputs={(inputs) => setD((x) => ({ ...x, manifest: { ...x.manifest, inputs } }))} />;
      case "files": return <FilesTab files={m.files ?? {}} onChange={(files) => setManifest({ ...m, files })} msg={fileMsg} onAttach={attachFiles} drag={fileDrag} />;
      case "settings": return <SettingsTab m={m} set={setManifest} mobile={mobile} html={() => html} />;
      case "advanced":
        if (d.raw !== undefined) return (
          <div className="v2-ce-panel v2-ce-scriptpanel">
            <div className="v2-ce-note" role="note"><b>Full HTML</b><span>{d.rawNote} Only what the page draws is captured; params, files and settings are still edited in their tabs.</span></div>
            <CodeArea label="HTML" value={d.raw} onChange={(raw) => setD((x) => ({ ...x, raw }))} touch={touch} errorLines={errorLines} jump={jump} />
          </div>
        );
        return (
          <div className="v2-ce-panel">
            <p className="v2-ce-hint">Rarely needed: only the canvas is captured. Use extra CSS for things like font tweaks, and extra markup for elements the script reads (they never appear in the video).</p>
            <span className="v2-ce-label">Extra CSS</span>
            <CodeArea label="Extra CSS" value={d.css} onChange={(css) => setD((x) => ({ ...x, css }))} touch={touch} minRows={4} />
            <span className="v2-ce-label">Extra markup (after the canvas)</span>
            <CodeArea label="Extra markup" value={d.markup} onChange={(markup) => setD((x) => ({ ...x, markup }))} touch={touch} minRows={3} />
            <button type="button" className="v2-btn v2-ce-toraw" onClick={toRaw}>Edit the full HTML instead…</button>
          </div>
        );
    }
  })();

  const preview = (
    <section className="v2-ce-side" aria-label="Preview">
      <CodeClipPreview html={live} duration={duration} width={m.width || 1920} height={m.height || 1080} transparent={transparent} background={m.background}
        collapsed={mobile && !previewOpen} onError={onPreviewError}
        params={previewValues} mixUnderlay={mixUnderlay} mixPlacement={mixPlacement}
        onToggle={mobile ? () => setPreviewOpen((o) => !o) : undefined} />
      {!mobile && <IssueList issues={issues} onJump={goLine} />}
    </section>
  );

  if (revise && !create) return (
    <CodeReviseWizard mobile={mobile} html={html} onClose={() => setRevise(false)} onImport={(next) => {
      const draft = draftOf(next);
      setD(draft);
      setTab(draft.raw !== undefined ? "advanced" : "script");
      setRuntimeError(null);
      setJump(undefined);
      setRevise(false);
    }} />
  );

  return (
    <div className={`v2-code-editor v2-ce ${mobile ? "is-mobile" : ""} ${fileDrag ? "is-drag" : ""} ${tab === "files" ? "is-files" : ""}`} role="dialog" aria-modal="true" aria-label="Code editor" {...fileDrop.handlers}>
      {!mobile && fileDrag && tab !== "files" && <div className="v2-ce-dropveil" data-testid="v2-ce-dropveil" aria-hidden><b>Drop to add files</b><span>Fonts, images and 3D models</span></div>}
      <header className="v2-ce-bar">
        {mobile && <button type="button" className="v2-btn v2-ce-icon" aria-label="Cancel" title="Cancel" onClick={close}><Icon g="✕" /></button>}
        <span className="v2-ce-title">
          <b>{m.name || "Code clip"}</b>
          <span className="v2-muted">{create ? "New code clip" : dirty ? "Edited — save makes a new version" : "Code clip"}</span>
        </span>
        {onAiMode && <button type="button" className="v2-btn v2-ce-samplesbtn v2-ce-aibtn" aria-label="AI mode" title="AI mode: answer a few questions, get a prompt for any AI, import its package" onClick={onAiMode}><Icon g="anim" /><span>AI mode</span></button>}
        {!create && <button type="button" className="v2-btn v2-ce-samplesbtn v2-ce-revisebtn" aria-label="Revise with AI" title="Revise with AI: describe a change, copy a prompt for any AI, import its package" onClick={() => { setSamples(false); setRevise(true); }}><Icon g="anim" /><span>Revise with AI</span></button>}
        <button type="button" className="v2-btn v2-ce-samplesbtn" aria-label="Samples" title="Load a sample" aria-haspopup="dialog" aria-expanded={samples} onClick={() => setSamples(!samples)}>
          <Icon g="template" /><span>Samples</span>
        </button>
        {!mobile && <button type="button" className="v2-btn" onClick={close}>Cancel</button>}
        {create
          ? <button type="button" className="v2-btn primary" disabled={!canSave} title={blocked ? "Fix the params first" : "Add this clip to the timeline at the playhead (undoable)"} onClick={save}>Add to timeline</button>
          : <button type="button" className="v2-btn primary" disabled={!canSave} title={blocked ? "Fix the params first" : dirty ? "Save as a new version of this clip (undoable)" : "No changes"} onClick={save}>Save</button>}
        {samples && !mobile && (
          <div className="v2-ce-popover" role="dialog" aria-label="Load sample">
            <SampleList onPick={loadSample} />
          </div>
        )}
      </header>
      <div className="v2-ce-main">
        {mobile && preview}
        <section className="v2-ce-work">
          <div role="tablist" aria-label="Editor tabs" className="v2-ce-tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`v2-ce-tab ${tab === t.id ? "is-active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}{badge(t.id) !== "" && <span className="v2-ce-badge">{badge(t.id)}</span>}{tabError(t.id) && <span className="v2-ce-dot" aria-label="has errors" />}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="v2-ce-body" aria-label={TABS.find((t) => t.id === tab)!.label}>{panel}</div>
          {mobile && <IssueList issues={issues} onJump={goLine} />}
        </section>
        {!mobile && preview}
      </div>
      {samples && mobile && (
        <Sheet label="Load sample" onClose={() => setSamples(false)} snaps={[0.45, 0.7]} initial={0}>
          <SampleList onPick={loadSample} />
        </Sheet>
      )}
      {confirm && <Confirm title={confirm.title} body={confirm.body} ok={confirm.ok} onCancel={() => setConfirm(null)} onOk={() => { const r = confirm.run; setConfirm(null); r(); }} />}
    </div>
  );
}
