/** Text clips: a placement with `clipType: "text"` on a text track. Pure data; animation math lives in the preset registry. */
import { applyPreset, fontStack, getPreset, identityFrame, listPresets, loopPeriod, type Params, type PresetFrame } from "../registry";
/** Preset ids from the registry ("none" or undefined = no preset). */
export type TextAnimIn = string;
export type TextAnimOut = string;
export type TextAnimLoop = string;
export type TextEffect = string;

export interface TextData {
  text: string;
  /** CSS font-family stack (see FONTS). */
  font: string;
  /** Font size as a fraction of frame height at scale 1. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  color: string;
  align: "left" | "center" | "right";
  /** Extra space between letters, in em. */
  letterSpacing?: number;
  /** Line height multiplier. */
  lineHeight?: number;
  /** Outline width in em (0 = none). */
  strokeWidth?: number;
  strokeColor?: string;
  shadow?: { color: string; blur: number; x: number; y: number };
  /** Box behind the text. */
  background?: { color: string; opacity: number };
  effect?: TextEffect;
  effectColor?: string;
  animIn?: TextAnimIn;
  animOut?: TextAnimOut;
  loop?: TextAnimLoop;
  /** Params of the in / out / loop presets (V2-SB-130); missing keys use the defaults. Cleared when another preset is picked. */
  animInParams?: Params;
  animOutParams?: Params;
  loopParams?: Params;
  /** In/out animation length in ticks. */
  animTicks?: number;
}

export const DEFAULT_TEXT: TextData = { text: "Text", font: "system-ui, sans-serif", size: 0.1, bold: true, color: "#ffffff", align: "center", strokeWidth: 0, strokeColor: "#000000" };
export const DEFAULT_TEXT_TICKS = 3 * 120_000;
const ANIM_TICKS = 60_000; // 0.5 s

export function textOf(d?: Partial<TextData>): TextData { return { ...DEFAULT_TEXT, ...d }; }

/** Per-frame animation state for a text clip at clip offset `o` of `dur` ticks. */
export type TextAnimState = PresetFrame;
export function textAnimAt(d: TextData, o: number, dur: number): TextAnimState {
  const a = Math.min(d.animTicks ?? ANIM_TICKS, dur / 2);
  const pin = a > 0 ? Math.min(1, Math.max(0, o / a)) : 1;
  const pout = a > 0 ? Math.min(1, Math.max(0, (dur - o) / a)) : 1;
  let s = identityFrame();
  s = applyPreset("textAnimIn", d.animIn, pin, s, d.animInParams);
  s = applyPreset("textAnimOut", d.animOut, pout, s, d.animOutParams);
  const per = loopPeriod(d.loop, d.loopParams) * 120_000;
  s = applyPreset("textAnimLoop", d.loop, (((o % per) + per) % per) / per, s, d.loopParams);
  return s;
}

/** Visible part of the text for a typewriter progress 0..1 (whole characters, never splits a surrogate pair). */
export function visibleText(text: string, chars: number): string {
  const cs = [...text];
  return cs.slice(0, Math.round(cs.length * Math.min(1, Math.max(0, chars)))).join("");
}

/** Curated fonts with stable ids live in the registry (registry/fonts.ts); text clips store the CSS stack. */
export { FONTS, fontStack, fontIdOfStack } from "../registry";

/**
 * Text clip fields of a `textStyle` preset (one-tap looks, formerly TEXT_TEMPLATES). Font ids become CSS stacks and
 * JSON nulls clear the field. Unknown ids return undefined.
 */
export function textStyleData(id: string | undefined): Partial<TextData> | undefined {
  const d = getPreset("textStyle", id);
  return d ? textStyleFields(d.data ?? {}) : undefined;
}
/** Map plain style data (preset `data`, storyboard `meta.textStyles`) onto text clip fields. */
export function textStyleFields(data: Record<string, unknown>): Partial<TextData> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = v === null ? undefined : k === "font" ? fontStack(String(v)) : v;
  return out as Partial<TextData>;
}
/** One-tap looks for the text panels, in registry order. Applying one keeps the clip's own text. */
export const textTemplates = (): { id: string; label: string; data: Partial<TextData> }[] =>
  listPresets("textStyle").map((d) => ({ id: d.id, label: d.name, data: textStyleFields(d.data ?? {}) }));
