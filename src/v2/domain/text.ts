/** Text clips: a placement with `clipType: "text"` on a text track. Pure data; animation math lives in the preset registry. */
import { applyPreset, identityFrame, loopPeriod, type PresetFrame } from "../registry";
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
  s = applyPreset("textAnimIn", d.animIn, pin, s);
  s = applyPreset("textAnimOut", d.animOut, pout, s);
  const per = loopPeriod(d.loop) * 120_000;
  s = applyPreset("textAnimLoop", d.loop, (((o % per) + per) % per) / per, s);
  return s;
}

/** Visible part of the text for a typewriter progress 0..1 (whole characters, never splits a surrogate pair). */
export function visibleText(text: string, chars: number): string {
  const cs = [...text];
  return cs.slice(0, Math.round(cs.length * Math.min(1, Math.max(0, chars)))).join("");
}

/** Curated fonts: system stacks only (no network), so preview and export match offline. */
export const FONTS: { label: string; stack: string }[] = [
  { label: "Sans", stack: "system-ui, sans-serif" },
  { label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", stack: "ui-monospace, 'Courier New', monospace" },
  { label: "Impact", stack: "Impact, 'Arial Black', sans-serif" },
  { label: "Rounded", stack: "ui-rounded, 'Trebuchet MS', sans-serif" },
  { label: "Hand", stack: "'Comic Sans MS', 'Chalkboard SE', cursive" },
  { label: "Script", stack: "'Brush Script MT', 'Snell Roundhand', cursive" },
  { label: "Condensed", stack: "'Arial Narrow', 'Roboto Condensed', sans-serif" },
];

/** One-tap looks. Applying a template keeps the clip's own text. */
export const TEXT_TEMPLATES: { id: string; label: string; data: Partial<TextData> }[] = [
  { id: "plain", label: "Plain", data: { font: FONTS[0].stack, bold: true, color: "#ffffff", strokeWidth: 0, shadow: undefined, background: undefined, effect: "none" } },
  { id: "caption", label: "Caption", data: { font: FONTS[0].stack, bold: true, color: "#ffffff", background: { color: "#000000", opacity: 0.6 }, effect: "none", size: 0.06 } },
  { id: "outline", label: "Outline", data: { font: FONTS[3].stack, color: "#ffe14d", strokeWidth: 0.08, strokeColor: "#000000", effect: "none" } },
  { id: "neon", label: "Neon", data: { font: FONTS[4].stack, color: "#ffffff", effect: "neon", effectColor: "#ff3df2", loop: "pulse" } },
  { id: "pop", label: "Pop title", data: { font: FONTS[3].stack, color: "#ffffff", shadow: { color: "#000000", blur: 0, x: 0.05, y: 0.05 }, animIn: "pop", animOut: "shrink", size: 0.14 } },
  { id: "typewriter", label: "Typewriter", data: { font: FONTS[2].stack, bold: false, color: "#e8e8e8", animIn: "typewriter", effect: "none" } },
  { id: "glow", label: "Glow", data: { font: FONTS[1].stack, italic: true, color: "#ffffff", effect: "glow", effectColor: "#20d5ec", loop: "float" } },
  { id: "echo", label: "Echo", data: { font: FONTS[3].stack, color: "#ffffff", effect: "echo", effectColor: "#ff4d6d", animIn: "slide-up" } },
];
