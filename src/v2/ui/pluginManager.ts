/**
 * P86 (Phase 3 step 3.4, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3): installing plugins and enabling them per
 * project. The logic behind the Plugins library, the install (consent) dialog, the review banner and the Project →
 * Plugins sheet (ui/PluginLibrary.tsx):
 *
 * - read a package from a file or an https URL (the P84 readers, with the host's library ids);
 * - install = the user's OK in the consent dialog: the package goes into the device library, its blob into the
 *   project's store, trust is recorded for this project and hash on this device (decision 12), and the lock is one
 *   undo step (optionally with a first clip);
 * - a project plugin that isn't enabled on this device is allowed from the review list (same dialog);
 * - remove from a project is one undo step (its clips keep their settings, or go with it);
 * - the device library's list, parsed once per hash for the tiles.
 */
import { useSyncExternalStore } from "react";
import { pluginLocks, type PluginLock, type PluginManifest, type Project } from "../domain";
import { cmd, type Engine } from "../engine";
import type { BlobStore } from "../ports";
import { isPluginEnabled, pluginIssueOf, pluginMetaOf } from "../clipTypes";
import { PluginConflictError, PluginPackageError, fetchPluginPackage, pluginProjectProblem, readPluginZip, storePluginPackage, type PluginLibraryEntry, type PluginPackage } from "../persistence";
import { devicePluginLibrary, PLUGIN_LIBS, syncPlugins } from "./pluginRuntime";

const TICKS = 120_000;

/** What the consent dialog shows about a package (from a package being installed, or one already stored). */
export interface PluginFacts {
  id: string;
  name: string;
  version: string;
  publisher?: string;
  description?: string;
  icon?: string;
  hash: string;
  size: number;
  /** "file:<name>", a URL, or "project" for a package that came with the project. */
  source: string;
  libs: string[];
  params: { key: string; label: string; type: string }[];
  warnings: string[];
}

export function pluginFacts(pkg: PluginPackage, source: string): PluginFacts {
  const m = pkg.manifest;
  return {
    id: m.id, name: m.name, version: m.version, publisher: m.publisher, description: m.description, icon: m.icon, hash: pkg.hash, size: pkg.size, source,
    libs: [...(m.render.libs ?? [])],
    params: Object.entries(m.params ?? {}).map(([key, p]) => ({ key, label: p.label ?? key, type: p.type })),
    warnings: pkg.warnings.filter((w) => w.level === "warning").map((w) => w.message),
  };
}

/** "a1b2c3d4e5f6" (12 hex digits) of a content hash. */
export const shortPluginHash = (h: string) => h.replace(/^sha256-/, "").slice(0, 12);
export const pluginSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
/** Where a package came from, for people: a file name, a host and path, or the project. */
export function pluginSourceText(source: string): string {
  if (source === "project") return "This project";
  if (source.startsWith("file:")) return `File ${source.slice(5)}`;
  try { const u = new URL(source); return `${u.host}${u.pathname}`; } catch { return source; }
}

/** The bundled samples, served by the app itself (relative to its base URL, so any deployment works). */
export const PLUGIN_SAMPLES = [
  { id: "x-dionysus-stripes", name: "Moving stripes", note: "2D canvas: sliding stripes with a title band", icon: "pi-waves" },
  { id: "x-dionysus-orbit", name: "3D knot", note: "three.js: a lit torus knot with orbiting dots", icon: "pi-box" },
] as const;
export function pluginSampleUrl(id: string, base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/", href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`plugins/samples/${id}/manifest.json`, new URL(base, href)).href;
}

/** Read a package the user picked (a zip file) or pasted (a manifest or zip URL). Errors are PluginPackageError with plain text. */
export async function readPluginFrom(from: { file: File } | { url: string }): Promise<{ pkg: PluginPackage; source: string }> {
  if ("file" in from) {
    if (!/\.zip$/i.test(from.file.name) && !/zip/.test(from.file.type)) throw new PluginPackageError("Pick a plugin package: a .dionysus-cliptype.zip file.");
    return { pkg: await readPluginZip(from.file, { libs: PLUGIN_LIBS }), source: `file:${from.file.name}` };
  }
  const url = from.url.trim();
  return { pkg: await fetchPluginPackage(url, { libs: PLUGIN_LIBS }), source: url };
}

// ---------------------------------------------------------------- the device library (cached, observable)

