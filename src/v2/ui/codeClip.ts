import { readManifest, validateParamDecls, writeManifest, type HtmlClipIssue, type HtmlClipManifest, type HtmlClipParam, type ParamType } from "../domain";

/**
 * V2-CODE-EDITOR: the JS-first Code Editor's model of a `dionysus.htmlclip/1` package. The editor stores a clip as one
 * .html file (the package format is unchanged); this module generates that file from the editor's tabs and parses a
 * file back into them when it has the generated shape:
 *
 *   <!doctype html>
 *   <html><head>
 *   <script type="application/json" id="dionysus-clip">{ manifest }</script>
 *   <meta charset="utf-8">
 *   <style>BASE_CSS
 *   /* dionysus:fonts *\/ @font-face … /* /dionysus:fonts *\/   (generated from the font files)
 *   extra CSS</style>
 *   </head>
 *   <body><canvas id="c"></canvas>
 *   extra markup
 *   <script type="module">
 *   script
 *   </script></body></html>
 *
 * Anything else (several scripts, a different page, a missing canvas) opens as raw HTML in the Advanced tab.
 */
export interface CodeClipModel {
  manifest: HtmlClipManifest;
  /** The `<script type="module">` body: imports and `dionysus.clip({ init, render })`. */
  script: string;
  /** CSS after the base page CSS and the generated @font-face rules (Advanced). */
  css: string;
  /** Markup after the canvas, e.g. a hidden element that uses a font (Advanced). Never captured. */
  markup: string;
}

export type ParsedClip = { kind: "model"; model: CodeClipModel } | { kind: "raw"; manifest: HtmlClipManifest; html: string; reason: string };

/** The editor's page CSS: a full-bleed canvas on a transparent page. */
export const BASE_CSS = "html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}";

export const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const FONT_FORMAT: Record<string, string> = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
const FONTS_START = "/* dionysus:fonts */", FONTS_END = "/* /dionysus:fonts */";
const MANIFEST_TAG = /<script\s+type=["']application\/json["']\s+id=["']dionysus-clip["']\s*>[\s\S]*?<\/script>\s*/i;

/** The CSS font-family for an embedded font file: its name without the extension. */
export const fontFamily = (file: string) => file.replace(FONT_EXT, "");

/** @font-face rules for the manifest's font files (the runtime resolves url(name) to the embedded data). */
export function fontFaceCss(files: Record<string, string> | undefined): string {
  return Object.keys(files ?? {}).filter((n) => FONT_EXT.test(n)).map((n) => {
    const ext = n.split(".").pop()!.toLowerCase();
    return `@font-face { font-family: ${JSON.stringify(fontFamily(n))}; src: url(${JSON.stringify(n)}) format("${FONT_FORMAT[ext]}"); font-display: block; }`;
  }).join("\n");
}

const noClose = (s: string, tag: string) => s.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

/** The package file for a model. */
export function generateClip(m: CodeClipModel): string {
  const fonts = fontFaceCss(m.manifest.files);
  const css = [BASE_CSS, fonts ? `${FONTS_START}\n${fonts}\n${FONTS_END}` : "", m.css.trim()].filter(Boolean).join("\n");
  const markup = m.markup.trim();
  const script = m.script.replace(/\s+$/, "");
  const page = `<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<style>${noClose(css, "style")}</style>\n</head>\n<body><canvas id="c"></canvas>\n${markup ? `${markup}\n` : ""}<script type="module">\n${noClose(script, "script")}\n</script></body></html>\n`;
  return writeManifest(page, m.manifest);
}

const PAGE_RE = /^\s*<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset=["']?utf-8["']?\s*\/?>\s*<style>([\s\S]*?)<\/style>\s*<\/head>\s*<body>\s*<canvas id=["']c["']>\s*<\/canvas>\s*([\s\S]*?)<script type=["']module["']>\n?([\s\S]*?)<\/script>\s*<\/body>\s*<\/html>\s*$/i;

/** Parse a package file into the editor's tabs; files that don't have the generated shape come back raw. */
export function parseClip(html: string): ParsedClip {
  const manifest = readManifest(html);
  const raw = (reason: string): ParsedClip => ({ kind: "raw", manifest, html: html.replace(MANIFEST_TAG, ""), reason });
  const m = PAGE_RE.exec(html.replace(MANIFEST_TAG, ""));
  if (!m) return raw("This clip's page isn't the editor's canvas + script layout, so it opens as raw HTML.");
  const [, style, markup, script] = m;
  if (/<script/i.test(markup) || /<script/i.test(script)) return raw("This clip has more than one script, so it opens as raw HTML.");
  let css = style.trim();
  if (!css.startsWith(BASE_CSS)) return raw("This clip has its own page CSS, so it opens as raw HTML.");
  css = css.slice(BASE_CSS.length).trim();
  if (css.startsWith(FONTS_START)) {
    const end = css.indexOf(FONTS_END);
    if (end < 0) return raw("This clip's font rules are incomplete, so it opens as raw HTML.");
    css = css.slice(end + FONTS_END.length).trim();
  }
  return { kind: "model", model: { manifest, script: script.replace(/\s+$/, "") + "\n", css, markup: markup.trim() } };
}

/** A raw (Advanced) clip's file: its HTML with the editor's manifest. */
export const generateRaw = (html: string, manifest: HtmlClipManifest) => writeManifest(html.replace(MANIFEST_TAG, ""), manifest);

/** The Params tab's rows: the manifest's keyed params as an ordered, editable list. */
export interface ParamRow { id: string; key: string; param: HtmlClipParam }

let rowSeq = 0;
export const paramRows = (params: Record<string, HtmlClipParam> | undefined): ParamRow[] =>
  Object.entries(params ?? {}).map(([key, param]) => ({ id: `p${++rowSeq}`, key, param }));

/** Rows back to the manifest's `params` (in row order); undefined when there are none. */
export function rowsToParams(rows: readonly ParamRow[]): Record<string, HtmlClipParam> | undefined {
  if (!rows.length) return undefined;
  const out: Record<string, HtmlClipParam> = {};
  for (const r of rows) out[r.key] = cleanParam(r.param);
  return out;
}

/** Only the fields that apply to the type, without empty ones (so the manifest stays tidy). */
export function cleanParam(p: HtmlClipParam): HtmlClipParam {
  const out: HtmlClipParam = { type: p.type, default: p.default };
  if (p.type === "number") for (const f of ["min", "max", "step"] as const) if (typeof p[f] === "number" && Number.isFinite(p[f])) out[f] = p[f];
  if (p.type === "select") out.options = p.options ?? [];
  if (p.label) out.label = p.label;
  if (p.description) out.description = p.description;
  return out;
}

const KEY_RE = /^[A-Za-z_][\w.-]{0,63}$/;

/** Per-row problems: key format and uniqueness, then the package's own param validation. */
export function validateRows(rows: readonly ParamRow[]): Map<string, HtmlClipIssue[]> {
  const out = new Map<string, HtmlClipIssue[]>();
  const add = (id: string, i: HtmlClipIssue) => out.set(id, [...(out.get(id) ?? []), i]);
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
  for (const r of rows) {
    if (!r.key) { add(r.id, { level: "error", code: "param-name", message: "Give the param a key." }); continue; }
    if (!KEY_RE.test(r.key)) { add(r.id, { level: "error", code: "param-name", message: `Key "${r.key}" must start with a letter and use letters, digits, "_", "-" or ".".` }); continue; }
    if ((seen.get(r.key) ?? 0) > 1) add(r.id, { level: "error", code: "param-dup", message: `Another param already uses the key "${r.key}".` });
    for (const i of validateParamDecls({ [r.key]: cleanParam(r.param) })) add(r.id, i);
  }
  return out;
}

/** How the script reads a param. */
export const paramSnippet = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key) ? `ctx.params.${key}` : `ctx.params[${JSON.stringify(key)}]`;

