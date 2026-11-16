/// <reference types="vite/client" />
/**
 * Clip type registry (P65, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 step 1.1). Every `./<id>/core.ts` is imported
 * eagerly at build time and registered; invalid modules are reported in `CLIP_TYPE_PROBLEMS` (logged here, failed by
 * the tests). Since P66 (step 1.2) the domain predicates and the export audio plan read it; later Phase 1 steps move
 * the remaining `clipType` switches onto it.
 */
import { loadClipTypeModules } from "./load";
import type { ClipTypeCore } from "./types";
import { isPlaceholder, placeholderCore } from "./state";
import type { Placement } from "../domain/model";

const found = import.meta.glob<{ default?: ClipTypeCore }>("./*/core.ts", { eager: true });

export const { registry: CLIP_TYPES, problems: CLIP_TYPE_PROBLEMS } = loadClipTypeModules(found);
export const CLIP_TYPE_MODULE_PATHS = Object.keys(found);
if (CLIP_TYPE_PROBLEMS.length) console.error(`[clipTypes] ${CLIP_TYPE_PROBLEMS.length} invalid clip type module(s):\n  ${CLIP_TYPE_PROBLEMS.join("\n  ")}`);

/** The fallback for a `clipType` this build does not know (§6 of the design doc). */
export const UNKNOWN_CLIP_TYPE = "unknown";

// Hot path (P66: domain predicates and the player call these per clip): the variant list is built once per registry size.
let variants: ClipTypeCore[] = [];
let variantsFor = -1;
function variantList(): ClipTypeCore[] {
  const all = CLIP_TYPES.list();
  if (all.length !== variantsFor) { variants = all.filter((c) => c.variant).sort((a, b) => (b.variant!.priority ?? 0) - (a.variant!.priority ?? 0)); variantsFor = all.length; }
  return variants;
}

/**
 * The effective type id of a placement: a registered variant whose flag is set (blank), else `clipType`. Since P73 a
 * placeholder is a clip state (./state.ts), not a variant: check `isPlaceholder` first, as `clipTypeOf` does.
 */
export function variantOf(p: Pick<Placement, "clipType"> & Partial<Placement>): string {
  for (const c of variantList()) if (c.variant!.of === p.clipType && p[c.variant!.field]) return c.id;
  return p.clipType;
}

/** The core for a stored `clipType` (no variant lookup); unknown ids get the `unknown` core. */
export function coreOf(clipType: string): ClipTypeCore {
  return CLIP_TYPES.core(clipType) ?? CLIP_TYPES.core(UNKNOWN_CLIP_TYPE)!;
}

/**
 * The core for a placement: a placeholder (any type) gets the host's placeholder state core (P73, decision 9), else its
 * variant, else its stored type; unknown ids get the `unknown` core.
 */
export function clipTypeOf(p: Pick<Placement, "clipType"> & Partial<Placement>): ClipTypeCore {
  return isPlaceholder(p) ? placeholderCore(coreOf(p.clipType)) : coreOf(variantOf(p));
}

/** Is `clipType` registered in this build? (Unknown ids keep their data and draw the unknown-type slate, §6.) */
export const isKnownClipType = (clipType: string): boolean => !!CLIP_TYPES.core(clipType) && clipType !== UNKNOWN_CLIP_TYPE;

export { defineClipType } from "./define";
export { checkClipType, createClipTypeRegistry, type ClipTypeRegistry } from "./registry";
export type { ClipAccepts, ClipAgent, ClipAgentApi, ClipAgentResult, ClipAgentToolDef, ClipCaps, ClipStory, ClipTypeCore, ClipTypeDef, ClipVariant } from "./types";
export { DEFAULT_CLIP_STORY, kindForFile, kindForSlotType, mimeForFile, storyOf } from "./story";
export { PLACEHOLDER_STATE, isPlaceholder, placeholderAccepts, placeholderCaps, placeholderCore } from "./state";
export { agentToolOwner, clipPropFits, clipToolFits, clipTypeAgentRules, clipTypeAgentTools, clipTypeDescribe } from "./agent";
