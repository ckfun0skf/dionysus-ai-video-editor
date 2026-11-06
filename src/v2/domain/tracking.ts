/**
 * P39/P40 host-side tracker (classic region / template tracking with a scale search, not AI segmentation). A video clip
 * can hold several named tracks (`motionTracks`). Each has a source range [inS, outS) (source ticks, so trims and slips
 * keep it aligned) and one box per analysed frame inside it, in source-normalised coordinates (0–1 of the video frame).
 * Outside the range, and on frames marked `lost` (feature left the picture or the match is too weak), there is no
 * position: code inputs get found:false, followers hold, masks hide. Everything here is numbers: no pixels.
 */
import { evalKeys, sourceAt, transformAt, type Composition, type Keyframe, type Placement, type Project, type TransformKeyProp } from "./model";

/** One analysed frame: box centre x/y and size w/h (0–1 of the source frame), scale vs the first box, confidence 0–1.
 * `lost`: no usable match (left the frame / too weak); x/y/w/h then repeat the last good box but are never used as a position. */
export interface TrackSample { s: number; x: number; y: number; w: number; h: number; scale: number; conf: number; manual?: boolean; lost?: boolean }
/** `mask`: draw the clip only inside the box ("inside") or everywhere but the box ("outside"). */
export type TrackMask = "inside" | "outside";
export interface MotionTrack { samples: TrackSample[]; srcW: number; srcH: number; mask?: TrackMask }
/** P40: one of a clip's trackers. `inS`/`outS`: the source range it covers (outS exclusive). */
export interface NamedTrack extends MotionTrack { id: string; name: string; inS: number; outS: number }
/** Below this confidence a frame is marked unstable (yellow); below LOST_CONF it counts as lost (found:false). */
export const UNSTABLE_CONF = 0.6;
export const LOST_CONF = 0.45;
export interface Box { x: number; y: number; w: number; h: number }
/** Canvas terms: centre offset from the frame centre (fraction of frame width/height, like Transform x/y), box size
 * (fraction of the frame), scale vs the first box, rotation (deg). */
export interface TrackPos { x: number; y: number; width: number; height: number; scale: number; rotation: number; conf: number }

const root = (p: Project): Composition => p.compositions[p.rootCompositionId];
const all = (p: Project) => root(p).tracks.flatMap((t) => t.placements);
export const canTrack = (p: Pick<Placement, "clipType" | "freeze" | "placeholder" | "blank"> | undefined): boolean => !!p && p.clipType === "video" && !p.freeze && !p.placeholder && !p.blank;
/** Clips that can follow a tracker (they have a position): overlays, photos, text and code clips. */
export const canFollow = (p: Pick<Placement, "clipType"> | undefined): boolean => !!p && (p.clipType === "video" || p.clipType === "image" || p.clipType === "text" || p.clipType === "html");
/** A clip's trackers (empty when none). */
export const tracksOf = (p: Pick<Placement, "motionTracks"> | undefined): NamedTrack[] => p?.motionTracks ?? [];
export const trackedClips = (p: Project): Placement[] => all(p).filter((c) => tracksOf(c).some((t) => t.samples.length));
/** The tracker `id` of clip `p`, or (no id) its only one; error text when ambiguous or missing. */
export function pickTrack(p: Placement, id?: string): NamedTrack | string {
  const ts = tracksOf(p);
  if (!ts.length) return `Clip ${p.id} has no tracker. Track it first (track_clip).`;
  if (id) return ts.find((t) => t.id === id || t.name.toLowerCase() === id.toLowerCase()) ?? `Clip ${p.id} has no tracker "${id}" (has ${ts.map((t) => `${t.id} "${t.name}"`).join(", ")}).`;
  return ts.length === 1 ? ts[0] : `Clip ${p.id} has ${ts.length} trackers: pass trackId (${ts.map((t) => `${t.id} "${t.name}"`).join(", ")}).`;
}
/** Next free "Track n" name and id on a clip. */
export function nextTrackName(p: Placement): { id: string; name: string } {
  const ts = tracksOf(p);
  let n = 1; while (ts.some((t) => t.name === `Track ${n}` || t.id === `mt${n}`)) n += 1;
  return { id: `mt${n}`, name: `Track ${n}` };
}

