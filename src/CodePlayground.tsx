import { useMemo, useState } from "react";
import { Play, RotateCcw } from "lucide-react";

export type CodePlaygroundSource = { html: string; css: string; js: string };
type Props = CodePlaygroundSource & {
  onChange: (patch: Partial<CodePlaygroundSource>) => void;
  title?: string;
};

const modes = ["html", "css", "js"] as const;
type Mode = typeof modes[number];

function highlight(source: string, mode: Mode) {
  const pattern = mode === "html"
    ? /(<!--[\s\S]*?-->|<\/?[\w-]+|\/?\s*>|\b[a-zA-Z-]+(?==)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g
    : mode === "css"
      ? /(\/\*[\s\S]*?\*\/|#[\w-]+|\.[\w-]+|\b(?:color|background|display|position|width|height|margin|padding|border|transform|animation|font-size|opacity|flex|grid|align-items|justify-content)\b|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}|\b\d+(?:\.\d+)?(?:px|rem|vh|vw|%)?\b)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|if|else|new|class|extends|import|from|export|async|await|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    const token = match[0];
    const kind = mode === "html" ? (token.startsWith("<!--") ? "comment" : token.startsWith("<") || token.endsWith(">") ? "tag" : "string")
      : mode === "css" ? (token.startsWith("/*") ? "comment" : token.startsWith("#") || token.startsWith(".") ? "selector" : /^["']/.test(token) ? "string" : /^\d/.test(token) ? "number" : "keyword")
      : (token.startsWith("//") || token.startsWith("/*") ? "comment" : /^["']/.test(token) ? "string" : /^\d/.test(token) ? "number" : "keyword");
    parts.push(<span className={"syntax-" + kind} key={match.index}>{token}</span>);
    last = match.index + token.length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

export default function CodePlayground({ html, css, js, onChange, title = "Code asset" }: Props) {
  const [active, setActive] = useState<Mode>("js");
  const [runKey, setRunKey] = useState(0);
  const source = { html, css, js };
  const [previewSource, setPreviewSource] = useState<CodePlaygroundSource>(() => ({ html, css, js }));
  const srcDoc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"><style>html,body{margin:0;min-height:100%;background:#080a12;color:#f4f4fa;font-family:system-ui,sans-serif}body{overflow:auto}${previewSource.css}</style></head><body>${previewSource.html}<script>try{\n${previewSource.js}\n}catch(e){document.body.insertAdjacentHTML('beforeend','<pre style="color:#ff8d8d;white-space:pre-wrap;padding:12px"></pre>');document.querySelector('pre').textContent=String(e.stack||e)}<\/script></body></html>`, [previewSource, runKey]);
  const value = source[active];
  return <div className="code-playground">
    <div className="code-playground-toolbar"><div className="code-playground-tabs" role="tablist" aria-label="Code editor language">{modes.map(mode => <button type="button" key={mode} role="tab" aria-selected={active === mode} className={active === mode ? "active" : ""} onClick={() => setActive(mode)}>{mode.toUpperCase()}</button>)}</div><div className="inline-actions"><button type="button" className="button button-quiet button-small" onClick={() => setRunKey(value => value + 1)}><RotateCcw size={13}/> Reset preview</button><button type="button" className="button button-primary button-small" onClick={() => { setPreviewSource({ ...source }); setRunKey(value => value + 1); }}><Play size={13}/> Run</button></div></div>
    <label className="code-playground-editor" aria-label={title + " " + active.toUpperCase() + " editor"}><pre aria-hidden="true" className="code-highlight-layer">{highlight(value, active)}{"\n"}</pre><textarea className="text-area code-source-textarea code-editor-input" rows={10} spellCheck={false} value={value} onChange={event => onChange({ [active === "js" ? "js" : active]: event.target.value })} onScroll={event => { const pre = event.currentTarget.previousElementSibling as HTMLElement | null; if (pre) { pre.scrollTop = event.currentTarget.scrollTop; pre.scrollLeft = event.currentTarget.scrollLeft; } }} placeholder={active === "html" ? "<main>...</main>" : active === "css" ? "body { ... }" : "// JavaScript"} /></label>
    <div className="code-playground-preview-heading"><strong>Live preview</strong><span>Sandboxed · changes run when you press Run</span></div><iframe key={runKey} title={title + " live preview"} className="code-playground-preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc}/>
  </div>;
}