export const DEFAULT_FOR: Record<ParamType, HtmlClipParam> = {
  number: { type: "number", default: 1, min: 0, max: 10, step: 0.1 },
  color: { type: "color", default: "#20d5ec" },
  text: { type: "text", default: "Text" },
  boolean: { type: "boolean", default: true },
  select: { type: "select", default: "a", options: ["a", "b"] },
};

/** A param converted to another type: keeps key/label, takes a sensible default for the new type. */
export function retype(p: HtmlClipParam, type: ParamType): HtmlClipParam {
  const base = DEFAULT_FOR[type];
  const keep = { label: p.label, description: p.description };
  if (type === "text" && p.type !== "text") return { ...base, ...keep, default: String(p.default) };
  if (type === "select" && typeof p.default === "string" && p.default) return { ...base, ...keep, default: p.default, options: [p.default] };
  return { ...base, ...keep };
}

/** A free key like "param", "param2", … */
export function freeKey(rows: readonly ParamRow[], base = "param"): string {
  const used = new Set(rows.map((r) => r.key));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/**
 * The script with its imports blanked (line numbers kept), for a quick syntax check in the editor. The clip itself
 * runs as a module in the sandbox; this only catches typos before the preview reloads.
 */
export function syntaxCheck(script: string): { message: string; line?: number } | undefined {
  const blank = (m: string) => m.replace(/[^\n]/g, "");
  const body = script.replace(/^[ \t]*import\s+(?:[\w*{}\s,$]+?\s+from\s+)?["'][^"'\n]+["'];?/gm, blank).replace(/^[ \t]*export\s+(default\s+)?/gm, "");
  try {
    const AsyncFn = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => unknown;
    new AsyncFn("dionysus", body);
    return undefined;
  } catch (e) {
    const err = e as Error & { lineNumber?: number };
    return { message: err.message, line: typeof err.lineNumber === "number" ? err.lineNumber - 2 : undefined };
  }
}
