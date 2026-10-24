/**
 * Built-in preset descriptors (plain JSON-serializable data), discovered from the preset modules in src/v2/presets/
 * (V2-FX-MOD: one file per preset). To add a preset, add a file there; see docs/v2/ADDING_EFFECTS.md. Descriptors
 * can still be added at runtime from JSON with `registerPresets`.
 */
import { PRESET_DESCRIPTORS } from "../presets";
import type { PresetDescriptor } from "./types";

export const BUILTIN_PRESETS: PresetDescriptor[] = PRESET_DESCRIPTORS;
