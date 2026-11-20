/**
 * P84 (Phase 3 step 3.2): the plugins a project uses, `Project.plugins` (an optional field within `dionysus/3.1`):
 * id → lock { version, hash, name, publisher?, blobKey }. Pure helpers; the package bytes live in the blob store
 * (persistence/plugins.ts). docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3, docs/v2/PLUGIN_PACKAGE.md §1.
 */
import type { Placement, PluginLock, Project } from "./model";
import { PLUGIN_ID_RE, PLUGIN_VERSION_RE } from "./pluginManifest";

/** `sha256-` + 64 lower-case hex digits. */
export const PLUGIN_HASH_RE = /^sha256-[0-9a-f]{64}$/;

/** Is `v` a well-formed lock? (Malformed entries are kept in the file but ignored.) */
export function isPluginLock(v: unknown): v is PluginLock {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return typeof l.version === "string" && PLUGIN_VERSION_RE.test(l.version) && typeof l.hash === "string" && PLUGIN_HASH_RE.test(l.hash)
    && typeof l.name === "string" && !!l.name && typeof l.blobKey === "string" && !!l.blobKey && (l.publisher === undefined || typeof l.publisher === "string");
}

/** The project's well-formed locks, by plugin id (ids that aren't `x-…` are ignored). */
export function pluginLocks(project: Pick<Project, "plugins">): [string, PluginLock][] {
  const raw = project.plugins;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).filter(([id, l]) => PLUGIN_ID_RE.test(id) && isPluginLock(l));
}

/** Blob keys of the project's plugin packages (archive export, blob GC). */
export const pluginBlobKeys = (project: Pick<Project, "plugins">): string[] => pluginLocks(project).map(([, l]) => l.blobKey);

/** The project with plugin `id` locked to `lock` (added or replaced). */
export function setPluginLock(project: Project, id: string, lock: PluginLock): Project {
  if (!PLUGIN_ID_RE.test(id)) throw new Error(`"${id}" is not a plugin id`);
  return { ...project, plugins: { ...(project.plugins ?? {}), [id]: lock } };
}

/** The project without plugin `id` (its clips keep their data and show the unknown-type slate). */
export function removePluginLock(project: Project, id: string): Project {
  if (!project.plugins || !(id in project.plugins)) return project;
  const { [id]: _gone, ...rest } = project.plugins;
  const next: Project = { ...project, plugins: rest };
  if (!Object.keys(rest).length) delete next.plugins;
  return next;
}

/** Every clip of plugin type `id` in the project (all compositions). */
export function pluginClips(project: Project, id: string): Placement[] {
  return Object.values(project.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements.filter((p) => p.clipType === id)));
}
