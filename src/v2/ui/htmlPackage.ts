/**
 * Export and import of HTML clip packages (V2-HTML-PKG, docs/v2/HTML_CLIP_PACKAGE.md):
 *   - single file: one .html with the manifest inside (the canonical form, what versions store);
 *   - portable ZIP (`.dionysus-html.zip`): manifest.json, index.html, style.css, script.js and the embedded files
 *     as ordinary files, so the clip can be edited in any code editor and zipped again.
 * Import always produces the single-file form; `lintHtmlClip` then says whether it can be added.
 */
import { HTML_CLIP_FORMAT, HTML_CLIP_ZIP_SUFFIX, readManifest, writeManifest, type HtmlClipManifest } from "../domain";
import { BlobSink, readBlobBytes, readZipIndex, zipEntryBlob, ZipWriter } from "../persistence";
import { safeName } from "./saveFile";

export const HTML_IMPORT_ACCEPT = ".html,.htm,text/html,.zip,application/zip";
/** Largest package accepted on import. */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();
const DATA_RE = /^data:([^;,]*)(;base64)?,([\s\S]*)$/;

function dataToBytes(d: string): Uint8Array | undefined {
  const m = DATA_RE.exec(d);
  if (!m) return undefined;
  if (!m[2]) return enc.encode(decodeURIComponent(m[3]));
  const raw = atob(m[3]);
  const u = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
  return u;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  json: "application/json", csv: "text/csv", txt: "text/plain", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  glb: "model/gltf-binary", gltf: "model/gltf+json", bin: "application/octet-stream", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};
const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

async function blobToData(b: Blob, name: string): Promise<string> {
  const u = await readBlobBytes(b);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return `data:${mimeOf(name)};base64,${btoa(s)}`;
}

const isInline = (s: HTMLScriptElement) => !s.src && s.type !== "application/json" && s.type !== "importmap";
const serialize = (doc: Document) => `<!doctype html>\n${doc.documentElement.outerHTML}\n`;

/** File name for a clip's export, from its manifest name. */
export const packageBaseName = (html: string, fallback = "clip") => safeName(readManifest(html).name || fallback);

/** The single-file form (what versions store), with a "format" so it is a conforming package. */
export function exportHtmlFile(html: string): Blob {
  const m = readManifest(html);
  return new Blob([writeManifest(html, { ...m, format: m.format ?? HTML_CLIP_FORMAT })], { type: "text/html" });
}

/** Split the single-file form into the portable ZIP. */
export async function exportHtmlZip(html: string): Promise<Blob> {
  const m = readManifest(html);
  const { files = {}, ...meta } = m;
  const doc = new DOMParser().parseFromString(writeManifest(html, {}).trimEnd(), "text/html");
  const styles = [...doc.querySelectorAll("style")];
  const css = styles.map((s) => s.textContent ?? "").join("\n").trim();
  if (styles.length) {
    const link = doc.createElement("link"); link.rel = "stylesheet"; link.href = "style.css";
    styles[0].replaceWith(link); styles.slice(1).forEach((s) => s.remove());
  }
  const scripts = [...doc.querySelectorAll("script")].filter(isInline);
  // Same-type scripts merge into script.js; with mixed types only the last (main) script moves out.
  const moved = scripts.length && scripts.every((s) => s.type === scripts[0].type) ? scripts : scripts.slice(-1);
  const js = moved.map((s) => (s.textContent ?? "").trim()).join("\n");
  if (moved.length) {
    const tag = doc.createElement("script"); if (moved.at(-1)!.type) tag.type = moved.at(-1)!.type; tag.src = "script.js";
    moved.at(-1)!.replaceWith(tag); moved.slice(0, -1).forEach((s) => s.remove());
  }
  const sink = new BlobSink();
  const zip = new ZipWriter(sink);
  await zip.addBytes("manifest.json", enc.encode(`${JSON.stringify({ ...meta, format: meta.format ?? HTML_CLIP_FORMAT }, null, 2)}\n`));
  await zip.addBytes("index.html", enc.encode(serialize(doc)));
  if (styles.length) await zip.addBytes("style.css", enc.encode(`${css}\n`));
  if (moved.length) await zip.addBytes("script.js", enc.encode(`${js}\n`));
  for (const [name, d] of Object.entries(files)) {
    const bytes = dataToBytes(d);
    if (bytes && !["manifest.json", "index.html", "style.css", "script.js"].includes(name)) await zip.addBytes(name, bytes);
  }
  await zip.finish();
  return new Blob([sink.blob()], { type: "application/zip" });
}

