/// <reference types="vite/client" />
/**
 * Clip type registry (P65, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 step 1.1). Every `./<id>/core.ts` is imported
 * eagerly at build time and registered; invalid modules are reported in `CLIP_TYPE_PROBLEMS` (logged here, failed by
 * the tests). Nothing in the app reads this yet: later Phase 1 steps move today's `clipType` switches onto it.
 */
import { loadClipTypeModules } from "./load";
import type { ClipTypeCore } from "./types";
import type { Placement } from "../domain/model";

const found = import.meta.glob<{ default?: ClipTypeCore }>("./*/core.ts", { eager: true });

export const { registry: CLIP_TYPES, problems: CLIP_TYPE_PROBLEMS } = loadClipTypeModules(found);
export const CLIP_TYPE_MODULE_PATHS = Object.keys(found);
if (CLIP_TYPE_PROBLEMS.length) console.error(`[clipTypes] ${CLIP_TYPE_PROBLEMS.length} invalid clip type module(s):\n  ${CLIP_TYPE_PROBLEMS.join("\n  ")}`);

/** The fallback for a `clipType` this build does not know (§6 of the design doc). */
export const UNKNOWN_CLIP_TYPE = "unknown";

/** The effective type id of a placement: a registered variant whose flag is set (placeholder, blank), else `clipType`. */
export function variantOf(p: Pick<Placement, "clipType"> & Partial<Placement>): string {
  for (const c of CLIP_TYPES.list()) if (c.variant && c.variant.of === p.clipType && p[c.variant.field]) return c.id;
  return p.clipType;
}

/** The core for a placement (its variant first); unknown ids get the `unknown` core. */
export function clipTypeOf(p: Pick<Placement, "clipType"> & Partial<Placement>): ClipTypeCore {
  return CLIP_TYPES.core(variantOf(p)) ?? CLIP_TYPES.core(UNKNOWN_CLIP_TYPE)!;
}

export { defineClipType } from "./define";
export { checkClipType, createClipTypeRegistry, type ClipTypeRegistry } from "./registry";
export type { ClipCaps, ClipTypeCore, ClipTypeDef, ClipVariant } from "./types";
