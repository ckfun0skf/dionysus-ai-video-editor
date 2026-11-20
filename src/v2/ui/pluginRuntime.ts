import { useEffect, useSyncExternalStore } from "react";
import type { Project } from "../domain";
import type { BlobStore } from "../ports";
import { CLIP_TYPES } from "../clipTypes";
import { CLIP_LIBRARIES } from "../render";
import { createIndexedDbPluginLibrary, createMemoryPluginLibrary, syncProjectPlugins, type PluginLibrary } from "../persistence";

/**
 * P84 (Phase 3 step 3.2): the editor side of plugin loading. The open project's locked plugins are verified and
 * registered before the editor first renders (useEditorBoot) and again whenever `project.plugins` changes; the
 * registry's change signal re-renders the editor and redraws the preview.
 */

/** Library ids a plugin may ask for (the HTML clip registry, render/htmlLibs.ts). */
export const PLUGIN_LIBS: readonly string[] = CLIP_LIBRARIES.map((l) => l.id);

let library: PluginLibrary | undefined;
/** The device plugin library (IndexedDB `dionysus-plugins`), opened on first use. */
export const devicePluginLibrary = (): PluginLibrary => (library ??= typeof indexedDB !== "undefined" ? createIndexedDbPluginLibrary() : createMemoryPluginLibrary());

/** Verify and register the project's plugins; never throws (problems become per-plugin issues or a console warning). */
export async function syncPlugins(project: Pick<Project, "plugins"> & Partial<Pick<Project, "id">>, blobs: BlobStore): Promise<void> {
  last = { project, blobs };
  try {
    const lib = devicePluginLibrary();
    await syncProjectPlugins(project, blobs, {
      libs: PLUGIN_LIBS,
      library: { blob: (h) => lib.blob(h).catch(() => undefined) },
      // P85: decision 12, trust per project, per package hash, per device (set by the P86 review screens).
      ...(project.id ? { trusted: (h: string) => lib.isTrusted(project.id!, h) } : {}),
    });
  } catch (e) {
    console.warn("v2: plugins could not be loaded", e);
  }
}

let last: { project: Pick<Project, "plugins"> & Partial<Pick<Project, "id">>; blobs: BlobStore } | undefined;

/** The clip type registry's revision: re-renders when runtime (plugin) types or their issues change. */
export const usePluginRegistry = (): number => useSyncExternalStore(CLIP_TYPES.subscribe, CLIP_TYPES.revision);

/** Keep the registered plugins in step with the open project's locks. */
export function usePluginSync(project: Project, blobs: BlobStore) {
  const locks = project.plugins, id = project.id;
  useEffect(() => { void syncPlugins({ id, plugins: locks }, blobs); }, [id, locks, blobs]);
}

/**
 * P85: development and test path to let a plugin run before the trust screens exist (P86). Only in dev builds
 * (`import.meta.env.DEV`; production builds drop it): `__dionysusDev.trustPlugin("x-…")` records trust for the open
 * project and the plugin's current package hash on this device and reloads the project's plugins;
 * `untrustPlugin` removes it. Nothing in the editor's UI calls these.
 */
export async function setDevPluginTrust(id: string, trusted: boolean): Promise<boolean> {
  const p = last?.project, lock = p?.plugins?.[id];
  if (!last || !p?.id || !lock) return false;
  await devicePluginLibrary().setTrusted(p.id, lock.hash, trusted);
  await syncPlugins(p, last.blobs);
  return true;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __dionysusDev?: object }).__dionysusDev = Object.freeze({
    trustPlugin: (id: string) => setDevPluginTrust(id, true),
    untrustPlugin: (id: string) => setDevPluginTrust(id, false),
  });
}
