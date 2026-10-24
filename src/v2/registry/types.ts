/**
 * Preset registry types (V2-097). A preset is a serializable descriptor (plain JSON: id, kind, category, name,
 * params schema + defaults, preview hint, and a `type` key) plus a pure render function looked up by `type` in the
 * code registry. Descriptors can be loaded from JSON or a backend; render functions ship with the code.
 */
/**
 * `effect` = text styling (Glow/Neon…); `videoEffect` = effect-layer presets applied to the main-track render (V2-101);
 * `textStyle` = one-tap text looks (formerly TEXT_TEMPLATES): plain data in `data`, no animation of its own.
 */
export type PresetKind = "textAnimIn" | "textAnimOut" | "textAnimLoop" | "effect" | "videoEffect" | "transition" | "sticker" | "textStyle";
export const PRESET_KINDS: PresetKind[] = ["textAnimIn", "textAnimOut", "textAnimLoop", "effect", "videoEffect", "transition", "sticker", "textStyle"];

/**
 * One preset parameter. `description` is an optional plain-English note on what the value means (its unit, or what it
 * is a fraction of); it is shown as the editor's tooltip and in the generated planner guide and presets.json, so
 * ambiguous params should always have one.
 */
export type ParamSpec = ParamBase & (
  | { type: "number"; min: number; max: number; step?: number; default: number }
  | { type: "color"; default: string }
  | { type: "string"; default: string });
interface ParamBase { key: string; label: string; description?: string }
export type Params = Record<string, number | string>;

export interface PresetDescriptor {
  id: string;
  kind: PresetKind;
  category: string;
  name: string;
  /**
   * Behaviour version, starting at 1. Bump it whenever the look or motion of an existing id changes, so storyboards that
   * pin `id@N` (docs/v2/STORYBOARD_FORMAT.md §3) get a warning instead of a silent change.
   */
  version: number;
  /** One line in plain English: what it looks like and when to use it. Shown to planner AIs in the generated guide. */
  description: string;
  /** Key into the render-function registry. Several descriptors may share one type with different defaults. */
  type: string;
  params: ParamSpec[];
  /** Short glyph/hint for list tiles; tiles normally live-render the preset itself. */
  preview: { icon?: string; text?: string };
  /**
   * Kind-specific static data. `textStyle`: text clip fields to apply (font is a curated font id, see fonts.ts; size is a
   * fraction of frame height), e.g. `{ "font": "impact", "color": "#ffe14d", "strokeWidth": 0.08 }`.
   */
  data?: Record<string, unknown>;
}

/** Text effect styling produced by `effect` presets. */
export interface FxStyle { glowBlur?: number; neon?: boolean; hollow?: boolean; echo?: { dx: number; dy: number; alpha: number }[]; color?: string }

/**
 * What a preset produces at normalized progress p (0..1). Fields multiply/add onto the identity frame.
 * clip = visible inset fractions [left, top, right, bottom]; filter = CSS/canvas filter string.
 */
export interface PresetFrame {
  alpha: number; dx: number; dy: number; scale: number; rot: number; chars: number;
  clip?: [number, number, number, number];
  filter?: string;
  /** Transitions: opacity of the outgoing / incoming clip. */
  mixOut?: number; mixIn?: number;
  /** Transitions (V2-TL-TRANS): extra per-layer look of the outgoing / incoming clip (motion, blur, wipe, tint). */
  tOut?: TransLayer; tIn?: TransLayer;
  fx?: FxStyle;
  /** Video effects: blur radius as a fraction of frame height, grayscale 0..1, vignette strength 0..1. */
  blur?: number; gray?: number; vignette?: number;
  /** Stickers: SVG markup to draw. */
  svg?: string;
}
/**
 * How one side of a transition is drawn on top of its normal placement, in frame space. Offsets are fractions of the
 * frame width / height, `scale` and `rot` (degrees) act about the frame centre, `blur` is a fraction of the frame height,
 * `clip` keeps only the inset rectangle [left, top, right, bottom] (fractions), `iris` keeps a centred circle whose
 * radius is a fraction of the frame's half-diagonal, `glitch` shifts horizontal bands by up to that fraction of the
 * width (`seed` picks the pattern), and `tint` paints a colour over the frame at `tintAlpha`.
 */
export interface TransLayer {
  dx?: number; dy?: number; scale?: number; rot?: number; blur?: number;
  clip?: [number, number, number, number]; iris?: number; glitch?: number; seed?: number;
  tint?: string; tintAlpha?: number;
}
export const identityFrame = (): PresetFrame => ({ alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1 });

/** Pure: returns a new frame given the incoming one, progress and resolved params. Must not throw for p in [0,1]. */
export type RenderFn = (f: PresetFrame, p: number, params: Params) => PresetFrame;
