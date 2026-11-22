/**
 * Scene Phase 3 (#352): cinematography in `dionysus.scene/1`. Pure: no DOM, no three.js. Every field is optional, so a
 * scene with one camera renders exactly as before.
 *
 * - Cameras: `world.cameras` (each with an id) besides the default `camera` (`world.camera`). Every camera has the
 *   camera calls and its own events; `lens` gives a focal length (mm) on a sensor (mm wide) instead of a raw fov, and
 *   a focus (distance or object) and f-stop that drive the post-processing depth of field (`world.post.dof`).
 * - Shots: `shots` (`[{ at, camera, name? }]`) pick the camera seen from each time on — cuts inside one scene.
 * - Rigs: camera events computed from `t` alone — dolly (along a spline or a distance), truck, crane, orbit, follow
 *   (smoothed with a weighted look-back over the subject's path, no state between frames), handheld (seeded noise),
 *   rackFocus, focalLength (zoom), and frame ("medium shot of A from the left, eye level").
 */
import type { SceneEase, Vec3 } from "./scene";

export interface SceneLens { focalLength?: number; sensor?: number; focus?: number | string; fStop?: number }
export interface SceneCameraDef { id: string; name?: string; position?: Vec3; lookAt?: Vec3; fov?: number; lens?: SceneLens }
export interface SceneShot { at: number; camera: string; name?: string }

export const SHOT_SIZES = ["wide", "full", "medium", "closeup", "extreme-closeup"] as const;
export type SceneShotSize = (typeof SHOT_SIZES)[number];
export const SHOT_ANGLES = ["front", "left", "right", "back", "three-quarter-left", "three-quarter-right"] as const;
export type SceneShotAngle = (typeof SHOT_ANGLES)[number];
export const SHOT_HEIGHTS = ["eye", "low", "high", "overhead"] as const;
export type SceneShotHeight = (typeof SHOT_HEIGHTS)[number];

/** The calls every camera has beyond position / moveTo, lookAt and fov: arguments and whether `dur` applies. */
export const SCENE_CAMERA_RIGS: Record<string, { args: string[]; description: string }> = {
  focalLength: { args: ["value"], description: "Zoom: the focal length in mm (on the camera's sensor, default 36 mm wide)." },
  focus: { args: ["value"], description: "Focus on a distance (units) or an object id (followed as it moves); needs world.post.dof." },
  fStop: { args: ["value"], description: "Aperture as an f-stop (1–32; smaller = shallower focus); needs world.post.dof." },
  rackFocus: { args: ["to", "from"], description: "Pull focus to an object id or a distance over dur (from: where it starts, default the current focus)." },
  dolly: { args: ["path", "distance"], description: "Move along a smooth path through points [[x, y, z], …] over dur, or by distance along the view (positive = in)." },
  truck: { args: ["distance"], description: "Move sideways by distance (positive = right), the aim moving with it." },
  crane: { args: ["distance"], description: "Move up by distance (negative = down), the aim moving with it." },
  orbit: { args: ["target", "to", "from", "radius", "height"], description: "Circle a target (object id or point; default the current aim) from angle from (default the current one) to angle to (degrees) over dur, at radius and height (default the current ones)." },
  follow: { args: ["target", "offset", "damping"], description: "Follow an object at an offset [x, y, z] (default the current one), looking at it, smoothed over damping seconds (default 0.4); dur 0 = until the camera's next move." },
  handheld: { args: ["amplitude", "frequency", "seed"], description: "Handheld shake: amplitude (units, default 0.03; 0 stops), frequency (Hz, default 1.2), seed; dur 0 = until the next handheld." },
  frame: { args: ["subject", "shot", "angle", "height"], description: "Frame a subject: shot wide | full | medium | closeup | extreme-closeup, angle front | left | right | back | three-quarter-left | three-quarter-right, height eye | low | high | overhead, over dur." },
};

/** Vertical field of view (degrees) of a focal length (mm) on a sensor `sensor` mm wide for a 16:9 frame. */
export function focalToFov(focalLength: number, sensor = 36, aspect = 16 / 9): number {
  const h = sensor / aspect;
  return (2 * Math.atan(h / (2 * focalLength)) * 180) / Math.PI;
}
/** The depth-of-field pass's aperture for an f-stop (f/1.4 ≈ 0.02 … f/16 ≈ 0.0018). */
export const fStopToAperture = (fStop: number): number => 0.028 / fStop;

/** A point on a Catmull-Rom spline through `pts` at k (0..1), the parameter spread by chord length. */
export function splineAt(pts: Vec3[], k: number): Vec3 {
  if (pts.length === 1) return [pts[0][0], pts[0][1], pts[0][2]];
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]));
  const total = lens.reduce((s, x) => s + x, 0) || 1;
  let d = Math.max(0, Math.min(1, k)) * total, i = 0;
  while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
  const u = lens[i] ? Math.min(1, d / lens[i]) : 1;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
  const u2 = u * u, u3 = u2 * u;
  return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3)) as Vec3;
}

/** FNV-1a. */
const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
/**
 * Smooth seeded noise in [-1, 1] per axis at time t: a sum of three sines per axis with frequencies around `freq` and
 * phases from the seed — the same numbers for one seed at one time, in any order.
 */
export function shake(seed: string, t: number, freq: number): Vec3 {
  const h = hash(seed);
  const out: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const r = ((Math.imul(h ^ (axis * 0x9e3779b1 + k * 0x85ebca6b), 0x27d4eb2d) >>> 0) % 10000) / 10000;
      const f = freq * (0.6 + 0.5 * k + 0.35 * r);
      v += Math.sin(2 * Math.PI * f * t + r * 6.283) / (k + 1);
    }
    out[axis] = v / 1.83;
  }
  return out;
}

/**
 * Where a camera stands and looks to frame a subject of height `h` at `p` facing `yaw` (degrees) with a vertical fov
 * `fov`: the shot size sets how much of the subject fills the frame, the angle the side, the height the eye line.
 */
export function framePose(p: Vec3, h: number, yaw: number, fov: number, shot: SceneShotSize, angle: SceneShotAngle, height: SceneShotHeight): { position: Vec3; target: Vec3 } {
  const extent = { wide: 3.2, full: 1.25, medium: 0.62, closeup: 0.32, "extreme-closeup": 0.16 }[shot] * h;
  const lookY = { wide: 0.5, full: 0.5, medium: 0.68, closeup: 0.88, "extreme-closeup": 0.92 }[shot] * h;
  const dist = extent / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
  const off = { front: 0, left: 90, right: -90, back: 180, "three-quarter-left": 40, "three-quarter-right": -40 }[angle];
  const a = ((yaw + off) * Math.PI) / 180;
  const rise = { eye: 0, low: -0.45 * h, high: 0.6 * h, overhead: 2.2 * h }[height];
  const horiz = height === "overhead" ? dist * 0.35 : dist;
  const target: Vec3 = [p[0], p[1] + lookY, p[2]];
  const position: Vec3 = [p[0] + Math.sin(a) * horiz, Math.max(0.15, p[1] + lookY + rise), p[2] + Math.cos(a) * horiz];
  return { position, target };
}

/** Ease names (shared with events). */
export type { SceneEase };