export class PackageError extends Error {}

/** Read a ZIP package back into the single-file form. Tolerates one top-level folder (a zipped directory). */
export async function importHtmlZip(file: Blob): Promise<string> {
  const index = await readZipIndex(file);
  const names = [...index.keys()].filter((n) => !n.endsWith("/") && !/(^|\/)(__MACOSX|\.DS_Store)/.test(n));
  const htmlName = names.find((n) => /(^|\/)index\.html?$/i.test(n) && n.split("/").length <= 2) ?? names.find((n) => /\.html?$/i.test(n));
  if (!htmlName) throw new PackageError("The ZIP has no index.html.");
  const root = htmlName.includes("/") ? htmlName.slice(0, htmlName.lastIndexOf("/") + 1) : "";
  const local = new Map<string, string>();
  for (const n of names) if (n.startsWith(root)) local.set(n.slice(root.length), n);
  const text = async (rel: string) => dec.decode(await readBlobBytes(await zipEntryBlob(file, index.get(local.get(rel)!)!)));
  const html = await text(htmlName.slice(root.length));
  let fromJson: HtmlClipManifest | undefined;
  if (local.has("manifest.json")) {
    try { fromJson = JSON.parse(await text("manifest.json")) as HtmlClipManifest; } catch { throw new PackageError("manifest.json in the ZIP is not valid JSON."); }
  }
  const doc = new DOMParser().parseFromString(html.trimEnd(), "text/html"); // text after </html> would land in <body>
  const used = new Set([htmlName.slice(root.length), "manifest.json"]);
  const rel = (u: string | null) => (u ?? "").replace(/^\.\//, "");
  for (const l of [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]) {
    const r = rel(l.getAttribute("href"));
    if (!local.has(r)) continue;
    const st = doc.createElement("style"); st.textContent = (await text(r)).replace(/\n$/, ""); l.replaceWith(st); used.add(r);
  }
  for (const s of [...doc.querySelectorAll<HTMLScriptElement>("script[src]")]) {
    const r = rel(s.getAttribute("src"));
    if (!local.has(r)) continue;
    const st = doc.createElement("script"); if (s.type) st.type = s.type; st.textContent = (await text(r)).replace(/\n$/, ""); s.replaceWith(st); used.add(r);
  }
  const inline = readManifest(html);
  const files: Record<string, string> = { ...(inline.files ?? {}) };
  for (const [r, full] of local) if (!used.has(r)) files[r] = await blobToData(await zipEntryBlob(file, index.get(full)!), r);
  const m: HtmlClipManifest = { ...inline, ...(fromJson ?? {}), files };
  return writeManifest(serialize(doc).replace(/<script type="application\/json" id="dionysus-clip">[\s\S]*?<\/script>\s*/i, ""), m);
}

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

/** A dropped or picked file → the single-file HTML clip. */
export async function importHtmlPackage(file: File): Promise<string> {
  if (file.size > MAX_PACKAGE_BYTES) throw new PackageError(`${file.name} is over ${MAX_PACKAGE_BYTES / 1024 / 1024} MB.`);
  if (isZip(file)) return importHtmlZip(file);
  if (/\.html?$/i.test(file.name) || file.type === "text/html" || !file.type) return dec.decode(await readBlobBytes(file));
  throw new PackageError(`${file.name} is not an HTML clip (.html, or a ${HTML_CLIP_ZIP_SUFFIX} / .zip package).`);
}

export const isHtmlZipName = (name: string) => /\.zip$/i.test(name);

/** For media import: a ZIP package becomes its single-file .html (anything else is passed through unchanged). */
export async function clipFileFrom(file: File): Promise<File> {
  if (!isZip(file)) return file;
  if (file.size > MAX_PACKAGE_BYTES) throw new PackageError(`${file.name} is over ${MAX_PACKAGE_BYTES / 1024 / 1024} MB.`);
  const name = file.name.replace(/(\.dionysus-html)?\.zip$/i, "") + ".html";
  return new File([await importHtmlZip(file)], name, { type: "text/html" });
}
