/**
 * Curated fonts with stable ids (storyboard `style.font`, textStyle presets), discovered from src/v2/presets/font/
 * (V2-FX-MOD). System stacks only (no network), so preview and export match offline and on iOS Safari. Ids are part
 * of the storyboard format: never rename one.
 */
import { PRESET_FONTS } from "../presets";
import type { FontDef } from "./types";

export type { FontDef } from "./types";
export const FONTS: FontDef[] = PRESET_FONTS;

export const DEFAULT_FONT_ID = "sans";
export const getFont = (id: string | undefined): FontDef | undefined => FONTS.find((f) => f.id === id);
/** CSS stack for a font id; unknown ids fall back to sans. A value that already looks like a CSS stack is kept. */
export const fontStack = (id: string | undefined): string => getFont(id)?.stack ?? (id && id.includes(",") ? id : FONTS[0].stack);
/** Font id for a CSS stack (text clips store the stack). */
export const fontIdOfStack = (stack: string | undefined): string | undefined => FONTS.find((f) => f.stack === stack)?.id;
