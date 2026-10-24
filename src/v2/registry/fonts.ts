/**
 * Curated fonts with stable ids (storyboard `style.font`, textStyle presets). System stacks only (no network), so
 * preview and export match offline and on iOS Safari. Ids are part of the storyboard format: never rename one.
 */
export interface FontDef {
  id: string;
  label: string;
  stack: string;
  /** One line for the planner guide. */
  description: string;
  /** Rough average glyph width in em, used only for the importer's "text may overflow" warning. */
  width: number;
}

export const FONTS: FontDef[] = [
  { id: "sans", label: "Sans", stack: "system-ui, sans-serif", description: "Clean system sans-serif; the default.", width: 0.52 },
  { id: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif", description: "Classic book serif for titles and literary cards.", width: 0.5 },
  { id: "mono", label: "Mono", stack: "ui-monospace, 'Courier New', monospace", description: "Monospace, typewriter or terminal feel.", width: 0.6 },
  { id: "impact", label: "Impact", stack: "Impact, 'Arial Black', sans-serif", description: "Heavy condensed display face for punchy titles.", width: 0.5 },
  { id: "rounded", label: "Rounded", stack: "ui-rounded, 'Trebuchet MS', sans-serif", description: "Soft rounded sans, friendly and playful.", width: 0.52 },
  { id: "hand", label: "Hand", stack: "'Comic Sans MS', 'Chalkboard SE', cursive", description: "Casual handwritten marker look.", width: 0.55 },
  { id: "script", label: "Script", stack: "'Brush Script MT', 'Snell Roundhand', cursive", description: "Flowing brush script for elegant accents.", width: 0.45 },
  { id: "condensed", label: "Condensed", stack: "'Arial Narrow', 'Roboto Condensed', sans-serif", description: "Narrow sans that fits long lines.", width: 0.42 },
];

export const DEFAULT_FONT_ID = "sans";
export const getFont = (id: string | undefined): FontDef | undefined => FONTS.find((f) => f.id === id);
/** CSS stack for a font id; unknown ids fall back to sans. A value that already looks like a CSS stack is kept. */
export const fontStack = (id: string | undefined): string => getFont(id)?.stack ?? (id && id.includes(",") ? id : FONTS[0].stack);
/** Font id for a CSS stack (text clips store the stack). */
export const fontIdOfStack = (stack: string | undefined): string | undefined => FONTS.find((f) => f.stack === stack)?.id;
