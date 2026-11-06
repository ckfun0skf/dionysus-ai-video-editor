/**
 * P39 host-side tracker (classic region / template tracking, not AI segmentation). A video clip's `track` holds one
 * box per analysed source frame, in source-normalised coordinates (0–1 of the video frame), keyed by source ticks so
 * trims and slips keep it aligned. Everything here is numbers: no pixels ever leave the host analysis.
 */
import { evalKeys, sourceAt, transformAt, type Composition, type Keyframe, type Placement, type Project, type TransformKeyProp } from "./model";

/** One analysed frame: box centre x/y and size w/h (0–1 of the source frame), scale vs the first box, match confidence 0–1. */
export interface TrackSample { s: number; x: number; y: number; w: number; h: number; scale: number; conf: number; manual?: boolean }
/** `mask`: draw the clip only inside the box ("inside") or everywhere but the box ("outside"). */
export type TrackMask = "inside" | "outside";
export interface MotionTrack { samples: TrackSample[]; srcW: number; srcH: number; mask?: TrackMask }
/** Below this confidence a frame is marked unstable (yellow) in the Track sheet. */
export const UNSTABLE_CONF = 0.6;
export interface Box { x: number; y: number; w: number; h: number }
/** What a tracked clip gives a follower or a code input, in canvas terms: centre offset from the frame centre (fraction of
 * frame width/height, like Transform x/y), box size (fraction of the frame), scale vs the first box, rotation (deg). */
export interface TrackPos { x: number; y: number; width: number; height: number; scale: number; rotation: number; conf: number }

const root = (p: Project): Composition => p.compositions[p.rootCompositionId];
const all = (p: Project) => root(p).tracks.flatMap((t) => t.placements);
export const canTrack = (p: Pick<Placement, "clipType" | "freeze" | "placeholder" | "blank"> | undefined): boolean => !!p && p.clipType === "video" && !p.freeze && !p.placeholder && !p.blank;
/** Clips that can follow a tracked clip (they have a position): overlays, photos, text and code clips. */
export const canFollow = (p: Pick<Placement, "clipType"> | undefined): boolean => !!p && (p.clipType === "video" || p.clipType === "image" || p.clipType === "text" || p.clipType === "html");
export const trackedClips = (p: Project): Placement[] => all(p).filter((c) => !!c.motionTrack?.samples.length);

/** The tracked box at source tick `s`: linear between samples, held outside. */
export function sampleAt(tr: MotionTrack, s: number): TrackSample | undefined {
  const xs = tr.samples;
  if (!xs.length) return undefined;
  if (s <= xs[0].s) return xs[0];
  for (let i = 1; i < xs.length; i += 1) {
    const a = xs[i - 1], b = xs[i];
    if (s === b.s) return b;
    if (s <= b.s) {
      const k = (s - a.s) / (b.s - a.s || 1), m = (u: number, v: number) => u + (v - u) * k;
      return { s, x: m(a.x, b.x), y: m(a.y, b.y), w: m(a.w, b.w), h: m(a.h, b.h), scale: m(a.scale, b.scale), conf: Math.min(a.conf, b.conf) };
    }
  }
  return xs[xs.length - 1];
}

/** Map a source-normalised point of `p` to canvas offsets (fraction of the frame from its centre) at absolute time `t`. */
export function toCanvas(project: Project, p: Placement, tr: MotionTrack, nx: number, ny: number, t: number) {
  const { width: dw, height: dh } = project.settings, tf = transformAt(p, t);
  const s = Math.min(dw / tr.srcW, dh / tr.srcH) * tf.scale, fullW = tr.srcW * s, fullH = tr.srcH * s;
  const cx = dw / 2 + tf.x * dw, cy = dh / 2 + tf.y * dh;
  const lx = (nx - 0.5) * fullW, ly = (ny - 0.5) * fullH, a = (tf.rotation * Math.PI) / 180;
  return { x: (cx + lx * Math.cos(a) - ly * Math.sin(a) - dw / 2) / dw, y: (cy + lx * Math.sin(a) + ly * Math.cos(a) - dh / 2) / dh, k: fullW / dw, kh: fullH / dh, rot: tf.rotation };
}

/** Where the tracked feature of clip `p` is at absolute time `t`, in canvas terms (undefined when untracked). */
export function trackPosAt(project: Project, p: Placement, t: number): TrackPos | undefined {
  const tr = p.motionTrack, smp = tr && sampleAt(tr, sourceAt(p, t));
  if (!tr || !smp) return undefined;
  const c = toCanvas(project, p, tr, smp.x, smp.y, t);
  return { x: c.x, y: c.y, width: smp.w * c.k, height: smp.h * c.kh, scale: smp.scale * (transformAt(p, t).scale || 1), rotation: c.rot, conf: smp.conf };
}

