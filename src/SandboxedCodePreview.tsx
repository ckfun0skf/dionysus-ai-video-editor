import { useMemo } from "react";

type Props = {
  title: string;
  html?: string;
  css?: string;
  js?: string;
  style?: React.CSSProperties;
};

/** Renders user-authored clip code in an opaque-origin sandbox, isolated from the editor UI. */
export default function SandboxedCodePreview({ title, html = "", css = "", js = "", style }: Props) {
  const srcDoc = useMemo(() => {
    const markup = html.trim() || '<canvas id="scene" style="display:block;width:100%;height:100%"></canvas>';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f4f4fa;font-family:system-ui,sans-serif}*{box-sizing:border-box} ${css}</style></head><body>${markup}<script>try{\n${js}\n}catch(e){const p=document.createElement('pre');p.style.cssText='position:absolute;inset:auto 8px 8px;color:#ff8d8d;background:#190d12;padding:8px;white-space:pre-wrap;font:12px monospace;max-height:45%;overflow:auto';p.textContent=String(e.stack||e);document.body.appendChild(p)}<\\/script></body></html>`;
  }, [html, css, js]);
  return <iframe
    title={title + " code preview"}
    className="sandboxed-code-preview"
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    srcDoc={srcDoc}
    style={style}
  />;
}
