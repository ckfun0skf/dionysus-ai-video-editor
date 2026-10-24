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

export type ParamSpec =
  | { key: string; label: string; type: "number"; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; type: "color"; default: string }
  | { key: string; label: string; type: "string"; default: string };
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
  fx?: FxStyle;
  /** Video effects: blur radius as a fraction of frame height, grayscale 0..1, vignette strength 0..1. */
  blur?: number; gray?: number; vignette?: number;
  /** Stickers: SVG markup to draw. */
  svg?: string;
}
export const identityFrame = (): PresetFrame => ({ alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1 });

/** Pure: returns a new frame given the incoming one, progress and resolved params. Must not throw for p in [0,1]. */
export type RenderFn = (f: PresetFrame, p: number, params: Params) => PresetFrame;
