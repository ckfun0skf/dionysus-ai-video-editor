import { readManifest, writeManifest, type ClipLibrary, type HtmlClipManifest } from "../domain";
/**
 * Library registry for HTML clips. Each entry is a self-hosted (public/vendor) ES module pinned by SRI.
 * A clip opts in per library; the import map and CSP allowlist are generated from the selection only.
 * Add a library = vendor the file, add one entry here (and its SRI test runs automatically).
 */
export interface HtmlLibrary {
  id: string;
  name: string;
  version: string;
  /** Bare specifier the page imports, e.g. `import * as X from "<specifier>"`. */
  specifier: string;
  /** Path under the deployment base (public/). */
  path: string;
  integrity: string;
  license?: string;
  /** Old CDN URLs that should resolve to this pinned copy. */
  legacy?: RegExp;
}

export const HTML_LIBRARIES: readonly HtmlLibrary[] = [
  {
    id: "three", name: "three.js", version: "0.160.0", specifier: "three",
    path: "vendor/three-0.160.0.module.min.js",
    integrity: "sha384-8/hf5tabFfIo0BPku31TKUvGIKpWGYaMwNtlSNqNyZzXgZCMd4lnOGWbJElML9dv",
    license: "vendor/three-LICENSE.txt",
    legacy: /https:\/\/unpkg\.com\/three@[\d.]+\/build\/three\.module(?:\.min)?\.js/g,
  },
];

export const libById = (id: string) => HTML_LIBRARIES.find((l) => l.id === id);

/** Absolute URL of a vendored file for this deployment (the opaque-origin iframe needs absolute URLs). */
export function vendorUrl(path: string, base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/", href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base}${path}`, href).href;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Libraries a page uses when it has no explicit selection: any registry specifier it imports (or legacy URL). */
export function detectLibraries(html: string): string[] {
  return HTML_LIBRARIES.filter((l) => new RegExp(`(?:from|import)\\s*\\(?\\s*["']${esc(l.specifier)}["']`).test(html) || (l.legacy && new RegExp(l.legacy.source).test(html))).map((l) => l.id);
}

/**
 * Per-clip settings: the clip's `dionysus.htmlclip/1` manifest (domain/htmlClipPackage.ts), stored inside the HTML so
 * versions, undo and project export carry it unchanged. `assets` is the pre-V2-HTML-PKG name of `files`; it is read
 * as `files` and written as `files`.
 */
export type ClipConfig = HtmlClipManifest & { assets?: Record<string, string> };

export const readClipConfig = (html: string): HtmlClipManifest => readManifest(html);

export function writeClipConfig(html: string, cfg: ClipConfig): string {
  const { assets, ...rest } = cfg;
  return writeManifest(html, { ...rest, files: rest.files ?? assets });
}

/** The registry's public part, for validation and AI prompts (domain code never sees vendor paths). */
export const CLIP_LIBRARIES: readonly ClipLibrary[] = HTML_LIBRARIES.map(({ id, name, version, specifier, legacy }) => ({ id, name, version, specifier, legacy }));

/** Selected libraries: the explicit selection, else whatever the page imports. */
export const selectedLibraries = (html: string): HtmlLibrary[] => (readClipConfig(html).libs ?? detectLibraries(html)).map(libById).filter((l): l is HtmlLibrary => !!l);
