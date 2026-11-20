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
export async function syncPlugins(project: Pick<Project, "plugins">, blobs: BlobStore): Promise<void> {
  try {
    await syncProjectPlugins(project, blobs, { libs: PLUGIN_LIBS, library: { blob: (h) => devicePluginLibrary().blob(h).catch(() => undefined) } });
  } catch (e) {
    console.warn("v2: plugins could not be loaded", e);
  }
}

/** The clip type registry's revision: re-renders when runtime (plugin) types or their issues change. */
export const usePluginRegistry = (): number => useSyncExternalStore(CLIP_TYPES.subscribe, CLIP_TYPES.revision);

/** Keep the registered plugins in step with the open project's locks. */
export function usePluginSync(project: Project, blobs: BlobStore) {
  const locks = project.plugins;
  useEffect(() => { void syncPlugins({ plugins: locks }, blobs); }, [locks, blobs]);
}
