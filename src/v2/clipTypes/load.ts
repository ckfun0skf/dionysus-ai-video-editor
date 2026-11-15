import { createClipTypeRegistry, type ClipTypeRegistry } from "./registry";
import type { ClipTypeCore } from "./types";

/**
 * Register discovered `./<id>/core.ts` modules. Invalid modules are left out and reported (like PRESET_PROBLEMS):
 * no default export, id ≠ folder name, invalid fields, duplicates, or a variant of an unregistered type.
 */
export function loadClipTypeModules(found: Record<string, { default?: ClipTypeCore }>): { registry: ClipTypeRegistry; problems: string[] } {
  const registry = createClipTypeRegistry();
  const problems: string[] = [];
  for (const [path, mod] of Object.entries(found).sort(([a], [b]) => a.localeCompare(b))) {
    const folder = path.split("/").at(-2);
    const core = mod.default;
    if (!core) { problems.push(`${path}: no default export (export default defineClipType({…}))`); continue; }
    if (core.id !== folder) { problems.push(`${path}: id "${core.id}" must equal its folder name "${folder}"`); continue; }
    try { registry.register(core); } catch (e) { problems.push(`${path}: ${(e as Error).message}`); }
  }
  for (const c of registry.list()) {
    if (c.variant && !registry.core(c.variant.of)) problems.push(`${c.id}: variant of unregistered type "${c.variant.of}"`);
  }
  return { registry, problems };
}
