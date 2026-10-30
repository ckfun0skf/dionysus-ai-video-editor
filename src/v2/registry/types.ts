/**
 * Preset registry types (V2-097). A preset is a serializable descriptor (plain JSON: id, kind, category, name,
 * params schema + defaults, preview hint, and a `type` key) plus a pure render function looked up by `type` in the
 * code registry. Descriptors can be loaded from JSON or a backend; render functions ship with the code.
 */
/**
 * `effect` = text styling (Glow/Neon…); `videoEffect` = effect-layer presets applied to the main-track render (V2-101);
 * `textStyle` = one-tap text looks (formerly TEXT_TEMPLATES): plain data in `data`, no animation of its own;
 * `blend` = how a clip mixes with the layers under it (V2-SB-128): a canvas composite operation in `data.op`;
 * `audioFx` = a sound effect on an audio or video clip (P3B-11): a Web Audio chain description in `data`.
 */
export type PresetKind = "textAnimIn" | "textAnimOut" | "textAnimLoop" | "effect" | "videoEffect" | "transition" | "sticker" | "textStyle" | "blend" | "audioFx";
export const PRESET_KINDS: PresetKind[] = ["textAnimIn", "textAnimOut", "textAnimLoop", "effect", "videoEffect", "transition", "sticker", "textStyle", "blend", "audioFx"];

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
  /**
   * Optional hints for planner AIs (V2-FX-MOD), printed next to the description in the generated guide and presets.json:
   * when to pick the preset, when not to, and example params.
   */
  ai?: PresetAiHints;
}
export interface PresetAiHints { use?: string; avoid?: string; example?: Params }

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
  /**
   * Video effects with a `draw` hook (V2-FX-MOD): extra canvas passes run after the frame's transform/filter, in order,
   * on the composited picture. Not serializable; produced by `applyPreset`, consumed by `applyEffectFrame`.
   */
  passes?: PaintPass[];
}
/** 2D context type shared by on-screen, offscreen and export canvases. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/**
 * What the renderer hands a canvas hook: the target context (already showing the picture), its size in pixels, and
 * `scratch(w, h, slot?)`, a reusable offscreen context (cleared, sized w × h; one per slot) for blur/bloom-style work.
 * `scratch` returns undefined where no offscreen canvas exists (tests, very old browsers): skip the pass then.
 */
export interface PaintEnv { ctx: Ctx2D; w: number; h: number; scratch: (w: number, h: number, slot?: number) => Ctx2D | undefined }
export type PaintPass = (env: PaintEnv) => void;
/** A preset's canvas hook: `PaintEnv` plus the preset's progress and resolved params. */
export interface PaintArgs extends PaintEnv { p: number; params: Params }
export type PaintFn = (a: PaintArgs) => void;
/**
 * Transition canvas hook: called once per side (`"out"` / `"in"`) after that side is drawn with its look, inside its
 * clip. `mix` is that side's opacity at this progress (mixOut / mixIn), e.g. to fade an overlay with its clip.
 */
export type TransitionPaintFn = (a: PaintArgs & { side: "out" | "in"; mix: number }) => void;
/** Optional canvas hooks of a render `type` (see `HOOKS` in renderers.ts). */
export interface RenderHooks { draw?: PaintFn; paint?: TransitionPaintFn }
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
  /** Transition `paint` hook (V2-FX-MOD) bound to this side, run after the side is drawn (inside its clip). */
  paint?: PaintPass;
}
/** Preset ids are lowercase-friendly slugs; "@" is reserved for version pins (`ken-burns@2`). */
export const PRESET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const identityFrame = (): PresetFrame => ({ alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1 });

/** Pure: returns a new frame given the incoming one, progress and resolved params. Must not throw for p in [0,1]. */
export type RenderFn = (f: PresetFrame, p: number, params: Params) => PresetFrame;

/**
 * Curated font (V2-FX-MOD: one module per font in src/v2/presets/font/). System stacks only (no network), so preview
 * and export match offline and on iOS Safari. Ids are part of the storyboard format: never rename one.
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

/** One audio effect chain, applied in this order: filters → drive → ring mod → echo → reverb → makeup gain. */
export interface AudioFxData {
  /** High-pass cutoff in Hz at full amount (removes lows: thin phone/radio sound). */
  highpass?: number;
  /** Low-pass cutoff in Hz at full amount (removes highs: muffled, underwater, behind a wall). */
  lowpass?: number;
  /** Peaking boost: centre frequency (Hz), gain (dB at full amount) and Q. Presence for radio / megaphone. */
  peak?: { freq: number; gainDb: number; q?: number };
  /** Soft-clip drive 0–1 at full amount (crunch of a cheap speaker). */
  drive?: number;
  /** Ring modulation: carrier frequency in Hz, wet mix 0–1 at full amount (robot voice). */
  ringMod?: { freq: number; mix: number };
  /** Feedback echo: delay in seconds (0.005–2), feedback 0–0.95, wet mix 0–1 at full amount. */
  echo?: { time: number; feedback: number; mix: number };
  /** Reverb from a deterministic noise impulse: length in seconds (0.1–6), decay curve exponent, wet mix 0–1 at full amount. */
  reverb?: { seconds: number; decay: number; mix: number; preDelay?: number };
  /** Output gain multiplier at full amount (compensates level lost in the filters). */
  makeup?: number;
}
