/**
 * Dionysus HTML Clip Package, `dionysus.htmlclip/1` (V2-HTML-PKG). Spec: docs/v2/HTML_CLIP_PACKAGE.md (published as
 * ai/HTML_CLIP_PACKAGE.md). An HTML clip is ONE self-contained .html document:
 *   - a manifest in `<script type="application/json" id="dionysus-clip">` (format, name, size, duration, libs,
 *     bindings, params, embedded files),
 *   - its `<style>` and markup,
 *   - a `<script>` that registers `dionysus.clip({ init?(ctx), render(t, ctx) })`.
 * The editor drives it frame by frame from timeline time (render/htmlClip.ts runtime). This module is pure (no DOM):
 * the manifest read/write, validation of the manifest and of the runtime contract, and the AI packaging prompt.
 * The library registry lives in render/htmlLibs.ts; functions here take the allowed libraries as an argument.
 */

export const HTML_CLIP_FORMAT = "dionysus.htmlclip/1";
/** Portable multi-file form: a ZIP with manifest.json, index.html, style.css, script.js and files/…. */
export const HTML_CLIP_ZIP_SUFFIX = ".dionysus-html.zip";
export const HTML_CLIP_ASPECTS = ["16:9", "9:16", "1:1", "4:5", "21:9"] as const;
export const BINDING_TYPES = ["image", "video", "audio"] as const;
export type BindingType = (typeof BINDING_TYPES)[number];
export const PARAM_TYPES = ["number", "color", "text", "boolean", "select"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
/** Longest clip and largest frame side a manifest may ask for. */
export const MAX_CLIP_SEC = 600;
export const MAX_CLIP_SIDE = 8192;

/** A named slot for media from another asset (a storyboard asset id, or a project asset id on the timeline). */
export interface HtmlClipBinding { type: BindingType; asset?: string; label?: string; description?: string }
export interface HtmlClipParam {
  type: ParamType; default: number | string | boolean; label?: string; description?: string;
  min?: number; max?: number; step?: number; options?: string[];
}
export interface HtmlClipManifest {
  format?: string;
  name?: string;
  description?: string;
  /** Intended length; the timeline clip's own length wins at render time (ctx.duration). */
  durationSec?: number;
  width?: number;
  height?: number;
  aspect?: string;
  /** CSS colour, or "transparent" when the canvas keeps an alpha channel. Informational for the editor. */
  background?: string;
  /** Library ids from the registry (render/htmlLibs.ts). Absent = detected from the page's imports. */
  libs?: string[];
  bindings?: Record<string, HtmlClipBinding>;
  params?: Record<string, HtmlClipParam>;
  /** Embedded files, by relative name → data: URL (src="logo.png", url(font.woff2), fetch("data.json")). */
  files?: Record<string, string>;
}
/** A library a clip may import (the registry's public part). */
export interface ClipLibrary { id: string; name: string; version: string; specifier: string; legacy?: RegExp }

export type IssueLevel = "error" | "warning";
export interface HtmlClipIssue { level: IssueLevel; code: string; message: string }

const MANIFEST_RE = /<script\s+type=["']application\/json["']\s+id=["']dionysus-clip["']\s*>([\s\S]*?)<\/script>\s*/i;
const NAME_RE = /^[A-Za-z_][\w.-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The manifest JSON text, or undefined when the document has none. */
export function manifestText(html: string): string | undefined {
  const m = MANIFEST_RE.exec(html);
  return m ? m[1].replace(/<\\\//g, "</") : undefined;
}

/** Parse the manifest; legacy `assets` (embedded files before V2-HTML-PKG) is read as `files`. */
export function parseManifest(json: unknown): HtmlClipManifest {
  if (!isObj(json)) return {};
  const { assets, ...rest } = json as HtmlClipManifest & { assets?: Record<string, string> };
  const m = { ...rest } as HtmlClipManifest;
  if (!m.files && isObj(assets)) m.files = assets as Record<string, string>;
  return m;
}

export function readManifest(html: string): HtmlClipManifest {
  const t = manifestText(html);
  if (t === undefined) return {};
  try { return parseManifest(JSON.parse(t)); } catch { return {}; }
}

const KEY_ORDER: (keyof HtmlClipManifest)[] = ["format", "name", "description", "durationSec", "width", "height", "aspect", "background", "libs", "bindings", "params", "files"];

/** Canonical key order, no empty fields. Keeps unknown keys (after the known ones) for forward compatibility. */
export function canonicalManifest(m: HtmlClipManifest): HtmlClipManifest {
  const out: Record<string, unknown> = {};
  const src = m as Record<string, unknown>;
  const empty = (v: unknown) => v === undefined || v === "" || (isObj(v) && !Object.keys(v).length);
  for (const k of [...KEY_ORDER, ...Object.keys(src).filter((k) => !KEY_ORDER.includes(k as keyof HtmlClipManifest) && k !== "assets")]) {
    if (!empty(src[k])) out[k] = src[k];
  }
  return out as HtmlClipManifest;
}

/** Write (or replace) the manifest tag right after `<head>`; an empty manifest removes it. */
export function writeManifest(html: string, m: HtmlClipManifest): string {
  const body = html.replace(MANIFEST_RE, "");
  const c = canonicalManifest(m);
  if (!Object.keys(c).length) return body;
  const tag = `<script type="application/json" id="dionysus-clip">${JSON.stringify(c, null, 1).replace(/<\//g, "<\\/")}</script>\n`;
  const h = /<head[^>]*>/i.exec(body);
  if (h) return body.slice(0, h.index + h[0].length) + tag + body.slice(h.index + h[0].length);
  const d = /^\s*<!doctype[^>]*>\s*/i.exec(body);
  return d ? body.slice(0, d[0].length) + tag + body.slice(d[0].length) : tag + body;
}

/** Validate a parsed manifest object (as JSON); `libs` is the registry. */
export function validateManifest(raw: unknown, libs: readonly ClipLibrary[]): HtmlClipIssue[] {
  const out: HtmlClipIssue[] = [];
  const err = (code: string, message: string) => out.push({ level: "error", code, message });
  const warn = (code: string, message: string) => out.push({ level: "warning", code, message });
  if (!isObj(raw)) { err("manifest-json", "The manifest must be a JSON object."); return out; }
  const m = parseManifest(raw);
  if (m.format === undefined) warn("format-missing", `The manifest has no "format"; it is treated as "${HTML_CLIP_FORMAT}".`);
  else if (m.format !== HTML_CLIP_FORMAT) err("format", `Unknown "format" "${String(m.format)}"; this app reads "${HTML_CLIP_FORMAT}".`);
  if (m.name !== undefined && typeof m.name !== "string") err("name", `"name" must be a string.`);
  if (m.durationSec !== undefined && !(typeof m.durationSec === "number" && m.durationSec > 0 && m.durationSec <= MAX_CLIP_SEC)) err("duration", `"durationSec" must be a number of seconds between 0 and ${MAX_CLIP_SEC}.`);
  for (const k of ["width", "height"] as const) {
    const v = m[k];
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= 16 && (v as number) <= MAX_CLIP_SIDE)) err("size", `"${k}" must be a whole number of pixels from 16 to ${MAX_CLIP_SIDE}.`);
  }
  if (m.aspect !== undefined && !(HTML_CLIP_ASPECTS as readonly string[]).includes(m.aspect)) warn("aspect", `"aspect" "${String(m.aspect)}" is not one of ${HTML_CLIP_ASPECTS.join(", ")}.`);
  if (m.background !== undefined && typeof m.background !== "string") err("background", `"background" must be a CSS colour or "transparent".`);
  if (m.libs !== undefined) {
    if (!Array.isArray(m.libs)) err("libs", `"libs" must be an array of library ids.`);
    else for (const id of m.libs) if (!libs.some((l) => l.id === id)) err("lib-unknown", `Unknown library "${String(id)}". Allowed: ${libs.map((l) => `"${l.id}" (${l.name} ${l.version})`).join(", ") || "none"}.`);
  }
  if (m.bindings !== undefined) {
    if (!isObj(m.bindings)) err("bindings", `"bindings" must be an object: { "<name>": { "type": "image" | "video" | "audio", "asset"?: "<asset id>" } }.`);
    else for (const [n, b] of Object.entries(m.bindings)) {
      if (!NAME_RE.test(n)) err("binding-name", `Binding name "${n}" must start with a letter and use letters, digits, "_", "-" or ".".`);
      if (!isObj(b) || !(BINDING_TYPES as readonly string[]).includes(String((b as HtmlClipBinding).type))) err("binding-type", `Binding "${n}" needs "type": ${BINDING_TYPES.map((t) => `"${t}"`).join(" | ")}.`);
      else if (b.asset !== undefined && typeof b.asset !== "string") err("binding-asset", `Binding "${n}": "asset" must be an asset id.`);
    }
  }
  if (m.params !== undefined) for (const i of validateParamDecls(m.params)) out.push(i);
  if (m.files !== undefined) {
    if (!isObj(m.files)) err("files", `"files" must map file names to data: URLs.`);
    else for (const [n, d] of Object.entries(m.files)) if (typeof d !== "string" || !d.startsWith("data:")) err("file", `File "${n}" must be a data: URL.`);
  }
  return out;
}

/** A param value as stored per use (on a timeline clip or a storyboard shot/layer) and as passed in ctx.params. */
export type HtmlParamValue = number | string | boolean;
export type HtmlParamValues = Record<string, HtmlParamValue>;

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PARAM_SHAPE = `{ "<key>": { "type": "number" | "color" | "text" | "boolean" | "select", "default": … } }`;

/**
 * Validate param declarations (a manifest's `params`, or a storyboard html asset's `params`; V2-HTML-PARAMS):
 * keys, types, a default of the right type, number min ≤ default ≤ max and step > 0, select options, hex colours.
 */
export function validateParamDecls(raw: unknown, where = ""): HtmlClipIssue[] {
  const out: HtmlClipIssue[] = [];
  const err = (code: string, message: string) => out.push({ level: "error", code, message: where + message });
  if (!isObj(raw)) { err("params", `"params" must be an object: ${PARAM_SHAPE}.`); return out; }
  for (const [k, p] of Object.entries(raw)) {
    if (!NAME_RE.test(k)) err("param-name", `Param key "${k}" must start with a letter and use letters, digits, "_", "-" or ".".`);
    if (!isObj(p) || !(PARAM_TYPES as readonly string[]).includes(String(p.type))) { err("param-type", `Param "${k}" needs "type": ${PARAM_TYPES.map((t) => `"${t}"`).join(" | ")}.`); continue; }
    const d = p.default;
    const bad = (why: string) => err("param-default", `Param "${k}": ${why}.`);
    if (p.label !== undefined && typeof p.label !== "string") err("param-label", `Param "${k}": "label" must be a string.`);
    if (p.description !== undefined && typeof p.description !== "string") err("param-label", `Param "${k}": "description" must be a string.`);
    if (p.type === "number") {
      for (const f of ["min", "max", "step"] as const) if (p[f] !== undefined && !(typeof p[f] === "number" && Number.isFinite(p[f]))) err("param-range", `Param "${k}": "${f}" must be a number.`);
      if (typeof p.min === "number" && typeof p.max === "number" && p.min > p.max) err("param-range", `Param "${k}": "min" ${p.min} is greater than "max" ${p.max}.`);
      if (typeof p.step === "number" && !(p.step > 0)) err("param-range", `Param "${k}": "step" must be greater than 0.`);
      if (typeof d !== "number" || !Number.isFinite(d)) bad(`"default" must be a number`);
      else if ((typeof p.min === "number" && d < p.min) || (typeof p.max === "number" && d > p.max)) bad(`"default" ${d} is outside min–max`);
    } else if (p.type === "boolean") { if (typeof d !== "boolean") bad(`"default" must be true or false`); }
    else if (p.type === "select") {
      if (!Array.isArray(p.options) || !p.options.length || !p.options.every((o) => typeof o === "string")) bad(`"options" must be a non-empty list of strings`);
      else if (!p.options.includes(d as string)) bad(`"default" must be one of "options"`);
    } else if (typeof d !== "string") bad(`"default" must be a string`);
    else if (p.type === "color" && !HEX_RE.test(d)) bad(`"default" must be a hex colour like "#ffcc00"`);
  }
  return out;
}

/** The well-formed declarations of `raw` (invalid entries dropped), for code that must not trust input. */
export function cleanParamDecls(raw: unknown): Record<string, HtmlClipParam> {
  const out: Record<string, HtmlClipParam> = {};
  if (!isObj(raw)) return out;
  for (const [k, p] of Object.entries(raw)) if (!validateParamDecls({ [k]: p }).length) out[k] = p as HtmlClipParam;
  return out;
}

/**
 * Check one per-use value against its declaration. Numbers outside min–max are clamped (with a note); anything of
 * the wrong type, a select value not in `options` or a colour that is not hex is rejected.
 */
export function checkParamValue(spec: HtmlClipParam, v: unknown): { value?: HtmlParamValue; problem?: string; clamped?: boolean } {
  switch (spec.type) {
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) return { problem: "must be a number" };
      const lo = typeof spec.min === "number" ? spec.min : -Infinity, hi = typeof spec.max === "number" ? spec.max : Infinity;
      const c = Math.min(hi, Math.max(lo, v));
      return c === v ? { value: v } : { value: c, clamped: true, problem: `${v} is outside ${spec.min ?? "…"}–${spec.max ?? "…"}; ${c} is used` };
    }
    case "boolean": return typeof v === "boolean" ? { value: v } : { problem: "must be true or false" };
    case "select": return typeof v === "string" && (spec.options ?? []).includes(v) ? { value: v } : { problem: `must be one of ${(spec.options ?? []).map((o) => `"${o}"`).join(", ")}` };
    case "color": return typeof v === "string" && HEX_RE.test(v) ? { value: v } : { problem: `must be a hex colour like "#ffcc00"` };
    default: return typeof v === "string" ? { value: v } : { problem: "must be a string" };
  }
}

