/**
 * P84 (Phase 3 step 3.2): the plugins a project uses, `Project.plugins` (an optional field within `dionysus/3.1`):
 * id → lock { version, hash, name, publisher?, blobKey }. Pure helpers; the package bytes live in the blob store
 * (persistence/plugins.ts). docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3, docs/v2/PLUGIN_PACKAGE.md §1.
 */
import type { Placement, PluginLock, Project } from "./model";
import { PLUGIN_ID_RE, PLUGIN_VERSION_RE } from "./pluginManifest";
import { checkParamValue, type HtmlClipParam } from "./htmlClipPackage";

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

// ---------------------------------------------------------------- P87: switching a project to another plugin version

type ParamValue = number | string | boolean;
/** One stored value that a version switch drops or changes. */
export interface PluginParamDrop { key: string; reason: "removed" | "invalid" | "clamped"; detail: string }

/**
 * P87 (decision 16): a clip's stored params under another version's declarations. Values whose key still exists and
 * fits are kept (numbers out of the new range are clamped, reported as "clamped"); keys the new version doesn't declare
 * and values that no longer fit are dropped and reported; new params aren't stored, so they take their defaults.
 */
export function migratePluginParams(stored: Readonly<Record<string, ParamValue>> | undefined, decls: Readonly<Record<string, HtmlClipParam>>): { params: Record<string, ParamValue>; dropped: PluginParamDrop[] } {
  const params: Record<string, ParamValue> = {};
  const dropped: PluginParamDrop[] = [];
  for (const [k, v] of Object.entries(stored ?? {})) {
    const spec = Object.prototype.hasOwnProperty.call(decls, k) ? decls[k] : undefined;
    if (!spec) { dropped.push({ key: k, reason: "removed", detail: "no longer a setting" }); continue; }
    const c = checkParamValue(spec, v);
    if (c.value === undefined) { dropped.push({ key: k, reason: "invalid", detail: c.problem ?? "doesn't fit" }); continue; }
    params[k] = c.value as ParamValue;
    if (c.clamped) dropped.push({ key: k, reason: "clamped", detail: c.problem ?? "clamped" });
  }
  return { params, dropped };
}

/** What switching plugin `id` to a version with `decls` does to the project's clips (shown before, warned after). */
export interface PluginSwitchSummary {
  clips: number;
  /** Params the new version adds (defaults apply), when the old declarations are known. */
  added: string[];
  /** Params the new version no longer has, when the old declarations are known. */
  removed: string[];
  /** Per key: how many clips lose or change their value, and why (first reason seen). */
  changes: { key: string; reason: PluginParamDrop["reason"]; detail: string; clips: number }[];
}
export function pluginSwitchSummary(project: Project, id: string, decls: Readonly<Record<string, HtmlClipParam>>, oldDecls?: Readonly<Record<string, HtmlClipParam>>): PluginSwitchSummary {
  const clips = pluginClips(project, id);
  const by = new Map<string, PluginSwitchSummary["changes"][number]>();
  for (const pl of clips) for (const d of migratePluginParams(pl.plugin?.data?.params, decls).dropped) {
    const o = by.get(d.key);
    if (o) o.clips += 1; else by.set(d.key, { key: d.key, reason: d.reason, detail: d.detail, clips: 1 });
  }
  return {
    clips: clips.length,
    added: oldDecls ? Object.keys(decls).filter((k) => !(k in oldDecls)) : [],
    removed: oldDecls ? Object.keys(oldDecls).filter((k) => !(k in decls)) : [],
    changes: [...by.values()],
  };
}

/** Lock `id` at another version and migrate every clip of it (all compositions); `plugin.v` becomes the new version. */
export function switchPluginVersion(project: Project, id: string, lock: PluginLock, decls: Readonly<Record<string, HtmlClipParam>>): Project {
  if (!project.plugins?.[id]) throw new Error(`plugin ${id} is not in this project`);
  const next = setPluginLock(project, id, lock);
  const compositions = Object.fromEntries(Object.entries(next.compositions).map(([cid, c]) => [cid, c.tracks.some((t) => t.placements.some((p) => p.clipType === id)) ? {
    ...c,
    tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => {
      if (p.clipType !== id) return p;
      const { params } = migratePluginParams(p.plugin?.data?.params, decls);
      return { ...p, plugin: { ...p.plugin, data: { ...p.plugin?.data, params }, v: lock.version } };
    }) })),
  } : c]));
  return { ...next, compositions };
}
