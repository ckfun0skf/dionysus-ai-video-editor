/**
 * Clip type plugin manifest, `dionysus.cliptype/1` (Phase 3, P83). Spec and author guide: docs/v2/PLUGIN_PACKAGE.md;
 * design and decisions: docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §0 (decisions 10–17) and §7 Phase 3.
 *
 * A plugin package is a folder (zipped as `<name>.dionysus-cliptype.zip`, or served next to its manifest.json) with:
 *   - `manifest.json`: this format (id, version, caps, params, a declarative editor form, agent hints, files),
 *   - a render entry (a classic script calling `dionysus.clip({ init?(ctx), render(t, ctx) })`), run by the host in a
 *     sandboxed worker that draws on an OffscreenCanvas,
 *   - the files it lists (fonts, images, data).
 * The host owns everything else: the core rules are built from this manifest (data, not code), and v1 plugins are
 * visual only (no sound, no source time, no project media), with no agent tools or free-form AI rules of their own.
 *
 * This module is pure (no DOM, no render imports): validation with JSON paths, parsing, the package file check and
 * version comparison. The allowed library ids come from the host (render/htmlLibs.ts) as an argument.
 */
import { PARAM_TYPES, checkParamValue, cleanParamDecls, validateParamDecls, type HtmlClipParam, type HtmlParamValue } from "./htmlClipPackage";

export const PLUGIN_FORMAT = "dionysus.cliptype/1";
/** Host API version a manifest may ask for; a higher `api` needs a newer build. */
export const PLUGIN_API = 1;
export const PLUGIN_ZIP_SUFFIX = ".dionysus-cliptype.zip";
export const PLUGIN_MANIFEST_FILE = "manifest.json";
/** Decision 13: third-party ids start with `x-`, so they never clash with a built-in; same charset as built-in ids. */
export const PLUGIN_ID_RE = /^x-[a-z0-9][a-z0-9-]*$/;
export const PLUGIN_ID_MAX = 64;
/** Semantic version `MAJOR.MINOR.PATCH` with an optional pre-release tag. */
export const PLUGIN_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
/** Monochrome line icons the host draws for a plugin (mapped to lucide icons in the UI); absent = "puzzle". */
export const PLUGIN_ICONS = ["puzzle", "sparkles", "shapes", "type", "chart", "waves", "grid", "box", "star", "sun"] as const;
export type PluginIcon = (typeof PLUGIN_ICONS)[number];
export const PLUGIN_LIMITS = {
  name: 60, publisher: 60, description: 300, files: 64, path: 128, maxDurationSec: 600, groups: 12, groupLabel: 40,
  agentDescription: 500, examples: 5, exampleDescription: 200, params: 32,
  /** Package size caps, checked by the loader (P84) on the real bytes. */
  fileBytes: 10 * 1024 * 1024, packageBytes: 20 * 1024 * 1024,
} as const;

export interface PluginEditorGroup { label: string; fields: string[] }
export interface PluginExample { description: string; params?: Record<string, HtmlParamValue> }
export interface PluginManifest {
  format: typeof PLUGIN_FORMAT;
  api?: number;
  id: string;
  name: string;
  version: string;
  publisher?: string;
  description?: string;
  homepage?: string;
  icon?: PluginIcon;
  /** v1: always "video". */
  trackKind?: "video";
  /** v1: only `visual` (always true) and `keyable`. */
  caps?: { visual?: true; keyable?: boolean };
  /** Length of a new clip, in seconds (default 5). */
  durationSec?: number;
  render: { entry: string; libs?: string[] };
  /** Same shape as HTML clip params (docs/v2/HTML_CLIP_PACKAGE.md). */
  params?: Record<string, HtmlClipParam>;
  /** Declarative editor form: ordered groups of param keys; the host draws the controls. */
  editor?: { groups: PluginEditorGroup[] };
  /** Structured AI hints only (decision 14): shown to agents next to the params, fenced as third-party text. */
  agent?: { description?: string; examples?: PluginExample[] };
  /** Every file in the package except manifest.json, as relative paths; must include the render entry. */
  files: string[];
}

export interface PluginIssue { level: "error" | "warning"; path: string; message: string }
export interface PluginValidateOptions { libs?: readonly string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KNOWN = ["format", "api", "id", "name", "version", "publisher", "description", "homepage", "icon", "trackKind", "caps", "durationSec", "render", "params", "editor", "agent", "files"];
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const keyPath = (base: string, k: string) => (/^[A-Za-z_][\w]*$/.test(k) ? `${base}.${k}` : `${base}[${JSON.stringify(k)}]`);

/** Is `p` a safe relative file path inside a package ("render.js", "fonts/a.woff2"; no "..", no leading "/")? */
export function isPluginFilePath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > PLUGIN_LIMITS.path || p === PLUGIN_MANIFEST_FILE) return false;
  return p.split("/").every((s) => SEGMENT_RE.test(s) && s !== "." && s !== "..");
}

