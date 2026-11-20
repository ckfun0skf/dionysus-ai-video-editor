/**
 * P84 (Phase 3 step 3.2, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3): the core of a third-party clip type, built
 * from its `dionysus.cliptype/1` manifest (data, not code). The host owns the rules: v1 plugins are visual clips on
 * video tracks with no sound, no source time and no project media (decision 15); they have no agent tools or rules of
 * their own (decisions 14 and 17), only extra get_timeline fields. Registered at runtime with
 * `CLIP_TYPES.setRuntime` by the project's plugin loader (persistence/plugins.ts).
 *
 * Also keeps, per plugin id, why a plugin the open project locks is NOT registered (missing package, damaged, needs a
 * newer editor), so the unknown-type slate and inspector can say so. Pure: `domain` only through `import type`.
 */
import type { Placement, PluginLock } from "../domain/model";
import type { PluginManifest } from "../domain/pluginManifest";
import type { ClipTypeCore } from "./types";
import { CLIP_TYPES } from "./index";

/** Behaviour version of every plugin core (the plugin's own version is `plugin.version`). */
export const PLUGIN_CLIP_VERSION = 1;

/** What the host knows about a registered plugin type (from its manifest and the project's lock). */
export interface ClipPluginMeta {
  name: string;
  /** The plugin's semantic version. */
  version: string;
  hash: string;
  publisher?: string;
  description?: string;
  icon?: string;
  durationSec: number;
  params: NonNullable<PluginManifest["params"]>;
  editor?: PluginManifest["editor"];
  agent?: PluginManifest["agent"];
  /** The validated manifest, for the renderer (P85) and the plugin panels. */
  manifest: PluginManifest;
}

/** A plugin's params as a clip sees them: declared defaults with the clip's stored values of the same type on top. */
export function pluginParamsOf(meta: Pick<ClipPluginMeta, "params">, p: Pick<Placement, "plugin">): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  const stored = p.plugin?.data?.params ?? {};
  for (const [k, spec] of Object.entries(meta.params)) {
    const v = stored[k];
    const fits = spec.type === "number" ? typeof v === "number" && Number.isFinite(v) : spec.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && (spec.type !== "select" || (spec.options ?? []).includes(v));
    out[k] = fits ? (v as number | string | boolean) : spec.default;
  }
  return out;
}

/** Build the core for a validated manifest and the lock that pins it. */
export function pluginCoreOf(m: PluginManifest, lock: Pick<PluginLock, "hash">): ClipTypeCore {
  const meta: ClipPluginMeta = {
    name: m.name, version: m.version, hash: lock.hash, publisher: m.publisher, description: m.description, icon: m.icon,
    durationSec: m.durationSec ?? 5, params: m.params ?? {}, editor: m.editor, agent: m.agent, manifest: m,
  };
  return {
    id: m.id,
    version: PLUGIN_CLIP_VERSION,
    description: `Plugin “${m.name}” ${m.version}${m.publisher ? ` by ${m.publisher} (unverified)` : ""}${m.description ? `: ${m.description}` : ""}`,
    trackKind: "video",
    caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: m.caps?.keyable !== false, thumb: false, asset: "none" },
    plugin: meta,
    agent: {
      describe: (p) => ({ plugin: { name: m.name, version: m.version, ...(p.plugin?.v && p.plugin.v !== m.version ? { paramsWrittenFor: p.plugin.v } : {}) }, params: pluginParamsOf(meta, p) }),
    },
  };
}

/** The plugin meta of a stored clipType, when that plugin is registered. */
export const pluginMetaOf = (clipType: string): ClipPluginMeta | undefined => CLIP_TYPES.core(clipType)?.plugin;

/** Why a locked plugin isn't registered. */
export type PluginIssueState = "missing" | "damaged" | "newer" | "conflict";
const issues = new Map<string, { state: PluginIssueState; name?: string; message: string }>();
/** Set by the loader for the open project (replaces the previous project's list). Returns whether anything changed. */
export function setPluginIssues(next: Iterable<[string, { state: PluginIssueState; name?: string; message: string }]>): boolean {
  const before = JSON.stringify([...issues]);
  issues.clear();
  for (const [id, v] of next) issues.set(id, v);
  return JSON.stringify([...issues]) !== before;
}
/** The reason plugin `id` is locked by the open project but not registered, if any. */
export const pluginIssueOf = (id: string) => issues.get(id);

/**
 * The unknown-type slate's two lines for a stored clipType (P73; P84 names a missing plugin and why): a built-in id
 * from a newer build, a plugin the project locks but can't load, or a plugin id the project doesn't lock.
 */
export function unknownSlateText(clipType: string): [string, string] {
  if (!clipType.startsWith("x-")) return [`Unknown clip type “${clipType}”`, "NEEDS A NEWER VERSION"];
  const i = issues.get(clipType);
  const name = i?.name ?? clipType;
  switch (i?.state) {
    case "missing": return [`Plugin “${name}” is missing`, "PACKAGE NOT FOUND"];
    case "damaged": return [`Plugin “${name}” can't be loaded`, "PACKAGE DAMAGED"];
    case "newer": return [`Plugin “${name}”`, "NEEDS A NEWER VERSION"];
    case "conflict": return [`Plugin “${name}” can't be loaded`, "ID CONFLICT"];
    default: return [`Plugin “${name}” is not installed`, "NOT IN THIS PROJECT"];
  }
}
