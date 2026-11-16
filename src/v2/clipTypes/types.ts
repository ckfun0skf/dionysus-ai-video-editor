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
import type { MediaKind, Placement, Project, TrackKind } from "../domain/model";
import type { StoryAssetType } from "../domain/storyJson";

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
  /** P71: which imported files become an asset of this kind (`mediaKindOf`) and the MIME guessed from a file extension (`mimeOf`). */
  accepts?: ClipAccepts;
  /** P71: storyboard mapping (slot types, Send lengths, Sync layer and slot types). Omitted = `DEFAULT_CLIP_STORY`. */
  story?: ClipStory;
  /** P72: what the type adds to the agent surface (WebMCP tools, AI guide rules, get_timeline fields) and which host tools and properties are its own. */
  agent?: ClipAgent;
}

/** P72: a WebMCP tool a clip type contributes (registered after the built-in tools and listed by gen:ai). */
export interface ClipAgentToolDef { name: string; title: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }
/** P72: what a contributed tool may use: read the project and make one undoable edit (a pure project → project step). */
export interface ClipAgentApi {
  project(): Project;
  /** One undo step; false when nothing changed. */
  edit(label: string, apply: (p: Project) => Project): boolean;
  /**
   * P78: the project's media store, when the host has one (WebMCP in the app does), for types whose data lives in an
   * asset version's blob (a scene): read it, and write a new version's blob before `edit` points the clip at it.
   */
  blobs?: { get(key: string): Promise<Blob | undefined>; put(key: string, blob: Blob): Promise<void> };
}
export interface ClipAgentResult { ok: boolean; changed: boolean; text: string }

/** P72: a clip type's agent surface. Built-ins contributed no tools or rules in Phase 1; the scene type (P78) is the first that does. */
export interface ClipAgent {
  /** New WebMCP tools (appended to TIMELINE_TOOLS, so the guide and WEB_MCP.md list them). Needs `run`. */
  tools?: ClipAgentToolDef[];
  /** Runs one of `tools`. */
  run?(name: string, input: Record<string, unknown>, api: ClipAgentApi): ClipAgentResult | Promise<ClipAgentResult>;
  /** AI guide rules appended after the built-in RULE_LIST (numbers are positions, so only ever append). */
  rules?: { key: string; text: string }[];
  /** Extra get_timeline / get_clip fields for a clip of this type (appended after the common ones). */
  describe?(p: Placement, project: Project): Record<string, unknown>;
  /** Built-in timeline tools that only work on clips of this type (others are refused with the tool's message). */
  clipTools?: string[];
  /** set_clip_props keys that only apply to clips of this type. */
  props?: string[];
}

/**
 * P71: file import. A file's own MIME type is checked against every type first (`mimePrefix` / `mime`), then its
 * extension (`ext`), so the lists of the built-ins must not overlap (the registry test checks it).
 */
export interface ClipAccepts {
  /** A MIME prefix that makes this kind, e.g. "video/". */
  mimePrefix?: string;
  /** Exact MIME types that make this kind, e.g. "text/html". */
  mime?: string[];
  /** Lower-case extensions (without the dot) that make this kind when the file has no matching MIME type. */
  ext: string[];
  /** MIME type to use for an extension when the file arrives without one (iOS picker). May list more than `ext` (heic). */
  mimeByExt: Record<string, string>;
}

/** P71: how a clip type maps to the storyboard (Send, Update, Sync and slot kinds). */
export interface ClipStory {
  /** Storyboard asset types whose slots hold assets of this kind (`kindForSlot`). */
  assetTypes: readonly StoryAssetType[];
  /** Slot types no type lists fall back to this kind (exactly one type: image). */
  slotFallback?: boolean;
  /** Sync: the slot type made for a timeline asset of this kind that has no slot yet. */
  slotType: StoryAssetType;
  /** Sync: the layer type written for an overlay clip of this type. */
  layerType: "video" | "image" | "html";
  /** Send: an asset of this kind can be a shot's media layer. */
  layer: boolean;
  /**
   * Send: the length of a shot clip. "planned" = the shot's durationSec (html), "still" = the default still length
   * (image), "media" = the version's trim span, else the media length, else the default still length.
   */
  sendLength: "planned" | "still" | "media";
  /** Takes with media time (video): version trim spans, shared-clip in points, layer in points, Sync trim write-back. */
  takes: boolean;
  /** Shot and layer `params` become the clip's `htmlParams` (html). */
  params: boolean;
  /**
   * P79: shots with this `render` play clips of this type (scene: render "scene"). Send places a placeholder of this
   * type (the intended type) for such a shot with no version yet, and Sync writes a main-track clip of this type that
   * has no shot back as a shot with this render and the clip's asset as its clip. Overlay clips of a type with a
   * `shotRender` and no `layer` stay timeline-only (there is no such storyboard layer).
   */
  shotRender?: "scene";
}

/** Input for `defineClipType`: `version` may be omitted (1). */
export type ClipTypeDef = Omit<ClipTypeCore, "version"> & { version?: number };
