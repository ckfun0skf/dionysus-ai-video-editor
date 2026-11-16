/**
 * Retiming scene events (P77, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 2 step 2.4): the pure operations behind
 * dragging and resizing event blocks in the scene editor (ui/SceneEditor.tsx).
 *
 * A drag never edits the scene step by step: the editor keeps the scene it started from and, on every pointer move,
 * applies ONE of these functions to that scene with the total offset so far. What it shows while dragging and what it
 * stores on release are the same pure result, and the release is one undo step.
 *
 * - `retimeSceneEvent(doc, i, "move" | "start" | "end", deltaSec, opts)`: move moves `at` (the length stays), "end"
 *   changes `dur`, "start" moves `at` and keeps the end where it is. Times are clamped to `[min, max]` (the clip's
 *   range on the scene clock, widened to include where the event already was) and an event keeps at least one frame
 *   of length. With `opts.snap` (a list of times) an edge within `opts.tol` of a target lands on it, otherwise on a
 *   whole frame of `opts.fps`; without it (snapping turned off) times only round to the millisecond.
 * - `sceneSnapTargets(doc, except, extra)`: the times an edge can snap to: other events' starts and ends plus extra
 *   ones (the playhead, the clip's in and out points).
 * - `moveSceneEventTo(doc, i, obj)`: give an event to another object when that object offers the same call and the
 *   event's arguments still hold there; otherwise an error says why and the scene is unchanged.
 */
import { SCENE_CAMERA, validateScene, type SceneDoc, type SceneEvent } from "./scene";
import { callTweens, roundSec, sceneCalls, updateSceneEvent } from "./sceneEdit";

export type RetimeEdge = "move" | "start" | "end";

export interface RetimeOptions {
  /** Earliest start (seconds, default 0). */
  min?: number;
  /** Latest end (seconds, default none). */
  max?: number;
  /** Snap targets in seconds; leave out to turn snapping off (also no whole-frame rounding). */
  snap?: readonly number[];
  /** How close (seconds) an edge has to be to a target to land on it. */
  tol?: number;
  /** Frames per second of the project, for whole-frame rounding and the shortest length. Default 30. */
  fps?: number;
}

export interface RetimeResult {
  doc: SceneDoc;
  at: number;
  dur: number;
  /** The target an edge landed on, if any (the editor draws a guide there). */
  snappedTo?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const eventsOf = (doc: SceneDoc): SceneEvent[] => (Array.isArray(doc.events) ? doc.events : []);
const durOf = (e: SceneEvent) => (typeof e.dur === "number" && e.dur > 0 ? e.dur : 0);

/** The times an edge can snap to: every other event's start and end, plus `extra`; sorted, without duplicates. */
export function sceneSnapTargets(doc: SceneDoc, except: number, extra: readonly number[] = []): number[] {
  const out = new Set<number>();
  eventsOf(doc).forEach((e, k) => {
    if (k === except || !isObj(e) || typeof e.at !== "number" || !Number.isFinite(e.at)) return;
    out.add(roundSec(e.at));
    if (durOf(e)) out.add(roundSec(e.at + durOf(e)));
  });
  for (const x of extra) if (Number.isFinite(x) && x >= 0) out.add(roundSec(x));
  return [...out].sort((a, b) => a - b);
}

/** The nearest target within `tol` of `t`, as [target, distance]. */
function nearest(t: number, targets: readonly number[], tol: number): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (const x of targets) {
    const d = Math.abs(x - t);
    if (d <= tol + 1e-9 && (!best || d < best[1])) best = [x, d];
  }
  return best;
}

/**
 * Drag event `i` by `deltaSec` from where it is in `doc`: move it ("move"), or move one edge ("start" / "end").
 * Returns the same `doc` when nothing changes. An event with no length can only be moved, or given a length from
 * its end when its call tweens.
 */
