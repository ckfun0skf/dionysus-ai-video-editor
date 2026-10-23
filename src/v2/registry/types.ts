/**
 * Preset registry types (V2-097). A preset is a serializable descriptor (plain JSON: id, kind, category, name,
 * params schema + defaults, preview hint, and a `type` key) plus a pure render function looked up by `type` in the
 * code registry. Descriptors can be loaded from JSON or a backend; render functions ship with the code.
 */
export type PresetKind = "textAnimIn" | "textAnimOut" | "textAnimLoop" | "effect" | "transition" | "sticker";
export const PRESET_KINDS: PresetKind[] = ["textAnimIn", "textAnimOut", "textAnimLoop", "effect", "transition", "sticker"];

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
  /** Key into the render-function registry. Several descriptors may share one type with different defaults. */
  type: string;
  params: ParamSpec[];
  /** Short glyph/hint for list tiles; tiles normally live-render the preset itself. */
  preview: { icon?: string; text?: string };
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
  /** Stickers: SVG markup to draw. */
  svg?: string;
}
export const identityFrame = (): PresetFrame => ({ alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1 });

/** Pure: returns a new frame given the incoming one, progress and resolved params. Must not throw for p in [0,1]. */
export type RenderFn = (f: PresetFrame, p: number, params: Params) => PresetFrame;
