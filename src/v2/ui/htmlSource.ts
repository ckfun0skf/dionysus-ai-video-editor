/** Split an HTML clip into HTML / CSS / JS panes and join them back (CodePen-style). */
export interface HtmlParts { html: string; css: string; js: string; module: boolean }

export function splitHtml(src: string): HtmlParts {
  const doc = new DOMParser().parseFromString(src, "text/html");
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n").trim();
  const scripts = [...doc.querySelectorAll("script")];
  const js = scripts.map((s) => s.textContent ?? "").join("\n").trim();
  const module = scripts.some((s) => s.type === "module") || scripts.length === 0;
  doc.querySelectorAll("style,script").forEach((n) => n.remove());
  return { html: doc.body.innerHTML.trim(), css, js, module };
}

export function joinHtml(p: HtmlParts): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><style>\n${p.css}\n</style></head>\n<body>\n${p.html}\n<script${p.module ? ' type="module"' : ""}>\n${p.js}\n</script></body></html>\n`;
}
