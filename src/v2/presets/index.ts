/// <reference types="vite/client" />
/**
 * Preset auto-discovery (V2-FX-MOD). Every `<kind>/<id>.ts` or `<kind>/<id>/index.ts` file in this folder is imported
 * eagerly at build time; dropping a file in registers its preset everywhere. `_lib/` (shared helpers) and tests are
 * skipped. Invalid modules are left out and reported in `PRESET_PROBLEMS` (logged here, failed by the tests and the
 * production build's AI-file step).
 */
import { loadPresetModules } from "./load";
import type { PresetModule } from "./define";

const found = import.meta.glob<{ default?: PresetModule }>(["./*/*.ts", "./*/*/index.ts", "!./_lib/**", "!./**/*.test.ts", "!./__*__/**"], { eager: true });

export const { descriptors: PRESET_DESCRIPTORS, renderers: PRESET_RENDERERS, hooks: PRESET_HOOKS, fonts: PRESET_FONTS, problems: PRESET_PROBLEMS } = loadPresetModules(found);
export const PRESET_MODULE_PATHS = Object.keys(found);
if (PRESET_PROBLEMS.length) console.error(`[presets] ${PRESET_PROBLEMS.length} invalid preset module(s):\n  ${PRESET_PROBLEMS.join("\n  ")}`);
