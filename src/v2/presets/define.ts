/**
 * Preset modules (V2-FX-MOD): one file per preset under src/v2/presets/<kind>/<id>.ts (or <kind>/<id>/index.ts) whose
 * default export is one of these `define*` calls. Files are discovered automatically (see ./index.ts), validated at
 * load and registered everywhere: registry, pickers and tiles, inspector param controls, preview + export renderer,
 * storyboard importer, and the generated AI guide / presets.json / llms.txt. Guide: docs/v2/ADDING_EFFECTS.md.
 *
 * Only types are imported here, so a module file stays a pure, dependency-free description plus render function.
 */
import type { FontDef, PaintFn, ParamSpec, PresetAiHints, PresetKind, RenderFn, TransitionPaintFn } from "../registry/types";

interface ModuleBase {
  /** Unique within its kind; must equal the file (or folder) name. Never rename a shipped id: storyboards use it. */
  id: string;
  /** Picker label. */
  name: string;
  /** Picker tab / guide group, e.g. "Basic", "Light", "Motion". */
  category: string;
  /** One plain-English line: what it looks like and when to use it. Shown in tooltips and to planner AIs. */
  description: string;
  /** Behaviour version (default 1). Bump when the look or motion of a shipped id changes. */
  version?: number;
  /** Tunable values; each needs a `description` with its unit (seconds, pixels, fraction of …). */
  params?: ParamSpec[];
  /** Tile hint: `icon` glyph, or sample `text` for text tiles. Tiles live-render the preset anyway. */
  preview?: { icon?: string; text?: string };
  /** Planner-AI hints: when to use it, when not to, example params. */
  ai?: PresetAiHints;
  /** Sort position within the kind (lower first). Omit it: new presets go after the built-ins, by id. */
  order?: number;
  /**
   * Render-type key. Omit it (defaults to "<kind>/<id>"). Presets that share one render function with different
   * defaults may share a type; they must then pass the very same function.
   */
  type?: string;
}

/** Text animation: map the text frame at progress p. In: p 0 → hidden, 1 → shown; out: fed 1 - progress; loop: phase. */
export interface TextAnimModule extends ModuleBase { kind: "textAnimIn" | "textAnimOut" | "textAnimLoop"; frame: RenderFn }
/** Text effect: set `fx` (glow, neon, hollow, echo, colour) on the text frame. */
export interface TextEffectModule extends ModuleBase { kind: "effect"; frame: RenderFn }
/**
 * Video effect (effect layer over the main track; p = progress through the effect clip). `frame` changes the cheap
 * per-frame fields (alpha, dx/dy, scale, blur, gray, vignette); `draw` is an optional canvas pass run afterwards on
 * the composited picture (bloom, grain, colour grade, light leak). At least one of them is required.
 */
export interface VideoEffectModule extends ModuleBase { kind: "videoEffect"; frame?: RenderFn; draw?: PaintFn }
/**
 * Transition across a cut (p = progress through the overlap). `frame` sets mixOut/mixIn and the per-side look
 * tOut/tIn; `paint` optionally draws on each side after its look (overlays, light leaks, flares).
 */
export interface TransitionModule extends ModuleBase { kind: "transition"; frame: RenderFn; paint?: TransitionPaintFn; popular?: boolean }
/** Sticker: SVG markup (use `svg()` from ../_lib/sticker for the standard 200 × 200 viewBox). */
export interface StickerModule extends Omit<ModuleBase, "params" | "type"> { kind: "sticker"; svg: string }
/** Text style: one-tap text clip fields (font id, colour, stroke, shadow, effect, animations…); no render function. */
export interface TextStyleModule extends Omit<ModuleBase, "params" | "type"> { kind: "textStyle"; data: TextStyleData }
/**
 * Blend mode (V2-SB-128): how a clip mixes with what is under it. `op` is a canvas composite operation that renders
 * the same in preview and export on every supported browser (see BLEND_OPS); no render function.
 */
export interface BlendModule extends Omit<ModuleBase, "params" | "type"> { kind: "blend"; op: BlendOp }
/** Composite operations a blend preset may use (all supported by Chrome, Safari/iOS and Firefox canvas). */
export const BLEND_OPS = ["source-over", "screen", "lighter", "lighten", "multiply", "darken", "overlay", "soft-light", "hard-light", "difference", "color-dodge", "color-burn"] as const;
export type BlendOp = (typeof BLEND_OPS)[number];
/** Curated font (system stacks only, so preview and export match offline). The id must equal the file name. */
export interface FontModule extends FontDef { kind: "font"; order?: number }

/** Fields a textStyle may set; the importer and text panel read these. `font` is a font id, `size` a fraction of frame height. */
export interface TextStyleData {
  font?: string; bold?: boolean; italic?: boolean; color?: string; size?: number;
  strokeWidth?: number; strokeColor?: string; letterSpacing?: number; lineHeight?: number; align?: "left" | "center" | "right";
  shadow?: { color: string; blur: number; x: number; y: number } | null;
  background?: { color: string; opacity: number } | null;
  effect?: string; effectColor?: string; animIn?: string; animOut?: string; loop?: string;
}

export type PresetModule = TextAnimModule | TextEffectModule | VideoEffectModule | TransitionModule | StickerModule | TextStyleModule | BlendModule | FontModule;
export type ModuleKind = PresetKind | "font";

/** Generic form: `export default definePreset({ kind: "videoEffect", id: "glow", … })`. */
export const definePreset = <M extends PresetModule>(m: M): M => m;

type Def<M extends { kind: unknown }> = (m: Omit<M, "kind">) => M;
const def = <M extends PresetModule>(kind: M["kind"]): Def<M> => (m) => ({ ...m, kind }) as M;
export const defineTextAnimIn = def<TextAnimModule>("textAnimIn");
export const defineTextAnimOut = def<TextAnimModule>("textAnimOut");
export const defineTextAnimLoop = def<TextAnimModule>("textAnimLoop");
/** Kept for symmetry with the others: `defineTextAnim("textAnimIn", {...})`. */
export const defineTextAnim = (kind: TextAnimModule["kind"], m: Omit<TextAnimModule, "kind">): TextAnimModule => ({ ...m, kind });
export const defineTextEffect = def<TextEffectModule>("effect");
export const defineVideoEffect = def<VideoEffectModule>("videoEffect");
export const defineTransition = def<TransitionModule>("transition");
export const defineSticker = def<StickerModule>("sticker");
export const defineTextStyle = def<TextStyleModule>("textStyle");
export const defineBlend = def<BlendModule>("blend");
export const defineFont = def<FontModule>("font");
