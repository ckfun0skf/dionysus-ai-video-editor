/**
 * P82 (scene editor follow-up): Script objects' code, as text. A script object (`script: { file, params? }` in
 * `dionysus.scene/1`) names a JavaScript file in the scene's `files` (a data: URL, like a GLB model). The file is an ES
 * module that exports
 *
 *   build(THREE, params, ctx)          → a THREE.Object3D (called once, when the page is built; may be async)
 *   update(obj, t, params, ctx)        → optional; called every frame with scene time t. It must be a pure function of
 *                                        t (and params): it sets the object from t alone, never from the frame before,
 *                                        so any seek order, preview and export give the same picture.
 *
 * `ctx` has `id` (the object's id), `random(seed?)` (a new seeded random generator: the same numbers every time for
 * one object and seed) and `makeCanvas(w, h)` (an OffscreenCanvas, e.g. for a CanvasTexture). Scripts can't import:
 * THREE is passed in. They run only in the sandboxed scene page (opaque origin, the clip CSP), never in the editor.
 *
 * Pure: no DOM, no three.js. The checks here are static (size, imports, the build export, syntax); the page reports
 * what happens when the script runs (errors, time limits).
 */

/** Largest script file (characters of code). */
export const SCENE_SCRIPT_MAX = 256 * 1024;
/** A script object's params: name → number, text or switch. */
export type SceneScriptParams = Record<string, number | string | boolean>;
export const SCRIPT_PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The code as a data: URL (UTF-8, base64), as stored in the scene's `files`. */
export function scriptDataUrl(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:text/javascript;charset=utf-8;base64,${btoa(bin)}`;
}

/** The text of a data: URL (base64 or percent-encoded; UTF-8), or undefined when it isn't one. */
export function scriptCodeOf(dataUrl: unknown): string | undefined {
  if (typeof dataUrl !== "string") return undefined;
  const m = /^data:([^,]*?),([\s\S]*)$/.exec(dataUrl);
  if (!m) return undefined;
  try {
    if (!/;base64/i.test(m[1])) return decodeURIComponent(m[2]);
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

const IMPORT_RE = /^[ \t]*import\s*(?:[\w*{$]|["'])|\bimport\s*\(/m;
const BUILD_RE = /\bexport\s+(?:async\s+)?function\s*\*?\s*build\s*\(|\bexport\s+(?:const|let|var)\s+build\s*=|\bexport\s*\{[^}]*\bbuild\b[^}]*\}/;
const syntaxCache = new Map<string, string | undefined>();

/**
 * A syntax error in the code ("Line n: message"), or undefined. The code is compiled (never run) as the body of an
 * async function with `export` keywords removed, like the Code clip editor's check.
 */
export function scriptSyntaxProblem(code: string): string | undefined {
  if (syntaxCache.has(code)) return syntaxCache.get(code);
  let out: string | undefined;
  const body = code.replace(/^([ \t]*)export\s+(?:default\s+)?/gm, "$1").replace(/\bexport\s*\{[^}]*\};?/g, "");
  try {
    const AsyncFn = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => unknown;
    new AsyncFn(body);
  } catch (e) {
    const err = e as Error & { lineNumber?: number };
    out = `${typeof err.lineNumber === "number" ? `Line ${err.lineNumber - 2}: ` : ""}${err.message}`;
  }
  if (syntaxCache.size > 64) syntaxCache.clear();
  syntaxCache.set(code, out);
  return out;
}

/** Static problems with a script's code (each one makes the page draw the object's fallback shape). */
export function scriptProblems(code: string): string[] {
  const out: string[] = [];
  if (code.length > SCENE_SCRIPT_MAX) out.push(`The script is longer than ${SCENE_SCRIPT_MAX / 1024} KB.`);
  if (IMPORT_RE.test(code)) out.push("Scripts can't import modules: build(THREE, params, ctx) gets three.js as THREE.");
  if (!BUILD_RE.test(code)) out.push("The script must export a build(THREE, params, ctx) function that returns a THREE.Object3D.");
  const syntax = scriptSyntaxProblem(code);
  if (syntax) out.push(`Syntax error: ${syntax}`);
  return out;
}

/** Problem with a params object, or undefined. */
export function scriptParamsProblem(v: unknown): string | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "must be an object of name → number, text or true / false";
  for (const [k, x] of Object.entries(v)) {
    if (!SCRIPT_PARAM_RE.test(k)) return `has a param name "${k}" that is not a plain name (letters, digits, "_")`;
    if (typeof x === "number" ? !Number.isFinite(x) : typeof x === "string" ? x.length > 2000 : typeof x !== "boolean") return `has a value for "${k}" that is not a number, text (up to 2000 characters) or true / false`;
  }
  return undefined;
}
