import { libById, vendorUrl, type HtmlLibrary } from "./htmlLibs";

/**
 * P85 (Phase 3 step 3.3): the pinned libraries a plugin asks for (`render.libs`), made usable in its classic worker.
 * The vendored files are ES modules (the HTML clip registry, render/htmlLibs.ts); a classic worker can't import
 * modules, so the host fetches each file from this deployment, checks it against the registry's SRI hash, and rewrites
 * its single `import { … } from "three"` / `export { … }` statements into reads and writes of one global `THREE`
 * object, inside a strict-mode function scope. The worker gets the rewritten text (never a URL), so it needs no
 * network: `three` becomes `self.THREE`, and `three-gltf` adds `THREE.GLTFLoader`.
 */

/** The global a library's exports are merged into (all current entries are three.js and its addons). */
export const PLUGIN_LIB_GLOBAL = "THREE";

const binding = (spec: string, from: "import" | "export") => spec.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(x);
  if (!m) throw new Error(`can't rewrite ${from} binding "${x}"`);
  return { name: m[1], local: m[2] ?? m[1] };
});

/**
 * Rewrite an ES module whose only imports are named imports from registry specifiers and whose only export is one
 * trailing `export { … }` list into a classic script. Throws on anything else (dynamic import, import.meta, default
 * or star exports), so a new vendored file that doesn't fit fails its test instead of breaking plugins.
 */
export function moduleToClassic(src: string, specifiers: readonly string[], global = PLUGIN_LIB_GLOBAL): string {
  let out = src.replace(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;?/g, (_all, list: string, from: string) => {
    if (!specifiers.includes(from)) throw new Error(`import from "${from}" is not a pinned library`);
    return `const{${binding(list, "import").map((b) => `${b.name}:${b.local}`).join(",")}}=self.${global};`;
  });
  const exports = [...out.matchAll(/export\s*\{([^}]*)\}\s*;?/g)];
  if (exports.length !== 1) throw new Error(`expected one export list, found ${exports.length}`);
  const ex = exports[0];
  if (out.slice(ex.index! + ex[0].length).trim()) throw new Error("the export list is not the last statement");
  out = out.slice(0, ex.index) + `Object.assign(self.${global}||(self.${global}={}),{${binding(ex[1], "export").map((b) => `${b.local}:${b.name}`).join(",")}});`;
  if (/\bimport\s*\(|\bimport\.meta\b|\bexport\s+(default|\*|const|let|var|function|class)\b|(^|[;}\s])import\s*[{*"]|(^|[;}\s])import\s+[\w$]+\s*(,|from\b)/.test(out)) throw new Error("module syntax left after rewriting");
  return `(function(){"use strict";\n${out}\n})();\n`;
}

/** The libraries to load for `ids`, dependencies first, each once (unknown and editor-only ids are skipped). */
export function pluginLibraries(ids: readonly string[]): HtmlLibrary[] {
  const out: HtmlLibrary[] = [];
  const add = (id: string) => {
    const l = libById(id);
    if (!l || l.editorOnly || out.includes(l)) return;
    for (const r of l.requires ?? []) add(r);
    out.push(l);
  };
  ids.forEach(add);
  return out;
}

const b64 = (buf: ArrayBuffer) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

/** Check bytes against an SRI string (`sha384-…` / `sha256-…` / `sha512-…`). */
export async function matchesIntegrity(bytes: ArrayBuffer, integrity: string): Promise<boolean> {
  const m = /^sha(256|384|512)-(.+)$/.exec(integrity.trim());
  if (!m) return false;
  return b64(await crypto.subtle.digest(`SHA-${m[1]}`, bytes)) === m[2];
}

const cache = new Map<string, Promise<string>>();

/** The classic-script text of each library `ids` needs (fetched once per page, SRI-checked, rewritten). */
export function loadPluginLibs(ids: readonly string[], fetchFn: typeof fetch = (...a) => fetch(...a), url: (l: HtmlLibrary) => string = (l) => vendorUrl(l.path)): Promise<string[]> {
  const specs = pluginLibraries(["three", "three-gltf"]).map((l) => l.specifier);
  return Promise.all(pluginLibraries(ids).map((l) => {
    let p = cache.get(l.id);
    if (!p) {
      p = (async () => {
        const r = await fetchFn(url(l), { credentials: "omit" });
        if (!r.ok) throw new Error(`The library ${l.name} couldn't be loaded (HTTP ${r.status}).`);
        const bytes = await r.arrayBuffer();
        if (!(await matchesIntegrity(bytes, l.integrity))) throw new Error(`The library ${l.name} doesn't match its pinned hash.`);
        return moduleToClassic(new TextDecoder().decode(bytes), specs);
      })();
      p.catch(() => cache.delete(l.id));
      cache.set(l.id, p);
    }
    return p;
  }));
}
