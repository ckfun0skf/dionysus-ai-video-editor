/**
 * P72 (Phase 1 step 1.7 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): the agent surface reads the clip type cores. WebMCP
 * tools and AI guide rules contributed by types are appended after the built-ins (none from the built-ins in Phase 1,
 * so the generated guide is byte-identical); get_timeline asks a type's `describe` for extra fields; the per-type
 * checks of the timeline tools (`clipTools`, `props`) say which clips a tool or property belongs to.
 * Pure (core layer): `domain` only through `import type`.
 */
import { CLIP_TYPES, clipTypeOf } from "./index";
import type { ClipAgentToolDef, ClipTypeCore } from "./types";
import type { Placement, Project } from "../domain/model";

/** Tools contributed by clip types, in registry order. */
export const clipTypeAgentTools = (): ClipAgentToolDef[] => CLIP_TYPES.list().flatMap((c) => c.agent?.tools ?? []);

/** AI guide rules contributed by clip types, in registry order (appended after RULE_LIST's built-ins). */
export const clipTypeAgentRules = (): { key: string; text: string }[] => CLIP_TYPES.list().flatMap((c) => c.agent?.rules ?? []);

/** The clip type that contributes tool `name`, if any. */
export const agentToolOwner = (name: string): ClipTypeCore | undefined => CLIP_TYPES.list().find((c) => c.agent?.tools?.some((t) => t.name === name));

/** Extra get_timeline fields of a clip (its type's `describe`), else none. */
export const clipTypeDescribe = (pl: Placement, project: Project): Record<string, unknown> => clipTypeOf(pl).agent?.describe?.(pl, project) ?? {};

/** Is this clip of type `c`? A variant matches on its flag (as the old checks read `pl.blank`), others on the stored clipType. */
const isOf = (c: ClipTypeCore, pl: Placement) => (c.variant ? !!pl[c.variant.field] : pl.clipType === c.id);

/** For a tool some type lists in `clipTools`: does it work on this clip? undefined = no type owns the tool (it works on any clip). */
export function clipToolFits(pl: Placement, tool: string): boolean | undefined {
  const owners = CLIP_TYPES.list().filter((c) => c.agent?.clipTools?.includes(tool));
  return owners.length ? owners.some((c) => isOf(c, pl)) : undefined;
}

/** For a set_clip_props key some type lists in `props`: does it apply to this clip? undefined = no type owns the key. */
export function clipPropFits(pl: Placement, key: string): boolean | undefined {
  const owners = CLIP_TYPES.list().filter((c) => c.agent?.props?.includes(key));
  return owners.length ? owners.some((c) => isOf(c, pl)) : undefined;
}
