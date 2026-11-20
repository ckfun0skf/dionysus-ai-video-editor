/// <reference types="vite/client" />
/**
 * Clip renderers (P67, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 step 1.3). Each `src/v2/clipTypes/<id>/render.ts`
 * default-exports a `ClipRenderer` for one clip type (the variant id for blank). A placeholder of any type is drawn by
 * the host slate (render/placeholderSlate.ts, P73) before any plugin lookup. The Player asks this
 * table first and keeps the shared host work: layer order, effects and their scopes, transitions, scene capture
 * layers, blend, the clip box, the hidden-track rule, and the media/HTML element pools. Preview and export both
 * draw through `Player.draw()` (export via `renderAt`), so a renderer runs identically in both; it may branch on
 * `host.offline` only where the look is meant to differ (the placeholder slate is black in export).
 *
 * P67 moved text, placeholder and blank (stateless `draw`; P73 moved the placeholder into shared host code and made
 * the unknown-type fallback a stateless slate). P68 moved html, video, image and audio (stateful `frame`: they keep media elements, iframes and load state in the Player's pools,
 * reached through `host.media`, and run every frame for a visible clip even without a canvas, e.g. to keep audio in
 * sync).
 */
import type { AssetVersion, Placement, Project, Track } from "../domain/model";
import type { HtmlClipInput, HtmlClipManifest } from "../domain/htmlClipPackage";
import type { TrackSignal } from "../domain/tracking";
import type { SceneDoc } from "../domain/scene";
import { CLIP_TYPES, UNKNOWN_CLIP_TYPE, isPlaceholder, variantOf } from "../clipTypes";
import { PLACEHOLDER_RENDERER } from "./placeholderSlate";
import { PLUGIN_SLATE_RENDERER } from "./pluginSlate";
import type { ActiveLayer, Placed } from "./frame";
import type { ClipLoad } from "./stability";
import type { HtmlClipHost } from "./htmlClip";
import type { ExportVideoFrames } from "./export/videoFrames";
import type { SpatialStage } from "./spatial";
import type { BeatSignal, SceneSignal } from "./signals";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** What the Player gives a renderer for one clip in one frame. */
export interface ClipDrawHost {
  /** The output canvas context and its size in pixels. */
  g: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Timeline time being drawn (ticks). */
  time: number;
  /** True when exporting (`renderAt`), false in the live preview. */
  offline: boolean;
  track: Track;
  /** The clip with its layer style merged (`effectivePlacement`). */
  placement: Placement;
  /** Source time at `time` (ticks), after speed / reverse / freeze. */
  sourceTicks: number;
  /** Transition opacity for this side (undefined = 1) and its extra look. */
  mix: number | undefined;
  tfx: ActiveLayer["tfx"];
  /** Record the clip's on-canvas box (handles, hit tests). */
  setBox(r: Placed): void;
  /** Composite through the host: scene capture layers, overlay-scope effects, code-transition capture, then blend. */
  paint(blend: string | undefined, fn: (dc: CanvasRenderingContext2D) => void): void;
  /** Draw a `srcW`×`srcH` picture placed at `r` with the clip's mask and crop (the Player's `blit` → `paintClip`). */
  blit(g: Ctx2D, srcW: number, srcH: number, r: Placed, draw: (g: Ctx2D) => void): void;
}

export type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

/** Per-frame state the stateful renderers add to (read by the Player after the clip loop). */
export interface ClipFrameState {
  /** Placements with a live element or iframe this frame (others are paused / disposed). */
  live: Set<string>;
  /** Per-clip loading progress (timeline badges). */
  loads: Map<string, ClipLoad>;
  /** A playing source is short of data (holds the playhead). */
  stalled: boolean;
  /** A visible source has no picture yet (preview shows the last good frame). */
  missing: boolean;
  /** Playing but held for buffering / playing and advancing. */
  holding: boolean;
  run: boolean;
}