export interface LibraryItem extends PluginLibraryEntry { manifest?: PluginManifest }
let items: LibraryItem[] = [];
let loaded = false;
let rev = 0;
const subs = new Set<() => void>();
const parsed = new Map<string, PluginManifest | null>();
const emit = () => { rev += 1; subs.forEach((f) => f()); };

/** Re-read the device library (after an install or delete). Never throws. */
export async function refreshPluginLibrary(): Promise<LibraryItem[]> {
  try {
    const lib = devicePluginLibrary();
    const list = await lib.list();
    const out: LibraryItem[] = [];
    for (const e of list) {
      if (!parsed.has(e.hash)) {
        const b = await lib.blob(e.hash).catch(() => undefined);
        parsed.set(e.hash, b ? await readPluginZip(b, { libs: PLUGIN_LIBS }).then((p) => p.manifest, () => null) : null);
      }
      out.push({ ...e, ...(parsed.get(e.hash) ? { manifest: parsed.get(e.hash)! } : {}) });
    }
    items = out;
  } catch (e) {
    console.warn("v2: the plugin library could not be read", e);
  }
  loaded = true;
  emit();
  return items;
}

/** The device library, re-rendering when it changes (read on first use). */
export function usePluginLibraryItems(): LibraryItem[] {
  useSyncExternalStore((f) => { subs.add(f); if (!loaded) { loaded = true; void refreshPluginLibrary(); } return () => { subs.delete(f); }; }, () => rev);
  return items;
}

// ---------------------------------------------------------------- one list for the project and the device

export type PluginRowState = "enabled" | "review" | "missing" | "damaged" | "newer" | "conflict" | "device";
export interface PluginRow {
  id: string;
  name: string;
  version: string;
  hash: string;
  publisher?: string;
  description?: string;
  icon?: string;
  /** In this project (locked) or only on this device (library). */
  inProject: boolean;
  state: PluginRowState;
  /** Why it can't load (missing, damaged, newer, conflict). */
  message?: string;
  clips: number;
  durationSec: number;
}

const clipCount = (project: Project, id: string) =>
  Object.values(project.compositions).reduce((n, c) => n + c.tracks.reduce((m, t) => m + t.placements.filter((p) => p.clipType === id).length, 0), 0);