export function retimeSceneEvent(doc: SceneDoc, i: number, edge: RetimeEdge, deltaSec: number, opts: RetimeOptions = {}): RetimeResult {
  const e = eventsOf(doc)[i];
  if (!isObj(e) || typeof e.at !== "number") return { doc, at: 0, dur: 0 };
  const at0 = e.at, dur0 = durOf(e), end0 = at0 + dur0;
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 30;
  const frame = 1 / fps;
  const min = Math.max(0, Math.min(opts.min ?? 0, at0));
  const max = opts.max === undefined ? Infinity : Math.max(opts.max, end0);
  const snapping = !!opts.snap;
  const tol = opts.tol ?? 0;
  const toFrame = (t: number) => (snapping ? Math.round(t * fps) / fps : t);
  const d = Number.isFinite(deltaSec) ? deltaSec : 0;
  let at = at0, dur = dur0, snappedTo: number | undefined;

  if (edge === "move") {
    let a = at0 + d;
    const s = snapping ? nearest(a, opts.snap!, tol) : undefined;
    const t = snapping && dur0 ? nearest(a + dur0, opts.snap!, tol) : undefined;
    if (s && (!t || s[1] <= t[1] + 1e-9)) { a = s[0]; snappedTo = s[0]; }
    else if (t) { a = t[0] - dur0; snappedTo = t[0]; }
    else a = toFrame(a);
    const hi = Math.max(min, max - dur0);
    if (a < min || a > hi) snappedTo = undefined;
    at = Math.min(hi, Math.max(min, a));
  } else if (edge === "end") {
    if (!dur0 && !callTweens(doc, String(e.obj), String(e.call))) return { doc, at: at0, dur: dur0 };
    let x = end0 + d;
    const s = snapping ? nearest(x, opts.snap!, tol) : undefined;
    if (s) { x = s[0]; snappedTo = s[0]; } else x = toFrame(x);
    const lo = at0 + frame;
    if (x < lo || x > max) snappedTo = undefined;
    x = Math.min(Math.max(lo, max), Math.max(lo, x));
    dur = x - at0;
  } else {
    if (!dur0) return { doc, at: at0, dur: dur0 };
    let x = at0 + d;
    const s = snapping ? nearest(x, opts.snap!, tol) : undefined;
    if (s) { x = s[0]; snappedTo = s[0]; } else x = toFrame(x);
    const hi = Math.max(min, end0 - frame);
    if (x < min || x > hi) snappedTo = undefined;
    x = Math.min(hi, Math.max(min, x));
    at = x;
    dur = end0 - x;
  }
  at = roundSec(at);
  dur = dur > 0 ? roundSec(dur) : 0;
  const next = updateSceneEvent(doc, i, dur0 || dur ? { at, dur: dur || undefined } : { at });
  return { doc: next, at, dur, snappedTo };
}

/** Why event `i` can't go to object `obj` (undefined when it can). */
export function moveEventProblem(doc: SceneDoc, i: number, obj: string): string | undefined {
  const e = eventsOf(doc)[i];
  if (!isObj(e)) return "There is no such event.";
  if (e.obj === obj) return undefined;
  if (e.obj === SCENE_CAMERA || obj === SCENE_CAMERA) return "Camera events stay on the Scene track.";
  if (!sceneCalls(doc, obj).some((c) => c.call === e.call)) return `“${obj}” has no ${String(e.call)}.`;
  const at = `events[${i}]`;
  const errs = validateScene(withObj(doc, i, obj)).filter((x) => x.level === "error" && (x.path === at || x.path.startsWith(`${at}.`)));
  return errs.length ? `On “${obj}”: ${errs[0].message}` : undefined;
}

const withObj = (doc: SceneDoc, i: number, obj: string): SceneDoc => ({ ...doc, events: eventsOf(doc).map((x, k) => (k === i ? { ...x, obj } : x)) });

/** Give event `i` to object `obj` (same call, same arguments) when it fits there; the index stays the same. */
export function moveSceneEventTo(doc: SceneDoc, i: number, obj: string): { doc: SceneDoc; error?: string } {
  const e = eventsOf(doc)[i];
  if (!isObj(e) || e.obj === obj) return { doc };
  const error = moveEventProblem(doc, i, obj);
  return error ? { doc, error } : { doc: withObj(doc, i, obj) };
}