/**
 * Keyframes that make `follower` follow tracked clip `target`: its current offset from the feature (measured at time `at`)
 * is kept; scale follows the box size, rotation the target's rotation. One key per analysed frame in their overlap.
 */
export function followKeys(project: Project, target: Placement, follower: Placement, at: number, opts: { scale?: boolean } = {}): Partial<Record<TransformKeyProp, Keyframe[]>> {
  const tr = target.motionTrack;
  if (!tr?.samples.length) throw new Error("That clip has no track yet. Track it first (track_clip).");
  const t0 = Math.max(target.startTicks, follower.startTicks), t1 = Math.min(target.startTicks + target.durationTicks, follower.startTicks + follower.durationTicks);
  if (t1 <= t0) throw new Error("The follower must overlap the tracked clip in time.");
  const a = Math.min(Math.max(at, t0), t1 - 1), p0 = trackPosAt(project, target, a)!, f0 = transformAt(follower, a);
  const step = Math.max(1, Math.round(120_000 / project.settings.fps)), x: Keyframe[] = [], y: Keyframe[] = [], sc: Keyframe[] = [], rot: Keyframe[] = [];
  for (let t = t0; t < t1; t += step) {
    const p = trackPosAt(project, target, t)!, o = t - follower.startTicks;
    x.push({ t: o, v: round(f0.x + p.x - p0.x) }); y.push({ t: o, v: round(f0.y + p.y - p0.y) });
    if (opts.scale !== false) sc.push({ t: o, v: round(f0.scale * (p.scale / (p0.scale || 1))) });
    if (p.rotation !== p0.rotation) rot.push({ t: o, v: round(f0.rotation + p.rotation - p0.rotation) });
  }
  const out: Partial<Record<TransformKeyProp, Keyframe[]>> = { x: thin(x), y: thin(y) };
  if (sc.length) out.scale = thin(sc);
  if (rot.length) out.rotation = thin(rot);
  return out;
}
const round = (v: number) => Math.round(v * 1e5) / 1e5;
/** Drop keys a straight line through their neighbours already gives (keeps the curve, fewer keys to edit). */
export function thin(keys: Keyframe[], eps = 2e-4): Keyframe[] {
  if (keys.length < 3) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i += 1) {
    const a = out[out.length - 1], c = keys[i + 1], v = evalKeys([a, c], keys[i].t)!;
    if (Math.abs(v - keys[i].v) > eps) out.push(keys[i]);
  }
  out.push(keys[keys.length - 1]);
  return out;
}

/** Validate a box an agent or the UI passes (source-normalised, inside the frame, not tiny). */
export function boxIssue(b: Partial<Box> | undefined): string | undefined {
  if (!b || ![b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v))) return "region needs numbers { x, y, w, h } (0–1 of the video frame; x/y = top-left corner).";
  if (b.w! < 0.02 || b.h! < 0.02) return "region is too small: make it at least 2% of the frame on each side.";
  if (b.x! < 0 || b.y! < 0 || b.x! + b.w! > 1.0001 || b.y! + b.h! > 1.0001) return "region must lie inside the frame (0–1).";
  return undefined;
}

/** ctx.inputs value of a "track" input (numbers only). x/y = box centre, width/height = box size, all 0–1 of the frame. */
export interface TrackSignal { x: number; y: number; width: number; height: number; scale: number; rotation: number; found: boolean }
export const NO_TRACK: TrackSignal = { x: 0.5, y: 0.5, width: 0, height: 0, scale: 1, rotation: 0, found: false };
/** Resolve a track input source ("none" / "clip:<id>") at absolute time `t`. */
export function trackSignal(project: Project, source: string, t: number): TrackSignal {
  const id = source.startsWith("clip:") ? source.slice(5) : "", p = id ? all(project).find((c) => c.id === id) : undefined;
  if (!p || t < p.startTicks || t >= p.startTicks + p.durationTicks) return NO_TRACK;
  const q = trackPosAt(project, p, t);
  if (!q) return NO_TRACK;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x: r(q.x + 0.5), y: r(q.y + 0.5), width: r(q.width), height: r(q.height), scale: r(q.scale), rotation: r(q.rotation), found: q.conf >= UNSTABLE_CONF };
}