/** The project's plugins (in lock order), then the device library's others (newest version per id), by name. */
export function pluginRows(project: Project, library: readonly LibraryItem[]): PluginRow[] {
  const rows: PluginRow[] = [];
  const locked = pluginLocks(project);
  for (const [id, lock] of locked) {
    const meta = pluginMetaOf(id);
    const issue = pluginIssueOf(id);
    const lib = library.find((e) => e.hash === lock.hash)?.manifest;
    const m = meta?.manifest ?? lib;
    rows.push({
      id, name: meta?.name ?? lock.name, version: lock.version, hash: lock.hash, publisher: lock.publisher, description: m?.description, icon: m?.icon,
      inProject: true, state: meta ? (isPluginEnabled(id) ? "enabled" : "review") : issue?.state ?? "missing", ...(issue ? { message: issue.message } : {}),
      clips: clipCount(project, id), durationSec: meta?.durationSec ?? m?.durationSec ?? 5,
    });
  }
  const newest = new Map<string, LibraryItem>();
  for (const e of library) {
    if (locked.some(([id]) => id === e.id)) continue;
    const o = newest.get(e.id);
    if (!o || o.installedAt < e.installedAt) newest.set(e.id, e);
  }
  for (const e of [...newest.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push({ id: e.id, name: e.name, version: e.version, hash: e.hash, publisher: e.publisher, description: e.manifest?.description, icon: e.manifest?.icon, inProject: false, state: "device", clips: 0, durationSec: e.manifest?.durationSec ?? 5 });
  }
  return rows;
}

/** P86 banner: plugins this project uses that this device hasn't allowed for it (they load, but don't run). */
export const pluginsToReview = (rows: readonly PluginRow[]) => rows.filter((r) => r.inProject && r.state === "review");

// ---------------------------------------------------------------- actions

export interface PluginActionContext {
  engine: Engine;
  blobs: BlobStore;
}

const projectOf = (engine: Engine) => engine.getState().project;

/**
 * The user said Install (or Add to project / Allow) in the consent dialog: device library, project blob, trust for
 * this project, the lock as one undo step (with a first clip at `clipAt` when given), then reload the plugins.
 * Returns the new clip's id, if one was added.
 */
export async function installPlugin(ctx: PluginActionContext, pkg: PluginPackage, source: string, clipAt?: { at: number; where?: "main" | "overlay" | { trackId: string }; id: string }): Promise<string | undefined> {
  const project = projectOf(ctx.engine);
  const problem = pluginProjectProblem(project, pkg);
  if (problem) throw new PluginConflictError(problem);
  const lib = devicePluginLibrary();
  try { await lib.add(pkg, source); } catch (e) {
    // Allowing a plugin the project already locks works even if the device library holds another build of that version.
    if (!(e instanceof PluginConflictError) || project.plugins?.[pkg.manifest.id]?.hash !== pkg.hash) throw e;
  }
  const lock: PluginLock = await storePluginPackage(pkg, ctx.blobs);
  await lib.setTrusted(project.id, pkg.hash, true);
  const id = pkg.manifest.id;
  const now = projectOf(ctx.engine);
  const cmds = [
    ...(now.plugins?.[id]?.hash === pkg.hash ? [] : [cmd.lockPlugin(id, lock)]),
    ...(clipAt ? [cmd.addPluginClip(clipAt.at, id as `x-${string}`, pkg.manifest.version, Math.round((pkg.manifest.durationSec ?? 5) * TICKS), clipAt.where ?? "overlay", clipAt.id)] : []),
  ];
  const added = cmds.length ? ctx.engine.dispatch(cmds, clipAt ? `Add plugin “${pkg.manifest.name}” clip` : `Add plugin “${pkg.manifest.name}”`) : false;
  await syncPlugins(projectOf(ctx.engine), ctx.blobs);
  void refreshPluginLibrary();
  return added && clipAt ? clipAt.id : undefined;
}

/** The stored package of a plugin this project locks (to show in the review dialog, and to add it to the device library). */
export async function projectPluginPackage(project: Project, id: string, blobs: BlobStore): Promise<PluginPackage> {
  const lock = project.plugins?.[id];
  if (!lock) throw new PluginPackageError("This project doesn't use that plugin.");
  const blob = (await blobs.get(lock.blobKey).catch(() => undefined)) ?? (await devicePluginLibrary().blob(lock.hash).catch(() => undefined));
  if (!blob) throw new PluginPackageError(`The package of “${lock.name}” is not in this project or on this device.`);
  const pkg = await readPluginZip(blob, { libs: PLUGIN_LIBS });
  if (pkg.hash !== lock.hash) throw new PluginPackageError(`The stored package of “${lock.name}” doesn't match the project's lock (content hash).`);
  return pkg;
}

/** A package from the device library by hash. */
export async function libraryPluginPackage(hash: string): Promise<PluginPackage> {
  const blob = await devicePluginLibrary().blob(hash);
  if (!blob) throw new PluginPackageError("That plugin is no longer on this device.");
  return readPluginZip(blob, { libs: PLUGIN_LIBS });
}

/** Add a clip of an enabled plugin (one undo step). Returns the clip id, or undefined when it couldn't be added. */
export function addPluginClipAt(engine: Engine, id: string, at: number, where: "main" | "overlay" | { trackId: string } = "overlay", clipId?: string): string | undefined {
  const meta = pluginMetaOf(id);
  if (!meta || !/^x-/.test(id)) return undefined;
  const c = cmd.addPluginClip(at, id as `x-${string}`, meta.version, Math.round(meta.durationSec * TICKS), where, clipId);
  const before = new Set(Object.values(engine.getState().project.compositions).flatMap((x) => x.tracks.flatMap((t) => t.placements.map((p) => p.id))));
  if (!engine.dispatch(c, `Add “${meta.name}” clip`)) return undefined;
  const after = Object.values(engine.getState().project.compositions).flatMap((x) => x.tracks.flatMap((t) => t.placements.map((p) => p.id)));
  return after.find((pid) => !before.has(pid));
}

/** Remove a plugin from the project (one undo step); with `withClips` its clips go too. */
export const removePluginFromProject = (engine: Engine, id: string, withClips: boolean) =>
  engine.dispatch(cmd.removePlugin(id, withClips), withClips ? "Remove plugin and its clips" : "Remove plugin");

/** Delete a package from this device's library (projects that embed it keep it). */
export async function deleteFromDevice(hash: string): Promise<void> {
  await devicePluginLibrary().remove(hash);
  parsed.delete(hash);
  await refreshPluginLibrary();
}

/** A plain message for a failed read or install. */
export function pluginErrorText(e: unknown): string {
  if (e instanceof PluginPackageError || e instanceof PluginConflictError) return e.message;
  return e instanceof Error && e.message ? `Couldn't add the plugin: ${e.message}` : "Couldn't add the plugin.";
}
