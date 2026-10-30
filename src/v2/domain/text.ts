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
export type TextAnimState = PresetFrame & {
  /** P7-TYPE-CURSOR: text to draw instead of the visible part (scrambled characters still decoding). */
  display?: string;
  /** P7-TYPE-CURSOR: cursor glyph drawn right after the visible text, with its opacity 0..1. */
  caret?: { glyph: string; alpha: number };
};

/** Deterministic 0..1 hash of two integers (same value in preview and export). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** Seconds after typing ends that a "fade" cursor takes to disappear. */
export const CURSOR_FADE_SEC = 0.5;
/** Scramble glyphs change this many times per second (frame-rate independent, so every export fps matches). */
export const SCRAMBLE_RATE = 30;

/**
 * P7-TYPE-CURSOR: resolve the typewriter cursor at clip offset `o` (ticks); typing runs over the first `a` ticks.
 * While typing the cursor is solid; afterwards it blinks (`blink` per second, 0 = solid), hides or fades out. With
 * several cursor characters every newly typed character shows random ones for `scramble` seconds before resolving.
 */
export function resolveCursor(text: string, s: PresetFrame, o: number, a: number): Pick<TextAnimState, "display" | "caret"> {
  const c = s.cursor;
  if (!c || !c.glyphs) return {};
  const glyphs = [...c.glyphs], cs = [...text], n = cs.length;
  const shown = Math.round(n * Math.min(1, Math.max(0, s.chars)));
  const tick = Math.floor((o / 120_000) * SCRAMBLE_RATE);
  const pick = (i: number) => glyphs[Math.floor(hash01(i, tick) * glyphs.length)];
  let display: string | undefined;
  if (glyphs.length > 1 && c.scramble > 0 && n > 0) {
    const sc = c.scramble * 120_000;
    const out = cs.slice(0, shown).map((ch, i) => (/\s/.test(ch) || o >= (a * (i + 0.5)) / n + sc ? ch : pick(i)));
    display = out.join("");
  }
  let alpha = 1;
  if (o >= a) {
    const e = (o - a) / 120_000;
    const blinkOn = c.blink > 0 ? Math.floor(e * c.blink * 2) % 2 === 0 ? 1 : 0 : 1;
    alpha = c.after === "hide" ? 0 : c.after === "fade" ? Math.max(0, 1 - e / CURSOR_FADE_SEC) : blinkOn;
  }
  const glyph = glyphs.length > 1 ? (o >= a ? glyphs[0] : pick(-1)) : glyphs[0];
  return { ...(display !== undefined ? { display } : {}), caret: { glyph, alpha } };
}

export function textAnimAt(d: TextData, o: number, dur: number): TextAnimState {
  const a = Math.min(d.animTicks ?? ANIM_TICKS, dur / 2);
  const pin = a > 0 ? Math.min(1, Math.max(0, o / a)) : 1;
  const pout = a > 0 ? Math.min(1, Math.max(0, (dur - o) / a)) : 1;
  let s = identityFrame();
  s = applyPreset("textAnimIn", d.animIn, pin, s, d.animInParams);
  s = applyPreset("textAnimOut", d.animOut, pout, s, d.animOutParams);
  const per = loopPeriod(d.loop, d.loopParams) * 120_000;
  s = applyPreset("textAnimLoop", d.loop, (((o % per) + per) % per) / per, s, d.loopParams);
  return s.cursor ? { ...s, ...resolveCursor(d.text, s, o, a) } : s;
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
/**
 * P7-CAPTION: a textStyle preset may carry `position` {x, y} (text centre, 0..1 of the frame, like a storyboard text
 * layer) for where a new clip of that style is placed in the editor; returned as a clip transform offset.
 */
export function textStylePosition(id: string | undefined): { x: number; y: number } | undefined {
  const pos = getPreset("textStyle", id)?.data?.position as { x?: unknown; y?: unknown } | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return undefined;
  return { x: Math.min(1, Math.max(0, pos.x)) - 0.5, y: Math.min(1, Math.max(0, pos.y)) - 0.5 };
}
/** Map plain style data (preset `data`, storyboard `meta.textStyles`) onto text clip fields. */
export function textStyleFields(data: Record<string, unknown>): Partial<TextData> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (k !== "position") out[k] = v === null ? undefined : k === "font" ? fontStack(String(v)) : v;
  return out as Partial<TextData>;
}
/** One-tap looks for the text panels, in registry order. Applying one keeps the clip's own text. */
export const textTemplates = (): { id: string; label: string; data: Partial<TextData> }[] =>
  listPresets("textStyle").map((d) => ({ id: d.id, label: d.name, data: textStyleFields(d.data ?? {}) }));
