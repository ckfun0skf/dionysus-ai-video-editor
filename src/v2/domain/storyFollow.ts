/**
 * Layers that follow the shot (V2-SB-126). Effect clips (ken-burns etc.) move and zoom only the main-track picture
 * (render/effects.ts), so text and overlays stay fixed to the frame. A layer with `follow: "shot"` instead gets the
 * effects' motion baked into x/y/scale keyframes on Send to timeline, so it moves with the picture in preview and
 * export alike without any render change.
 */
import type { Keyframe, KeyframeProp } from "./model";
import { applyPreset, identityFrame, type Params } from "../registry";

/** One effect over part of a clip: its preset, params and range in ticks from the clip start. */
export interface MotionEffect { preset: string; params?: Params; offset: number; duration: number }
/** Picture motion at one time: the frame centre moves by (dx, dy) (fractions of the frame) and zooms by `scale`. */
export interface Motion { dx: number; dy: number; scale: number }

const IDENTITY: Motion = { dx: 0, dy: 0, scale: 1 };
const isIdentity = (m: Motion) => Math.abs(m.dx) < 1e-6 && Math.abs(m.dy) < 1e-6 && Math.abs(m.scale - 1) < 1e-6;

/** Motion of the picture `o` ticks after the clip start, composed like effectFrameAt (only active effects count). */
export function motionAt(effects: readonly MotionEffect[], o: number): Motion {
  let f = identityFrame(), any = false;
  for (const e of effects) {
    if (o < e.offset || o >= e.offset + e.duration) continue;
    const prog = e.duration > 1 ? (o - e.offset) / (e.duration - 1) : 1;
    f = applyPreset("videoEffect", e.preset, prog, f, e.params);
    any = true;
  }
  return any ? { dx: f.dx, dy: f.dy, scale: f.scale } : IDENTITY;
}

/** True when the effect moves or zooms the picture somewhere in its range (a look-only effect has nothing to follow). */
export function effectMoves(preset: string, params?: Params): boolean {
  return [0, 0.5, 1].some((p) => { const f = applyPreset("videoEffect", preset, p, identityFrame(), params); return !isIdentity({ dx: f.dx, dy: f.dy, scale: f.scale }); });
}

/**
 * Keyframes that make a layer centred at (x, y) (offset from the frame centre, fractions) with scale `s` follow the
 * picture over [start, start + duration) ticks of the clip. Sampled every `step` ticks and at each effect boundary;
 * `t` is relative to the layer start. Undefined when the picture never moves during the layer.
 */
export function followKeyframes(effects: readonly MotionEffect[], start: number, duration: number, base: { x: number; y: number; scale: number }, step: number): Partial<Record<KeyframeProp, Keyframe[]>> | undefined {
  const end = start + duration;
  const ts = new Set<number>([start, end - 1]);
  for (let t = start + step; t < end - 1; t += step) ts.add(Math.round(t));
  for (const e of effects) for (const b of [e.offset - 1, e.offset, e.offset + e.duration - 1, e.offset + e.duration]) if (b >= start && b < end) ts.add(b);
  const times = [...ts].filter((t) => t >= start && t < end).sort((a, b) => a - b);
  const samples = times.map((t) => ({ t: t - start, m: motionAt(effects, t) }));
  if (samples.every((s) => isIdentity(s.m))) return undefined;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  // Drop samples that lie on the line between their neighbours (linear keyframes reproduce them).
  const keys = (v: (m: Motion) => number): Keyframe[] => {
    const all = samples.map((s) => ({ t: s.t, v: r(v(s.m)) }));
    const out: Keyframe[] = [];
    all.forEach((k, i) => {
      const a = out[out.length - 1], b = all[i + 1];
      if (a && b && Math.abs(a.v + ((b.v - a.v) * (k.t - a.t)) / (b.t - a.t || 1) - k.v) <= 1e-4) return;
      out.push(k);
    });
    return out;
  };
  return { x: keys((m) => m.dx + m.scale * base.x), y: keys((m) => m.dy + m.scale * base.y), scale: keys((m) => m.scale * base.scale) };
}
