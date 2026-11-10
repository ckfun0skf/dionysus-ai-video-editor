/** P57: classify an attached Code Editor file and turn its data: URL into previewable bytes. */

export type PreviewKind = "image" | "video" | "audio" | "model" | "text" | "other";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "oga", "weba"]);
const MODEL_EXT = new Set(["glb", "gltf"]);
const TEXT_EXT = new Set(["txt", "json", "js", "mjs", "cjs", "css", "html", "htm", "xml", "csv", "md"]);
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", oga: "audio/ogg", weba: "audio/webm",
  glb: "model/gltf-binary", gltf: "model/gltf+json", bin: "application/octet-stream", hdr: "image/vnd.radiance",
  json: "application/json", js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", css: "text/css",
  html: "text/html", htm: "text/html", txt: "text/plain", csv: "text/csv", xml: "application/xml", md: "text/markdown",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function mimeFromDataUrl(data: string): string {
  const m = /^data:([^;,]+)/i.exec(data);
  return (m?.[1] ?? "").toLowerCase();
}

export function mimeOf(name: string, data = ""): string {
  return mimeFromDataUrl(data) || EXT_MIME[fileExt(name)] || "application/octet-stream";
}

/** Which preview renderer a file should use (extension first; data: MIME as fallback). */
export function previewKind(name: string, data = ""): PreviewKind {
  const ext = fileExt(name);
  const mime = mimeFromDataUrl(data);
  if (MODEL_EXT.has(ext) || mime === "model/gltf-binary" || mime === "model/gltf+json") return "model";
  if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) return "image";
  if (VIDEO_EXT.has(ext) || mime.startsWith("video/")) return "video";
  if (AUDIO_EXT.has(ext) || mime.startsWith("audio/")) return "audio";
  if (TEXT_EXT.has(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/javascript") return "text";
  return "other";
}

export function kindLabel(kind: PreviewKind): string {
  return { image: "Image", video: "Video", audio: "Audio", model: "3D model", text: "Text", other: "File" }[kind];
}

export function dataUrlBytes(data: string): number {
  const comma = data.indexOf(",");
  if (comma < 0) return 0;
  return Math.round((data.length - comma - 1) * (data.slice(0, comma).includes(";base64") ? 0.75 : 1));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function dataUrlToBlob(data: string): Blob {
  const comma = data.indexOf(",");
  if (comma < 0 || !data.startsWith("data:")) throw new Error("Couldn't read this file.");
  const header = data.slice(0, comma);
  const body = data.slice(comma + 1);
  const mime = mimeFromDataUrl(data) || "application/octet-stream";
  if (/;base64/i.test(header)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

export function objectUrlFromDataUrl(data: string): string {
  return URL.createObjectURL(dataUrlToBlob(data));
}

export function decodeTextDataUrl(data: string): string {
  const comma = data.indexOf(",");
  if (comma < 0 || !data.startsWith("data:")) throw new Error("Couldn't read this file as text.");
  const header = data.slice(0, comma);
  const body = data.slice(comma + 1);
  if (/;base64/i.test(header)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  return decodeURIComponent(body);
}

const fileKey = (name: string) => name.replace(/[^\w.-]+/g, "-");

/** Basename of a glTF URI (`buffers/foo.bin`, `./foo.bin?x`). */
export function uriFileName(uri: string): string {
  const stripped = uri.split("#")[0].split("?")[0];
  try { return decodeURIComponent(stripped.split("/").pop() || stripped); }
  catch { return stripped.split("/").pop() || stripped; }
}

export function findAttachedName(files: Record<string, string>, uri: string): string | undefined {
  if (uri.startsWith("data:") || uri.startsWith("blob:")) return undefined;
  const base = uriFileName(uri);
  if (files[base]) return base;
  const keyed = fileKey(base);
  if (files[keyed]) return keyed;
  const lower = base.toLowerCase();
  return Object.keys(files).find((k) => k.toLowerCase() === lower || fileKey(k).toLowerCase() === fileKey(base).toLowerCase());
}

function collectUris(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object" || !("uri" in item)) return [];
    const uri = (item as { uri?: unknown }).uri;
    return typeof uri === "string" && uri && !uri.startsWith("data:") ? [uri] : [];
  });
}

/** External buffer/image URIs a .gltf JSON refers to (not data: URLs). */
export function gltfExternalUris(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const doc = json as { buffers?: unknown; images?: unknown };
  return [...new Set([...collectUris(doc.buffers), ...collectUris(doc.images)])];
}

export function missingGltfExternals(gltfText: string, files: Record<string, string>): string[] {
  let json: unknown;
  try { json = JSON.parse(gltfText); }
  catch { throw new Error("Couldn't read this glTF file."); }
  return gltfExternalUris(json).filter((uri) => !findAttachedName(files, uri)).map(uriFileName);
}

export function missingGltfMessage(missing: string[]): string {
  if (!missing.length) return "";
  const quoted = missing.map((n) => `"${n}"`);
  const list = quoted.length === 1 ? quoted[0] : quoted.length === 2 ? `${quoted[0]} and ${quoted[1]}` : `${quoted.slice(0, -1).join(", ")}, and ${quoted[quoted.length - 1]}`;
  return `This glTF needs ${list} attached as well, or use a .glb.`;
}

export function meshStats(scene: { traverse: (fn: (obj: { isMesh?: boolean; geometry?: { index?: { count: number }; attributes?: { position?: { count: number } } } }) => void) => void }): { meshes: number; triangles: number } {
  let meshes = 0, triangles = 0;
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    meshes += 1;
    const g = obj.geometry;
    triangles += g.index ? g.index.count / 3 : (g.attributes?.position?.count ?? 0) / 3;
  });
  return { meshes, triangles: Math.round(triangles) };
}
