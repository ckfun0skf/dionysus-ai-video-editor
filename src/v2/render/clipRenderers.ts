/// <reference types="vite/client" />
/**
 * Clip renderers (P67, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 step 1.3). Each `src/v2/clipTypes/<id>/render.ts`
 * default-exports a `ClipRenderer` for one clip type (the variant id for placeholder / blank). The Player asks this
 * table first and keeps the shared host work: layer order, effects and their scopes, transitions, scene capture
 * layers, blend, the clip box, the hidden-track rule, and the media/HTML element pools. Preview and export both
 * draw through `Player.draw()` (export via `renderAt`), so a renderer runs identically in both; it may branch on
 * `host.offline` only where the look is meant to differ (the placeholder slate is black in export).
 *
 * P67 moved text, placeholder and blank. Video, image, audio and html still draw inline in player.ts and move in the
 * second half of step 1.3.
 */
import type { Placement, Track } from "../domain/model";
import { CLIP_TYPES, variantOf } from "../clipTypes";
import type { ActiveLayer, Placed } from "./frame";

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

export interface ClipRenderer {
  /** The clip type id (folder name). */
  id: string;
  /** Draw this clip for the current frame. Called only with a canvas and for a visible track. */
  draw(host: ClipDrawHost): void;
}

/** Problems with one renderer module (empty = valid). */
export function checkClipRenderer(r: unknown, folder: string): string[] {
  const x = r as Partial<ClipRenderer> | undefined;
  if (!x || typeof x !== "object") return ["no default export (export default { id, draw })"];
  const out: string[] = [];
  if (x.id !== folder) out.push(`id "${String(x.id)}" must equal its folder name "${folder}"`);
  if (typeof x.draw !== "function") out.push("draw must be a function");
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

/** The renderer for a placement (its variant first), or undefined while that type still draws inline in the Player. */
export const clipRendererFor = (p: Placement): ClipRenderer | undefined => CLIP_RENDERERS.get(variantOf(p));
