/**
 * Code registry of pure render functions, keyed by descriptor `type`, plus optional canvas hooks per type. Filled
 * from the preset modules in src/v2/presets/ (V2-FX-MOD); `registerRenderer` adds more at runtime.
 */
import { PRESET_HOOKS, PRESET_RENDERERS } from "../presets";
import type { RenderFn, RenderHooks } from "./types";

export { hash } from "../presets/_lib/math";

export const RENDERERS: Record<string, RenderFn> = { ...PRESET_RENDERERS };
/** Canvas hooks by type: videoEffect `draw`, transition `paint`. */
export const HOOKS: Record<string, RenderHooks> = { ...PRESET_HOOKS };
