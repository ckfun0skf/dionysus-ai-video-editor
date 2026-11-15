/**
 * Clip type plugins (P65, Phase 1 step 1.1 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): the **core** part of a clip type
 * (pure data, no DOM). One folder per type, `src/v2/clipTypes/<id>/core.ts`, default-exporting `defineClipType({…})`.
 *
 * The core has only `trackKind` and `caps` so far (the domain predicates read them since P66). Later steps add the rest of the
 * interface sketched in the design doc (§3: data schema, duration rules, storyboard mapping, agent tools and rules,
 * validation) and the render/ui parts, and move today's `clipType` switches onto the registry one surface at a time.
 *
 * Only `import type` from `domain` is allowed here (architecture test), so `domain` can use the registry without a
 * runtime import cycle.
 */
import type { MediaKind, Placement, TrackKind } from "../domain/model";

/** What a clip type can do. These replace the scattered predicates; the parity test pins each one to today's code. */
export interface ClipCaps {
  /** Has media time that trim / slip / speed / reverse and frame-precise in/out work on (`canSetRange`): video, audio. */
  sourceTime: boolean;
  /** Holds one source frame: source in stays 0 on trim and split (`isStill`): image, text, effect. */
  still: boolean;
  /** Has sound: volume, volume keys, audio effects, export audio mix (`hasSound`): video, audio. */
  sound: boolean;
  /** Drawn on the canvas as a picture (video, image, html, text and the image variants); audio and effect clips are not. */
  visual: boolean;
  /** Chroma key applies (`canChromaKey`): video, image, html (and, as today, the image variants). */
  keyable: boolean;
  /** Shows a thumbnail on the timeline and is flagged when it has none (`needsThumb`): video, image, html. */
  thumb: boolean;
  /** Reads a project asset version ("media": video, image, audio, html) or carries its own data ("none": text, effect, …). */
  asset: "media" | "none";
}

/**
 * A variant of another type stored under the other type's `clipType` plus a flag, so saved projects never change:
 * P35 placeholder and P36 blank are `clipType: "image"` with `placeholder` / `blank` set.
 */
export interface ClipVariant {
  /** The stored `clipType`. */
  of: MediaKind;
  /** The Placement field that marks the variant (truthy = this variant). */
  field: keyof Placement;
  /** When several variant flags are set, the highest priority wins (default 0). Placeholder outranks blank, as the player always drew it. */
  priority?: number;
}

export interface ClipTypeCore {
  /** The folder name. Built-ins use the stored `clipType` (or the variant name). Never rename a shipped id. */
  id: string;
  /** Behaviour version (like presets, default 1). Bump when the look or behaviour of existing data changes. */
  version: number;
  /** One plain-English line for developers and, later, the AI guide. */
  description: string;
  /** The track kind that holds it (today's `trackKindFor`). */
  trackKind: TrackKind;
  caps: ClipCaps;
  /** Set for variants (placeholder, blank); see `variantOf`. */
  variant?: ClipVariant;
}

/** Input for `defineClipType`: `version` may be omitted (1). */
export type ClipTypeDef = Omit<ClipTypeCore, "version"> & { version?: number };