/** The tracked box at source tick `s` (linear between samples). Undefined outside the range; `lost` when no position. */
export function sampleAt(tr: Pick<NamedTrack, "samples"> & Partial<Pick<NamedTrack, "inS" | "outS">>, s: number): TrackSample | undefined {
  const xs = tr.samples;
  if (!xs.length) return undefined;
  if ((tr.inS !== undefined && s < tr.inS) || (tr.outS !== undefined && s >= tr.outS)) return undefined;
  if (s <= xs[0].s) return xs[0];
  for (let i = 1; i < xs.length; i += 1) {
    const a = xs[i - 1], b = xs[i];
    if (s === b.s) return b;
    if (s < b.s) {
      if (a.lost || b.lost) return { ...(a.lost ? a : b), s, lost: true };
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

/** Where tracker `tr` of clip `p` is at absolute time `t`, in canvas terms; undefined outside its range or when lost. */
export function trackPosAt(project: Project, p: Placement, t: number, tr: NamedTrack): TrackPos | undefined {
  if (t < p.startTicks || t >= p.startTicks + p.durationTicks) return undefined;
  const smp = sampleAt(tr, sourceAt(p, t));
  if (!smp || smp.lost) return undefined;
  const c = toCanvas(project, p, tr, smp.x, smp.y, t);
  return { x: c.x, y: c.y, width: smp.w * c.k, height: smp.h * c.kh, scale: smp.scale * (transformAt(p, t).scale || 1), rotation: c.rot, conf: smp.conf };
}

/** Timeline span [start, end) of a tracker's range on its clip (speed-aware), clipped to the clip. */
export function trackSpan(p: Placement, tr: Pick<NamedTrack, "inS" | "outS">): { start: number; end: number } {
  const sp = p.speed ?? 1, end = p.startTicks + p.durationTicks;
  const at = (s: number) => (p.reverse ? end - (s - p.sourceInTicks) / sp : p.startTicks + (s - p.sourceInTicks) / sp);
  const a = at(tr.inS), b = at(tr.outS);
  return { start: Math.max(p.startTicks, Math.min(a, b)), end: Math.min(end, Math.max(a, b)) };
}
/** Source tick at timeline time `t` on clip `p` (inverse of trackSpan's mapping). */
export const sourceOfTime = (p: Placement, t: number) => sourceAt(p, t);

/**
 * Keyframes that make `follower` follow tracker `tr` of `target`: its current offset from the box (measured at `at`) is
 * kept; scale follows the box size, rotation the target's rotation. Frames outside the range or lost get no key (hold).
 */
export function followKeys(project: Project, target: Placement, tr: NamedTrack, follower: Placement, at: number, opts: { scale?: boolean } = {}): Partial<Record<TransformKeyProp, Keyframe[]>> {
  if (!tr.samples.length) throw new Error("That tracker has no analysis yet.");
  const span = trackSpan(target, tr);
  const t0 = Math.max(span.start, follower.startTicks), t1 = Math.min(span.end, follower.startTicks + follower.durationTicks);
  if (t1 <= t0) throw new Error("The follower must overlap the tracker's range in time.");
  const step = Math.max(1, Math.round(120_000 / project.settings.fps));
  const clampAt = Math.min(Math.max(at, t0), t1 - 1);
  // Reference frame: the measuring time, else the nearest frame with a position.
  let ref = trackPosAt(project, target, clampAt, tr), refT = clampAt;
  for (let d = step; !ref && d < t1 - t0 + step; d += step) for (const c of [clampAt + d, clampAt - d]) if (!ref && c >= t0 && c < t1) { ref = trackPosAt(project, target, c, tr); refT = c; }
  if (!ref) throw new Error("The tracker never finds the feature in the follower's time.");
  const f0 = transformAt(follower, refT), x: Keyframe[] = [], y: Keyframe[] = [], sc: Keyframe[] = [], rot: Keyframe[] = [];
  for (let t = t0; t < t1; t += step) {
    const q = trackPosAt(project, target, t, tr), o = t - follower.startTicks;
    if (!q) continue;
    x.push({ t: o, v: round(f0.x + q.x - ref.x) }); y.push({ t: o, v: round(f0.y + q.y - ref.y) });
    if (opts.scale !== false) sc.push({ t: o, v: round(f0.scale * (q.scale / (ref.scale || 1))) });
    if (q.rotation !== ref.rotation) rot.push({ t: o, v: round(f0.rotation + q.rotation - ref.rotation) });
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

/** P40: change a tracker's range. Samples outside are dropped (shrink); the caller analyses any new part (extend). */
export function withRange(tr: NamedTrack, inS: number, outS: number): NamedTrack {
  return { ...tr, inS, outS, samples: tr.samples.filter((s) => s.s >= inS && s.s < outS) };
}
/** Source ranges inside [inS, outS) that a tracker has no samples for yet (to analyse after an extend). */
export function missingRanges(tr: NamedTrack, inS: number, outS: number): { from: number; to: number; seed: TrackSample }[] {
  const xs = tr.samples.filter((s) => !s.lost);
  if (!xs.length) return [];
  const first = xs[0], last = xs[xs.length - 1], out: { from: number; to: number; seed: TrackSample }[] = [];
  const all = tr.samples, a = all[0].s, b = all[all.length - 1].s;
  // One analysed frame covers up to the next sample: only a gap wider than the sample spacing is missing.
  const step = all.length > 1 ? (b - a) / (all.length - 1) : 4000;
  if (inS < a - step / 2) out.push({ from: inS, to: a, seed: first });
  if (outS > b + step * 1.5) out.push({ from: b + 1, to: outS, seed: last });
  return out;
}

/** ctx.inputs value of a "track" input (numbers only). x/y = box centre, width/height = box size, all 0–1 of the frame. */
export interface TrackSignal { x: number; y: number; width: number; height: number; scale: number; rotation: number; found: boolean }
export const NO_TRACK: TrackSignal = { x: 0.5, y: 0.5, width: 0, height: 0, scale: 1, rotation: 0, found: false };
/** Parse a track input source: "clip:<placementId>#<trackId>" (or legacy "clip:<id>" = its first tracker). */
export function parseTrackSource(source: string): { clipId: string; trackId?: string } | undefined {
  if (!source.startsWith("clip:")) return undefined;
  const [clipId, trackId] = source.slice(5).split("#");
  return clipId ? { clipId, trackId } : undefined;
}
/** Resolve a track input at absolute time `t`. found:false (and no position) outside the range, when lost or weak. */
export function trackSignal(project: Project, source: string, t: number): TrackSignal {
  const ref = parseTrackSource(source), p = ref && all(project).find((c) => c.id === ref.clipId);
  const tr = p && (ref!.trackId ? tracksOf(p).find((x) => x.id === ref!.trackId) : tracksOf(p)[0]);
  const q = p && tr && trackPosAt(project, p, t, tr);
  if (!q || q.conf < UNSTABLE_CONF) return NO_TRACK;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x: r(q.x + 0.5), y: r(q.y + 0.5), width: r(q.width), height: r(q.height), scale: r(q.scale), rotation: r(q.rotation), found: true };
}