/**
 * The values a clip sees in ctx.params (V2-HTML-PARAMS): every declared param's default, overridden by the per-use
 * values that fit its declaration (numbers clamped). Overrides for keys the manifest doesn't declare are ignored, so a
 * clip whose new version drops or renames a param keeps working; the stored overrides are kept for later versions.
 */
export function resolveHtmlParams(decls: Record<string, HtmlClipParam> | undefined, overrides?: Record<string, unknown>): HtmlParamValues {
  const out: HtmlParamValues = {};
  for (const [k, spec] of Object.entries(cleanParamDecls(decls))) {
    out[k] = spec.default;
    if (overrides && k in overrides) { const c = checkParamValue(spec, overrides[k]); if (c.value !== undefined) out[k] = c.value; }
  }
  return out;
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface LintOptions {
  libs: readonly ClipLibrary[];
  /** Bindings the storyboard expects (name → type); missing ones are warnings. */
  expectBindings?: Record<string, BindingType>;
  /** Params the storyboard declares for this asset (V2-HTML-PARAMS); missing or differently typed ones are warnings. */
  expectParams?: Record<string, HtmlClipParam>;
}
export interface LintResult { manifest: HtmlClipManifest; issues: HtmlClipIssue[]; ok: boolean; legacy: boolean }

/**
 * Check a clip against the package standard: the manifest, the runtime contract (a render function), network use,
 * libraries, determinism hazards, bindings and capture (a <canvas>). Errors block an import; warnings don't.
 * Legacy clips (no manifest, or one without "format") are accepted with warnings.
 */
export function lintHtmlClip(html: string, opts: LintOptions): LintResult {
  const issues: HtmlClipIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });
  let manifest: HtmlClipManifest = {};
  let legacy = false;
  if (!html.trim()) { err("empty", "Nothing to import: the HTML is empty."); return { manifest, issues, ok: false, legacy }; }
  if (!/<(html|body|head|canvas|script|svg|div|!doctype)\b/i.test(html)) err("not-html", "This doesn't look like an HTML file.");
  const t = manifestText(html);
  if (t === undefined) { legacy = true; warn("manifest-missing", `No manifest (<script type="application/json" id="dionysus-clip">). The clip is accepted as a legacy clip; saving it in the editor adds one.`); }
  else {
    let raw: unknown;
    try { raw = JSON.parse(t); } catch (e) { err("manifest-json", `The manifest is not valid JSON: ${e instanceof Error ? e.message : String(e)}.`); }
    if (raw !== undefined) { issues.push(...validateManifest(raw, opts.libs)); manifest = parseManifest(raw); legacy = manifest.format === undefined; }
  }
  const code = stripComments(html.replace(MANIFEST_RE, "").replace(/data:[^"'()\s]+/g, "data:"));
  // Runtime contract: something must draw frame t.
  const api = /\bdionysus\s*\.\s*(clip|onFrame)\s*\(/.test(code);
  const raf = /\brequestAnimationFrame\s*\(/.test(code);
  // A warning, not an error: a legacy page that draws once on load still shows that picture.
  if (!api && !raf) warn("render-missing", `No render function, so the clip won't animate: register one with dionysus.clip({ render(t, ctx) { … } }).`);
  else if (!api) warn("render-legacy", `The clip animates with requestAnimationFrame. It still plays (the editor drives it from timeline time), but frames that depend on earlier frames can differ after a seek or in export; prefer dionysus.clip({ render(t, ctx) }).`);
  // Network: only the pinned libraries, loaded through the import map.
  const libs = opts.libs;
  const declared = manifest.libs;
  const legacyLib = libs.filter((l) => l.legacy && new RegExp(l.legacy.source).test(code));
  for (const l of legacyLib) warn("lib-cdn", `${l.name} is loaded from a CDN URL; the app maps it to its pinned copy. Import it as "${l.specifier}" instead.`);
  let net = code;
  for (const l of legacyLib) net = net.replace(new RegExp(l.legacy!.source, "g"), "");
  net = net.replace(/xmlns(:\w+)?=["']https?:\/\/[^"']*["']/gi, "").replace(/https?:\/\/www\.w3\.org\/[^\s"'<>)]*/gi, "");
  const urls = [...new Set([...net.matchAll(/(?:src|href|poster|data|action)\s*=\s*["']?\s*((?:https?:)?\/\/[^\s"'<>]+)|\b(?:from|import)\s*\(?\s*["']((?:https?:)?\/\/[^"']+)["']|url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|\b(?:fetch|WebSocket|EventSource|open)\s*\(\s*(?:["'][A-Z]+["']\s*,\s*)?["'`]((?:https?:|wss?:)?\/\/[^"'`]+)|@import\s+["']((?:https?:)?\/\/[^"']+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]))];
  for (const u of urls.slice(0, 5)) err("network", `Network access is blocked in clips: ${u.length > 80 ? `${u.slice(0, 77)}…` : u}. Embed the file in the manifest "files" (or a ZIP package), use a system font, or an allowed library.`);
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(code) && !urls.some((u) => /fonts\.g/.test(u))) err("network", "Web fonts can't be loaded from Google Fonts; embed the font file or use a system font stack.");
  // Bare imports must be allowed libraries.
  for (const m of code.matchAll(/\b(?:import\s+[^"';]*?from\s*|import\s*\(\s*|import\s+)["']([^"'./][^"']*)["']/g)) {
    const spec = m[1];
    if (/^(https?:|data:|blob:)/.test(spec)) continue;
    const lib = libs.find((l) => l.specifier === spec);
    if (!lib) err("lib-unknown", `Unknown library import "${spec}". Allowed: ${libs.map((l) => `"${l.specifier}" (${l.name} ${l.version})`).join(", ") || "none"}.`);
    else if (declared && !declared.includes(lib.id)) err("lib-undeclared", `The page imports "${spec}" but the manifest "libs" doesn't list "${lib.id}".`);
  }
  // Determinism hazards (the shim makes them follow t, but stateful animation breaks on seek).
  const hazards: [RegExp, string][] = [[/\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/, "Date.now()/new Date()"], [/\bperformance\.now\s*\(/, "performance.now()"], [/\bset(?:Interval|Timeout)\s*\(/, "setInterval/setTimeout"], [/\bMath\.random\s*\(/, "Math.random()"]];
  const used = hazards.filter(([re]) => re.test(code)).map(([, n]) => n);
  if (used.length) warn("nondeterministic", `Uses ${used.join(", ")}. Every frame must be a pure function of t, ctx.params and the bindings (seeded randomness from a fixed seed is fine); clocks and timers don't advance like the timeline.`);
  // Capture: the frame is the page's first <canvas>.
  if (!/<canvas\b/i.test(code) && !/createElement\s*\(\s*["']canvas["']\s*\)/.test(code)) warn("no-canvas", "No <canvas>: the editor captures the clip's first <canvas> element, so plain HTML/CSS will not appear in the video. Draw to a canvas.");
  // Bindings.
  const b = isObj(manifest.bindings) ? manifest.bindings : {};
  for (const [n, type] of Object.entries(opts.expectBindings ?? {})) {
    if (!b[n]) warn("binding-missing", `Binding "${n}" (${type}) is expected but not declared in the manifest "bindings".`);
    else if (b[n].type !== type) warn("binding-mismatch", `Binding "${n}" is declared as ${b[n].type} but the asset is ${type}.`);
  }
  for (const n of Object.keys(b)) if (!new RegExp(`["'\`.]${esc(n)}["'\`]?`).test(code)) warn("binding-unused", `Binding "${n}" is declared but the code never uses it (ctx.bindings["${n}"]).`);
  // Params (V2-HTML-PARAMS): the storyboard's declared params must be exposed, and exposed params must be read.
  const ps = isObj(manifest.params) ? manifest.params : {};
  for (const [k, spec] of Object.entries(opts.expectParams ?? {})) {
    if (!ps[k]) warn("param-missing", `Param "${k}" (${spec.type}) is declared on the storyboard asset but not in the manifest "params", so per-shot values for it are ignored.`);
    else if (ps[k].type !== spec.type) warn("param-mismatch", `Param "${k}" is ${ps[k].type} in the manifest but ${spec.type} on the storyboard asset.`);
  }
  if (Object.keys(ps).length && !/\bparams\b/.test(code)) warn("param-unused", `The manifest declares "params" but the code never reads ctx.params, so edits won't change the picture.`);
  return { manifest, issues, ok: !issues.some((i) => i.level === "error"), legacy };
}

/**
 * Pull the HTML out of an AI reply: the largest ```html fenced block, else the whole text when it is a document.
 * Returns undefined when nothing looks like HTML.
 */
export function extractHtml(reply: string): string | undefined {
  const blocks = [...reply.matchAll(/```[ \t]*(html|htm)?[^\n]*\n([\s\S]*?)```/gi)].map((m) => ({ lang: m[1], body: m[2] })).filter((b) => /<[a-z!]/i.test(b.body));
  const pick = (bs: typeof blocks) => bs.sort((a, b) => b.body.length - a.body.length)[0]?.body;
  const fenced = pick(blocks.filter((b) => b.lang)) ?? pick(blocks);
  if (fenced) return `${fenced.trim()}\n`;
  const t = reply.trim();
  const at = t.search(/<!doctype html|<html[\s>]/i);
  if (at >= 0) { const end = t.toLowerCase().lastIndexOf("</html>"); return `${t.slice(at, end > at ? end + 7 : undefined).trim()}\n`; }
  return undefined;
}

/** Frame size for an aspect at 1080p-class resolution. */
export function sizeForAspect(aspect: string | undefined): { width: number; height: number } {
  switch (aspect) {
    case "9:16": return { width: 1080, height: 1920 };
    case "1:1": return { width: 1080, height: 1080 };
    case "4:5": return { width: 1080, height: 1350 };
    case "21:9": return { width: 2520, height: 1080 };
    default: return { width: 1920, height: 1080 };
  }
}

/** The runtime contract, as published in the spec (docs/v2/HTML_CLIP_PACKAGE.md §3, checked by a test) and inlined in the full prompt. */
export const HTML_CLIP_CONTRACT = `- Register the clip once, at the top level of your script: \`dionysus.clip({ async init(ctx) { … }, render(t, ctx) { … } })\`. \`init\` (optional) runs once before the first frame; await anything you need there (images, fonts, models). \`render(t, ctx)\` draws the frame at \`t\` seconds into the clip and may return a Promise.
- \`ctx\` = \`{ canvas, t, duration, progress, width, height, params, bindings, asset(name), image(name), video(name), seek(video, sec) }\`: \`duration\` is the clip's length on the timeline in seconds (it can differ from the manifest's \`durationSec\`), \`progress\` = t / duration (0–1), \`canvas\` the page's first \`<canvas>\` (the captured picture), \`width\`/\`height\` the frame size in pixels, \`params\` the parameter values (each declared param's default, overridden by the values set where the clip is used: a timeline clip, a storyboard shot or layer; read them in \`render\`, they can change between frames while the user edits), \`bindings[name]\` = \`{ type, url }\` for each bound asset (\`url\` is null when nothing is bound yet: draw a placeholder), \`asset(name)\` the URL of an embedded file, \`image(name)\` a Promise of a loaded HTMLImageElement for a binding or file, \`video(name)\` a Promise of a muted HTMLVideoElement, \`seek(video, sec)\` a Promise that resolves when that video shows \`sec\`.
- The picture is the page's FIRST \`<canvas>\`: size it to ctx.width × ctx.height in \`init\` and draw everything on it (2D or WebGL; for WebGL use \`preserveDrawingBuffer: true\`). Other DOM and CSS are not captured.
- Deterministic: every frame is a pure function of t, ctx.params and the bound assets. Frames are requested in any order (scrubbing, export), and the same t must give the same picture. Don't keep animation state between frames, don't use Date.now(), performance.now(), requestAnimationFrame, setTimeout or setInterval for timing, and use a seeded random generator (fixed seed) instead of Math.random().
- No network: the clip runs in a sandbox with a strict Content-Security-Policy. Only the allowed libraries (listed in the manifest's \`libs\`, imported by their bare specifier in a \`<script type="module">\`, e.g. \`import * as LIB from "<specifier>"\`) are loaded. Embed any other file as a data: URL in the manifest's \`files\` and refer to it by name. Use system font stacks, or an embedded font with @font-face (the runtime waits for fonts to load before the first frame).
- Transparency: with \`"background": "transparent"\`, clear the canvas to transparent (2D: clearRect; WebGL: \`alpha: true\` and a clear colour with alpha 0); the clip is composited over the layers below. Otherwise paint the background colour every frame.`;

export interface PackagePromptInput {
  /** The design brief (the storyboard asset's prompt). */
  brief: string;
  name: string;
  /** Asset id, used for the manifest name default and the file name. */
  id?: string;
  durationSec?: number;
  aspect?: string;
  background?: string;
  bindings?: { name: string; type: BindingType; label?: string; description?: string }[];
  /** Params the storyboard declares for this asset (V2-HTML-PARAMS): the clip must expose them in its manifest. */
  params?: Record<string, HtmlClipParam>;
  /** Example per-use values from the shots/layers that use this asset (shown in the prompt so the design fits them). */
  paramUses?: HtmlParamValues[];
  /** Extra context (e.g. the shot the clip plays in). */
  context?: string;
  /**
   * P2B (item 5): other html (code) assets this one references. Their .html is attached as a code reference to reuse
   * (look, helpers, motion language); they are not loaded at runtime.
   */
  codeRefs?: { name: string; label?: string; brief?: string }[];
}
export interface PackagePromptOptions {
  libs: readonly ClipLibrary[];
  /** Absolute URL of the published spec (ai/HTML_CLIP_PACKAGE.md), from the runtime origin. */
  specUrl: string;
  /** Inline the whole contract and a template instead of only linking to the spec. */
  full?: boolean;
}

/** The manifest the AI is asked to write for this asset. */
export function promptManifest(input: PackagePromptInput, libs: readonly ClipLibrary[]): HtmlClipManifest {
  const size = sizeForAspect(input.aspect);
  return canonicalManifest({
    format: HTML_CLIP_FORMAT,
    name: input.name,
    durationSec: input.durationSec,
    ...size,
    aspect: input.aspect,
    background: input.background ?? "#000000",
    libs: libs.length ? [] : undefined,
    bindings: input.bindings?.length ? Object.fromEntries(input.bindings.map((b) => [b.name, { type: b.type, asset: b.name, ...(b.label ? { label: b.label } : {}) }])) : undefined,
    params: input.params && Object.keys(input.params).length ? input.params : undefined,
  });
}

/** Minimal, complete clip for a manifest: what the template in the spec and the full prompt show. */
export function htmlClipTemplate(m: HtmlClipManifest = { format: HTML_CLIP_FORMAT, name: "Template", durationSec: 4, width: 1920, height: 1080, background: "#000000" }): string {
  const bind = Object.keys(m.bindings ?? {})[0];
  return writeManifest(`<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>
</head>
<body><canvas id="c"></canvas>
<script type="module">
let g = null;${bind ? "\nlet pic = null;" : ""}
dionysus.clip({
  async init(ctx) {
    ctx.canvas.width = ctx.width; ctx.canvas.height = ctx.height;
    g = ctx.canvas.getContext("2d");${bind ? `\n    if (ctx.bindings[${JSON.stringify(bind)}]?.url) pic = await ctx.image(${JSON.stringify(bind)});` : ""}
  },
  render(t, ctx) {
    const { width: w, height: h, progress } = ctx;
    g.fillStyle = ${JSON.stringify(m.background && m.background !== "transparent" ? m.background : "#000000")};
    g.fillRect(0, 0, w, h);${bind ? `\n    if (pic) g.drawImage(pic, 0, 0, w, h);` : ""}
    const r = Math.min(w, h) * (0.1 + 0.2 * progress);
    g.fillStyle = "#5ad1c8";
    g.beginPath(); g.arc(w / 2 + Math.cos(t * 2) * w * 0.25, h / 2, r, 0, Math.PI * 2); g.fill();
  },
});
</script></body></html>
`, m);
}

/** The prompt's params section: the declared params to expose and read, or the optional-params hint. */
function paramLines(input: PackagePromptInput): string {
  const ps = Object.entries(input.params ?? {});
  if (!ps.length) return `- Optional "params": user-editable values, e.g. "params": { "accent": { "type": "color", "default": "#5ad1c8", "label": "Accent" } }; types number (min, max, step), color, text, boolean, select (options). Read them from ctx.params.`;
  const list = ps.map(([k, p]) => `  - "${k}" (${p.type}${p.type === "number" && (p.min !== undefined || p.max !== undefined) ? ` ${p.min ?? "…"}–${p.max ?? "…"}` : ""}${p.type === "select" ? `: ${(p.options ?? []).map((o) => JSON.stringify(o)).join(" | ")}` : ""}, default ${JSON.stringify(p.default)})${p.label ? ` ${p.label}` : ""}${p.description ? ` — ${p.description}` : ""}`).join("\n");
  const uses = (input.paramUses ?? []).filter((u) => Object.keys(u).length).slice(0, 6);
  return `- Params (exposed, edited per use): the manifest above already declares them; keep these keys, types and defaults (you may add "label"/"description"). ONE clip is reused with different values, so never hard-code them: read ctx.params.<key> in render() every frame (values can change while the user edits), and lay the picture out to fit any value (e.g. shrink long text to fit).
${list}${uses.length ? `\n- Values it is used with: ${uses.map((u) => JSON.stringify(u)).join("; ")}.` : ""}`;
}

/**
 * "Copy prompt" for an html asset: the brief COMBINED with the packaging instructions, filled with this asset's
 * values (duration, size, bindings to the referenced assets, allowed libraries). The short form links to the published
 * spec; `full` inlines the contract and a template for AIs that can't open links.
 */
export function htmlClipPackagePrompt(input: PackagePromptInput, opts: PackagePromptOptions): string {
  const m = promptManifest(input, opts.libs);
  const libs = opts.libs.length ? opts.libs.map((l) => `"${l.id}" (${l.name} ${l.version}, import from "${l.specifier}")`).join(", ") : "none";
  const binds = input.bindings?.length
    ? input.bindings.map((b) => `- "${b.name}" (${b.type})${b.label ? `: ${b.label}` : ""}${b.description ? ` — ${b.description}` : ""}. Use it as ctx.bindings["${b.name}"] (ctx.${b.type === "image" ? "image" : b.type === "video" ? "video" : "asset"}("${b.name}")). The user binds the real file in Dionysus; until then url is null, so draw a tasteful placeholder.`).join("\n")
    : "- None. Draw everything in code.";
  const head = `Make an animated HTML clip for the Dionysus video editor, as a "${HTML_CLIP_FORMAT}" HTML clip package (one self-contained .html file).

DESIGN BRIEF
${input.brief.trim() || "(no brief: design a clean animated graphic that fits the name)"}${input.context ? `\n\n${input.context.trim()}` : ""}

PACKAGE (${HTML_CLIP_FORMAT})${opts.full ? "" : `\n- Spec: ${opts.specUrl}`}
- Start the <head> with this manifest, keeping these values (you may add "description", "libs" and "params"):
<script type="application/json" id="dionysus-clip">${JSON.stringify(m)}</script>
- Length: ${input.durationSec ? `${input.durationSec} s` : "the timeline sets it"}; design the motion over ctx.duration (use ctx.progress), not a fixed number of seconds. Frame: ${m.width}×${m.height}${input.aspect ? ` (${input.aspect})` : ""}, but read ctx.width/ctx.height.
- Allowed libraries: ${libs}. List the ones you use in "libs". Nothing else can be loaded.
- Bindings (media from other assets):
${binds}
${paramLines(input)}${input.codeRefs?.length ? `
- Code references (other HTML clips of this film; the user attaches their .html files): reuse their look, helpers and motion language so the clips match. Don't load or embed them at runtime; copy what you need into this file.
${input.codeRefs.map((c) => `  - "${c.name}"${c.label ? ` (${c.label})` : ""}${c.brief ? `: ${c.brief.replace(/\s+/g, " ").trim().slice(0, 200)}` : ""}`).join("\n")}` : ""}
- Focus on the JavaScript: keep the HTML a minimal shell (the manifest, one <canvas>, one module script) and do the work in dionysus.clip's init/render with the runtime's ctx. Add more HTML or CSS only when the design truly needs it (only the canvas is captured).`;
  const rules = opts.full
    ? `\n\nRUNTIME CONTRACT\n${HTML_CLIP_CONTRACT}\n\nTEMPLATE (a complete, valid clip to start from)\n\`\`\`html\n${htmlClipTemplate(m)}\`\`\``
    : `\n\nRUNTIME CONTRACT (summary; read the spec first: ${opts.specUrl})
- Register dionysus.clip({ async init(ctx), render(t, ctx) }); render draws frame t (seconds) on ctx.canvas (the page's first <canvas>), sized ctx.width × ctx.height. Only that canvas is captured.
- Deterministic: each frame is a pure function of t, ctx.params and the bindings, in any order. No Date.now, performance.now, requestAnimationFrame, timers or unseeded Math.random.
- No network: only the allowed libraries; embed other files as data: URLs in the manifest's "files"; system fonts or embedded fonts.
- If you can't open the spec, don't guess: reply only "I can't open the spec — please paste the full Dionysus HTML clip prompt." (Dionysus → the asset → Copy full prompt).`;
  return `${head}${rules}

Reply with ONE \`\`\`html code block containing the whole file and nothing else. The user pastes it into Dionysus (the asset → Paste the AI's reply), which checks it against the package standard.`;
}
