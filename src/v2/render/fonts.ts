/**
 * P7-FONTS: register the bundled (OFL, self-hosted) fonts with the document so canvas text can use them. The files are
 * served from the app's own public/fonts/ (relative to the deployed base, never a hard-coded host), so preview and
 * export work offline once the app is cached and never fetch a font from a third party. Export awaits `loadBundledFonts`
 * before its first frame so every frame uses the real face (preview == export).
 */
import { FONTS, type FontDef } from "../registry";

let pending: Promise<void> | undefined;

/** URL of a bundled font file, relative to the app's base (import.meta.env.BASE_URL under Vite). */
export function bundledFontUrl(file: string): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}fonts/${file}`;
}

/** The bundled fonts in the registry (all of them, or only `ids`). */
export const bundledFonts = (ids?: Iterable<string>): FontDef[] => {
  const want = ids ? new Set(ids) : undefined;
  return FONTS.filter((f) => f.bundled && (!want || want.has(f.id)));
};

/** Load and register every bundled font once; resolves when all are ready (failures are logged, never thrown). */
export function loadBundledFonts(): Promise<void> {
  if (pending) return pending;
  const fs = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fs || typeof FontFace === "undefined") return (pending = Promise.resolve());
  pending = Promise.all(bundledFonts().flatMap((f) => f.bundled!.files.map(async ({ file, weight }) => {
    try {
      const face = new FontFace(f.bundled!.family, `url(${bundledFontUrl(file)}) format("woff2")`, { weight: String(weight), style: "normal", display: "block" });
      fs.add(face);
      await face.load();
    } catch (e) { console.warn(`Font ${f.id} (${file}) failed to load`, e); }
  }))).then(() => undefined);
  return pending;
}

/** Bundled fonts used by any text clip of `project` (matched by CSS family name in the clip's font stack). */
/** (Scans the whole document, so clip fonts, layer styles and storyboard text all count.) */
export function projectBundledFonts(project: object): FontDef[] {
  const doc = JSON.stringify(project);
  return bundledFonts().filter((f) => doc.includes(`'${f.bundled!.family}'`));
}

/**
 * P7-FONTS: the font files (and their OFL licences) a project export should carry, as `fonts/<file>` zip entries, so
 * the project file is self-contained. Files that cannot be read (offline, not cached) are skipped.
 */
export async function projectFontFiles(project: Parameters<typeof projectBundledFonts>[0]): Promise<[string, Uint8Array][]> {
  const names = [...new Set(projectBundledFonts(project).flatMap((f) => [...f.bundled!.files.map((x) => x.file), f.bundled!.license]))];
  const out: [string, Uint8Array][] = [];
  for (const n of names) {
    try { const r = await fetch(bundledFontUrl(n)); if (r.ok) out.push([`fonts/${n}`, new Uint8Array(await r.arrayBuffer())]); } catch { /* skipped */ }
  }
  return out;
}