/** The Player's media pools and services (P68). Stateful renderers reach the Player only through this. */
export interface ClipMediaHost {
  readonly playing: boolean;
  readonly previewMute: boolean;
  readonly project: Project;
  readonly audioCtx: AudioContext | undefined;
  /** Export only: frame-accurate WebCodecs decoding for the video clips it handles. */
  readonly exportVideo: ExportVideoFrames | undefined;
  /** The chroma key to apply (none while the eyedropper samples this clip). */
  keyOf(p: Placement): Placement["chromaKey"];
  /** Object URL for a blob, or undefined while it loads (the Player redraws when it resolves). */
  url(blobKey: string): string | undefined;
  /** The pooled element for a placement (recreated when `src` changes). */
  element(placementId: string, kind: string, src: string): MediaEl;
  /** Mark the placement's element as used now (idle LRU). */
  touch(placementId: string): void;
  gainFor(el: HTMLMediaElement, fx: Placement["audioFx"], spatialKey: string): GainNode | undefined;
  spatialStage(el: HTMLMediaElement): SpatialStage | undefined;
  stalledEls: WeakSet<HTMLMediaElement>;
  poster(placementId: string): { img: HTMLCanvasElement; w: number; h: number; at: number } | undefined;
  noteFrame(placementId: string, el: HTMLVideoElement, drawable: boolean, sourceIn: number): void;
  armFrame(el: HTMLVideoElement): void;
  htmlHost(placementId: string, blobKey: string, w: number, h: number): HtmlClipHost;
  manifest(blobKey: string): HtmlClipManifest | undefined;
  /** P74: the sandboxed scene page of a scene clip (one iframe per placement, like `htmlHost`). */
  sceneHost(placementId: string, blobKey: string, w: number, h: number): HtmlClipHost;
  /** P74: the parsed scene document of a version blob: undefined while it loads, null when it can't be read. */
  sceneDoc(blobKey: string): SceneDoc | null | undefined;
  setHtmlOverride(placementId: string, params: Placement["htmlParams"]): void;
  inputsFor(p: Placement, decls: Record<string, HtmlClipInput>, canvas: HTMLCanvasElement): Record<string, BeatSignal | SceneSignal | TrackSignal> | undefined;
  /** Last ctx.inputs signature per html placement. */
  inputSig: Map<string, string>;
}

/** What the Player gives a stateful renderer for one clip with an asset version on a visible track, every frame. */
export interface ClipFrameHost extends Omit<ClipDrawHost, "g" | "width" | "height"> {
  /** The output canvas and context, when there is one (both may be absent: elements are still synced). */
  g: CanvasRenderingContext2D | null | undefined;
  canvas: HTMLCanvasElement | undefined;
  version: AssetVersion;
  frame: ClipFrameState;
  media: ClipMediaHost;
}

export interface ClipRenderer {
  /** The clip type id (folder name). */
  id: string;
  /** Stateless: draw this clip for the current frame. Called only with a canvas and for a visible track. */
  draw?(host: ClipDrawHost): void;
  /** Stateful (media, iframes): run for a clip with an asset version on a visible track, with or without a canvas. */
  frame?(host: ClipFrameHost): void;
}

/** Problems with one renderer module (empty = valid). */
export function checkClipRenderer(r: unknown, folder: string): string[] {
  const x = r as Partial<ClipRenderer> | undefined;
  if (!x || typeof x !== "object") return ["no default export (export default { id, draw })"];
  const out: string[] = [];
  if (x.id !== folder) out.push(`id "${String(x.id)}" must equal its folder name "${folder}"`);
  if ((typeof x.draw === "function") === (typeof x.frame === "function")) out.push("exactly one of draw / frame must be a function");
  if (typeof x.id === "string" && !CLIP_TYPES.core(x.id)) out.push(`no clip type "${x.id}" is registered (add clipTypes/${x.id}/core.ts)`);
  return out;
}

export function loadClipRenderers(found: Record<string, { default?: ClipRenderer }>): { renderers: Map<string, ClipRenderer>; problems: string[] } {
  const renderers = new Map<string, ClipRenderer>();
  const problems: string[] = [];
  for (const [path, mod] of Object.entries(found).sort(([a], [b]) => a.localeCompare(b))) {
    const folder = path.split("/").at(-2) ?? "";
    const issues = checkClipRenderer(mod.default, folder);
    if (issues.length) { problems.push(...issues.map((i) => `${path}: ${i}`)); continue; }
    renderers.set(folder, mod.default!);
  }
  return { renderers, problems };
}

const found = import.meta.glob<{ default?: ClipRenderer }>("../clipTypes/*/render.ts", { eager: true });
export const { renderers: CLIP_RENDERERS, problems: CLIP_RENDERER_PROBLEMS } = loadClipRenderers(found);
export const CLIP_RENDERER_PATHS = Object.keys(found);
if (CLIP_RENDERER_PROBLEMS.length) console.error(`[clipRenderers] ${CLIP_RENDERER_PROBLEMS.length} invalid renderer module(s):\n  ${CLIP_RENDERER_PROBLEMS.join("\n  ")}`);

/**
 * The renderer for a placement: a placeholder of any type gets the host slate first (P73, decision 9; plugins never
 * draw placeholders), then its variant, then the `unknown` renderer for a `clipType` this build does not
 * register. Undefined only for a registered type without a renderer (effect: applied by the Player, never drawn).
 */
export const clipRendererFor = (p: Placement): ClipRenderer | undefined => {
  if (isPlaceholder(p)) return PLACEHOLDER_RENDERER;
  const id = variantOf(p);
  const core = CLIP_TYPES.core(id);
  if (core?.plugin) return PLUGIN_SLATE_RENDERER; // P84: registered plugin type (its sandboxed renderer comes in P85)
  return CLIP_RENDERERS.get(id) ?? (core ? undefined : CLIP_RENDERERS.get(UNKNOWN_CLIP_TYPE));
};