/**
 * Validate a `dionysus.cliptype/1` manifest. Errors make the package unusable; warnings are shown at install.
 * Every issue names the JSON path it is about (`params.count.default`, `editor.groups[0].fields[1]`, "" for the root).
 */
export function validatePluginManifest(raw: unknown, opts: PluginValidateOptions = {}): PluginIssue[] {
  const out: PluginIssue[] = [];
  const err = (path: string, message: string) => out.push({ level: "error", path, message });
  const warn = (path: string, message: string) => out.push({ level: "warning", path, message });
  if (!isObj(raw)) { err("", "The manifest must be a JSON object."); return out; }
  const m = raw;
  const str = (k: string, max: number, required = false) => {
    const v = m[k];
    if (v === undefined) { if (required) err(k, `"${k}" is required.`); return; }
    if (typeof v !== "string" || !v.trim()) err(k, `"${k}" must be a non-empty string.`);
    else if (v.length > max) err(k, `"${k}" is ${v.length} characters; the most is ${max}.`);
  };

  if (m.format !== PLUGIN_FORMAT) err("format", `"format" must be "${PLUGIN_FORMAT}".`);
  if (m.api !== undefined) {
    if (!Number.isInteger(m.api) || (m.api as number) < 1) err("api", `"api" must be a whole number from 1.`);
    else if ((m.api as number) > PLUGIN_API) err("api", `This plugin needs a newer Dionysus (host API ${m.api as number}; this build has ${PLUGIN_API}). Update Dionysus to use it.`);
  }
  if (typeof m.id !== "string") err("id", `"id" is required: a lower-case id starting with "x-", e.g. "x-acme-confetti".`);
  else if (!PLUGIN_ID_RE.test(m.id)) err("id", `"id" "${m.id}" must start with "x-" and use only a–z, 0–9 and "-" (e.g. "x-acme-confetti").`);
  else if (m.id.length > PLUGIN_ID_MAX) err("id", `"id" is ${m.id.length} characters; the most is ${PLUGIN_ID_MAX}.`);
  str("name", PLUGIN_LIMITS.name, true);
  if (m.version === undefined) err("version", `"version" is required, e.g. "1.0.0".`);
  else if (typeof m.version !== "string" || !PLUGIN_VERSION_RE.test(m.version)) err("version", `"version" must be a semantic version like "1.2.0" or "2.0.0-beta.1".`);
  str("publisher", PLUGIN_LIMITS.publisher);
  str("description", PLUGIN_LIMITS.description);
  if (m.homepage !== undefined && !(typeof m.homepage === "string" && /^https:\/\/[^\s]+$/.test(m.homepage))) err("homepage", `"homepage" must be an https:// URL.`);
  if (m.icon !== undefined && !(PLUGIN_ICONS as readonly string[]).includes(String(m.icon))) err("icon", `"icon" must be one of ${PLUGIN_ICONS.map((i) => `"${i}"`).join(", ")}.`);
  if (m.trackKind !== undefined && m.trackKind !== "video") err("trackKind", `"trackKind" must be "video": plugins are visual clips in this version.`);

  if (m.caps !== undefined) {
    if (!isObj(m.caps)) err("caps", `"caps" must be an object: { "keyable"?: boolean }.`);
    else for (const [k, v] of Object.entries(m.caps)) {
      const p = keyPath("caps", k);
      if (k === "visual") { if (v !== true) err(p, `"visual" can only be true: plugins draw a picture.`); }
      else if (k === "keyable") { if (typeof v !== "boolean") err(p, `"keyable" must be true or false.`); }
      else if (k === "sound") err(p, `Plugins can't play sound in this version; remove "sound".`);
      else if (k === "sourceTime" || k === "asset" || k === "still" || k === "thumb") err(p, `"${k}" is set by the host for plugins; remove it.`);
      else warn(p, `Unknown capability "${k}" is ignored.`);
    }
  }
  if (m.durationSec !== undefined && !(typeof m.durationSec === "number" && m.durationSec > 0 && m.durationSec <= PLUGIN_LIMITS.maxDurationSec)) {
    err("durationSec", `"durationSec" must be a number of seconds above 0 and at most ${PLUGIN_LIMITS.maxDurationSec}.`);
  }

  // Files first, so the render entry can be checked against them.
  const files = new Set<string>();
  if (!Array.isArray(m.files)) err("files", `"files" is required: the list of files in the package besides manifest.json, e.g. ["render.js"].`);
  else {
    if (m.files.length > PLUGIN_LIMITS.files) err("files", `A package may have at most ${PLUGIN_LIMITS.files} files; this one lists ${m.files.length}.`);
    m.files.forEach((f, i) => {
      if (!isPluginFilePath(f)) err(`files[${i}]`, `${JSON.stringify(f)} is not a safe relative path (letters, digits, "._-", "/" between folders; no "..", no leading "/", not manifest.json).`);
      else if (files.has(f)) err(`files[${i}]`, `"${f}" is listed twice.`);
      else files.add(f);
    });
  }
  if (!isObj(m.render)) err("render", `"render" is required: { "entry": "render.js", "libs"?: ["three"] }.`);
  else {
    const e = m.render.entry;
    if (!isPluginFilePath(e)) err("render.entry", `"render.entry" must be the relative path of a script in the package, e.g. "render.js".`);
    else if (!/\.js$/.test(e)) err("render.entry", `"render.entry" must be a .js file.`);
    else if (Array.isArray(m.files) && !files.has(e)) err("render.entry", `"${e}" is not listed in "files".`);
    const libs = m.render.libs;
    if (libs !== undefined) {
      if (!Array.isArray(libs)) err("render.libs", `"render.libs" must be a list of library ids.`);
      else libs.forEach((l, i) => {
        if (opts.libs && !opts.libs.includes(String(l))) err(`render.libs[${i}]`, `Unknown library ${JSON.stringify(l)}. Allowed: ${opts.libs.map((x) => `"${x}"`).join(", ") || "none"}.`);
        else if (typeof l !== "string") err(`render.libs[${i}]`, `Library ids are strings.`);
      });
    }
    for (const k of Object.keys(m.render)) if (k !== "entry" && k !== "libs") warn(keyPath("render", k), `Unknown field "${k}" is ignored.`);
  }

  // Params: same rules as HTML clip params, reported per key with a path.
  const params = isObj(m.params) ? cleanParamDecls(m.params) : {};
  if (m.params !== undefined) {
    if (!isObj(m.params)) err("params", `"params" must be an object: { "<key>": { "type": ${PARAM_TYPES.map((t) => `"${t}"`).join(" | ")}, "default": … } }.`);
    else {
      const keys = Object.keys(m.params);
      if (keys.length > PLUGIN_LIMITS.params) err("params", `At most ${PLUGIN_LIMITS.params} params; this manifest has ${keys.length}.`);
      for (const k of keys) for (const i of validateParamDecls({ [k]: m.params[k] })) {
        const sub = i.code === "param-type" ? ".type" : i.code === "param-default" ? (/"options"/.test(i.message) && !/"default"/.test(i.message) ? ".options" : ".default") : i.code === "param-label" ? (/"description"/.test(i.message) ? ".description" : ".label") : "";
        out.push({ level: i.level, path: keyPath("params", k) + sub, message: i.message });
      }
    }
  }

  if (m.editor !== undefined) {
    if (!isObj(m.editor) || !Array.isArray(m.editor.groups)) err("editor", `"editor" must be { "groups": [{ "label": "…", "fields": ["<param key>", …] }] }.`);
    else {
      const groups = m.editor.groups as unknown[];
      if (groups.length > PLUGIN_LIMITS.groups) err("editor.groups", `At most ${PLUGIN_LIMITS.groups} groups.`);
      const placed = new Set<string>();
      groups.forEach((g, gi) => {
        const gp = `editor.groups[${gi}]`;
        if (!isObj(g)) { err(gp, `A group is { "label": "…", "fields": [ … ] }.`); return; }
        if (typeof g.label !== "string" || !g.label.trim()) err(`${gp}.label`, `"label" must be a non-empty string.`);
        else if (g.label.length > PLUGIN_LIMITS.groupLabel) err(`${gp}.label`, `"label" is at most ${PLUGIN_LIMITS.groupLabel} characters.`);
        if (!Array.isArray(g.fields) || !g.fields.length) { err(`${gp}.fields`, `"fields" must be a non-empty list of param keys.`); return; }
        g.fields.forEach((f, fi) => {
          const fp = `${gp}.fields[${fi}]`;
          if (typeof f !== "string" || !isObj(m.params) || !(f in m.params)) err(fp, `${JSON.stringify(f)} is not a declared param.`);
          else if (placed.has(f)) err(fp, `"${f}" is already in another place in the form; list each param once.`);
          else placed.add(f);
        });
        for (const k of Object.keys(g)) if (k !== "label" && k !== "fields") warn(keyPath(gp, k), `Unknown field "${k}" is ignored; the form is declarative (labels and param keys only).`);
      });
      if (isObj(m.params)) for (const k of Object.keys(m.params)) if (!placed.has(k)) warn(keyPath("params", k), `Param "${k}" is in no editor group; it is shown under "More".`);
    }
    if (isObj(m.editor)) for (const k of Object.keys(m.editor)) if (k !== "groups") err(keyPath("editor", k), `"editor" only takes "groups": plugins can't add their own editor UI.`);
  }

  if (m.agent !== undefined) {
    if (!isObj(m.agent)) err("agent", `"agent" must be { "description"?: "…", "examples"?: [ … ] }.`);
    else {
      const a = m.agent;
      if (a.description !== undefined) {
        if (typeof a.description !== "string" || !a.description.trim()) err("agent.description", `"description" must be a non-empty string.`);
        else if (a.description.length > PLUGIN_LIMITS.agentDescription) err("agent.description", `"description" is at most ${PLUGIN_LIMITS.agentDescription} characters.`);
      }
      if (a.examples !== undefined) {
        if (!Array.isArray(a.examples)) err("agent.examples", `"examples" must be a list of { "description", "params"? }.`);
        else {
          if (a.examples.length > PLUGIN_LIMITS.examples) err("agent.examples", `At most ${PLUGIN_LIMITS.examples} examples.`);
          a.examples.forEach((ex, i) => {
            const ep = `agent.examples[${i}]`;
            if (!isObj(ex)) { err(ep, `An example is { "description": "…", "params"?: { … } }.`); return; }
            if (typeof ex.description !== "string" || !ex.description.trim()) err(`${ep}.description`, `"description" must be a non-empty string.`);
            else if (ex.description.length > PLUGIN_LIMITS.exampleDescription) err(`${ep}.description`, `"description" is at most ${PLUGIN_LIMITS.exampleDescription} characters.`);
            if (ex.params !== undefined) {
              if (!isObj(ex.params)) err(`${ep}.params`, `"params" must be an object of param values.`);
              else for (const [k, v] of Object.entries(ex.params)) {
                const pp = keyPath(`${ep}.params`, k);
                const spec = params[k];
                if (!spec) { err(pp, `"${k}" is not a declared param.`); continue; }
                const c = checkParamValue(spec, v);
                if (c.problem) err(pp, c.clamped ? `"${k}": ${c.problem}.` : `"${k}" ${c.problem}.`);
              }
            }
            for (const k of Object.keys(ex)) if (k !== "description" && k !== "params") warn(keyPath(ep, k), `Unknown field "${k}" is ignored.`);
          });
        }
      }
      for (const k of Object.keys(a)) {
        if (k === "rules") err("agent.rules", `Plugins can't add AI rules; describe the clip in "agent.description" and "agent.examples".`);
        else if (k === "tools") err("agent.tools", `Plugins can't add agent tools; agents use the host's plugin tools with your params.`);
        else if (k !== "description" && k !== "examples") warn(keyPath("agent", k), `Unknown field "${k}" is ignored.`);
      }
    }
  }

  for (const k of Object.keys(m)) {
    if (KNOWN.includes(k)) continue;
    if (k === "storyboard") err(k, `Storyboard plugin shots come in a later version; remove "storyboard".`);
    else if (k === "inputs" || k === "bindings") err(k, `Plugins can't read project media in this version; remove "${k}".`);
    else warn(k, `Unknown field "${k}" is ignored.`);
  }
  return out;
}

