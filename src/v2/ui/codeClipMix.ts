/**
 * P54: shared helpers for the params-aware code-clip preview and its Mix composite.
 * Storyboard AssetPreview and the Code Editor (timeline or board) both use these so a shot's /
 * layer's / placement's values and the picture underneath match preview and export.
 */
import { findPlacement, secondsToTicks, type AssetSlot, type HtmlParamValues, type Placement, type Project, type Shot } from "../domain";
import { placeRect, withBlend, type Player } from "../render";

/** A frame of everything under a code clip, plus any computed ctx.inputs at that time. */
export interface MixFrame {
  image?: CanvasImageSource;
  inputs?: Record<string, unknown>;
}

/** Load the picture (and inputs) under the clip at clip-local seconds `t`. */
export type MixUnderlayFn = (t: number) => MixFrame | Promise<MixFrame | undefined> | undefined;

/**
 * Timeline ticks at which source time `tSec` of `p` is shown (inverse of `sourceAt`, for Mix
 * and for posting `ctx.inputs` at the matching playhead).
 */
export function clipLocalToTicks(p: Placement, tSec: number): number {
  const sourceTicks = secondsToTicks(tSec);
  if (p.freeze) return p.startTicks;
  const s = p.speed ?? 1;
  const delta = sourceTicks - p.sourceInTicks;
  const o = p.reverse ? p.durationTicks - delta / (s || 1) : delta / (s || 1);
  return Math.round(p.startTicks + Math.min(Math.max(0, o), Math.max(0, p.durationTicks - 1)));
}

/** The timeline html placement this storyboard preview is of (after Send to timeline). */
export function htmlPlacementOf(project: Project, opts: { shotId?: string; layerId?: string; assetId?: string }): Placement | undefined {
  const comp = project.compositions[project.rootCompositionId];
  if (!comp) return;
  const html: Placement[] = [];
  for (const t of comp.tracks) for (const p of t.placements) if (p.clipType === "html") html.push(p);
  if (opts.layerId && opts.shotId) {
    const hit = html.find((p) => p.storyShot === opts.shotId && p.storyLayer === opts.layerId);
    if (hit) return hit;
  }
  if (opts.shotId) {
    const main = html.find((p) => p.storyShot === opts.shotId && !p.storyLayer);
    if (main) return main;
    const any = html.find((p) => p.storyShot === opts.shotId);
    if (any) return any;
  }
  if (opts.assetId) return html.find((p) => p.source.assetId === opts.assetId);
}

/**
 * Per-use param values to show for an html preview: the shot's `params` when previewing that
 * shot's clip, else the first layer or shot on the board that uses this slot.
 */
export function htmlPreviewParams(project: Project, opts: { shot?: Shot; slot?: Pick<AssetSlot, "id"> }): HtmlParamValues | undefined {
  if (opts.shot?.params && Object.keys(opts.shot.params).length) return opts.shot.params;
  const b = project.storyboard;
  if (!b || !opts.slot) return opts.shot?.params;
  const slotId = opts.slot.id;
  for (const id of b.order) {
    const s = b.shots[id];
    if (!s) continue;
    if (s.clipSlot === slotId && s.params && Object.keys(s.params).length) return s.params;
    const layer = (s.layers ?? []).find((l) => l.type === "html" && "asset" in l && (l as { asset: string }).asset === slotId) as { params?: HtmlParamValues } | undefined;
    if (layer?.params && Object.keys(layer.params).length) return layer.params;
  }
  return undefined;
}

function sourceSize(src: CanvasImageSource, fallbackW: number, fallbackH: number): { w: number; h: number } {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
    return { w: src.videoWidth || src.width || fallbackW, h: src.videoHeight || src.height || fallbackH };
  }
  if ("width" in src && "height" in src) return { w: Number(src.width) || fallbackW, h: Number(src.height) || fallbackH };
  return { w: fallbackW, h: fallbackH };
}

/** Paint `underlay` then the clip bitmap with the placement's transform, fade, opacity and blend. */
export function paintMixFrame(
  ctx: CanvasRenderingContext2D,
  underlay: CanvasImageSource | undefined,
  bmp: CanvasImageSource | undefined,
  placement?: Placement,
  atTicks?: number,
): void {
  if (!ctx.canvas) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  if (underlay) ctx.drawImage(underlay, 0, 0, w, h);
  if (bmp) {
    const { w: bw, h: bh } = sourceSize(bmp, w, h);
    if (placement) {
      const r = placeRect(placement, bw, bh, w, h, atTicks);
      withBlend(ctx, placement.blend, () => {
        ctx.save();
        ctx.globalAlpha = r.alpha;
        ctx.translate(r.cx, r.cy);
        ctx.rotate(r.rot);
        ctx.drawImage(bmp, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
        ctx.restore();
      });
    } else {
      ctx.drawImage(bmp, 0, 0, w, h);
    }
  }
  ctx.restore();
}

/** Snapshot everything under `placement` at clip-local `tSec` from the live timeline player. */
export function mixFromPlayer(player: Player, placement: Placement, tSec: number): MixFrame | undefined {
  return player.snapshotWithout(placement.id, clipLocalToTicks(placement, tSec));
}

/** Resolve a placement from the project (same helper the player uses). */
export function placementIn(project: Project, id: string): Placement | undefined {
  const comp = project.compositions[project.rootCompositionId];
  return comp ? findPlacement(comp, id)?.placement : undefined;
}