/** Parse manifest.json text. `manifest` is set only when there are no errors. */
export function parsePluginManifest(text: string, opts: PluginValidateOptions = {}): { manifest?: PluginManifest; issues: PluginIssue[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { issues: [{ level: "error", path: "", message: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] }; }
  const issues = validatePluginManifest(raw, opts);
  return issues.some((i) => i.level === "error") ? { issues } : { manifest: raw as PluginManifest, issues };
}

/**
 * Compare a manifest with the files actually in a package (zip entries or fetched names, without manifest.json):
 * every listed file must be there; extra files are ignored with a warning (they are not stored or served).
 */
export function checkPluginFiles(manifest: Pick<PluginManifest, "files">, present: readonly string[]): PluginIssue[] {
  const out: PluginIssue[] = [];
  const have = new Set(present);
  manifest.files.forEach((f, i) => { if (!have.has(f)) out.push({ level: "error", path: `files[${i}]`, message: `"${f}" is listed but not in the package.` }); });
  const listed = new Set(manifest.files);
  for (const f of present) if (f !== PLUGIN_MANIFEST_FILE && !listed.has(f)) out.push({ level: "warning", path: "files", message: `"${f}" is in the package but not listed; it is ignored.` });
  return out;
}

/** Semantic version order: negative when a < b, 0 when equal, positive when a > b (pre-releases sort first). */
export function comparePluginVersions(a: string, b: string): number {
  const pa = PLUGIN_VERSION_RE.exec(a), pb = PLUGIN_VERSION_RE.exec(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 1; i <= 3; i++) { const d = Number(pa[i]) - Number(pb[i]); if (d) return d; }
  const ra = pa[4], rb = pb[4];
  if (ra === rb) return 0;
  if (ra === undefined) return 1;
  if (rb === undefined) return -1;
  const sa = ra.split("."), sb = rb.split(".");
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i], y = sb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
