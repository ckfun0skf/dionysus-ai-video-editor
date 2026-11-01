/**
 * P14-SPATIAL: where a sound sits around the listener. Pure model + maths; render/spatial builds the Web Audio graph
 * (the same one for preview and export).
 *
 * - `azimuth`: degrees, 0 = front, -90 = left, +90 = right, ±180 = behind (stored in -180..180).
 * - `distance`: 0..1, normalised (0 = at the ear, 0.25 ≈ 2 m, 1 ≈ 20 m away; metres = 1 + 19·distance in binaural).
 * - `width`: 0..1, default 1 = keep the source's own stereo image. Stereo files are split into mid (the point source
 *   that is moved) and side (the L/R spread, scaled by width and kept around the listener). Mono files have no side,
 *   so they are point sources. Width also narrows a little with distance (×(1 − 0.5·distance)).
 * - `pan` (-1..1) is shorthand: azimuth = pan × 90 (front half only), distance 0.
 * Absent = centre and no processing at all (old projects render exactly as before).
 */
import type { Placement, Project, Track } from "./model";

export interface SpatialPos { azimuth: number; distance: number; width?: number }
/** `t` is ticks from the clip start (seconds from the cue start in storyboard JSON). Linear between keys, held outside. */
export interface PositionKey { t: number; azimuth: number; distance: number }
export type AudioOutputMode = "stereo" | "binaural";
export type AudioEnvironment = "room" | "outdoor";
export interface AudioOutput { mode: AudioOutputMode; environment?: AudioEnvironment }

export const CENTRE: SpatialPos = { azimuth: 0, distance: 0, width: 1 };
export const wrapAz = (a: number) => { const x = ((((a + 180) % 360) + 360) % 360) - 180; return x === -180 ? 180 : x; };
export const panToAzimuth = (pan: number) => Math.max(-1, Math.min(1, pan)) * 90;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Named spots for the pad chips and the AI ("preset" ids in the guide). */
export const POSITION_PRESETS: readonly { id: string; label: string; azimuth: number; distance: number }[] = [
  { id: "front-centre", label: "Front centre", azimuth: 0, distance: 0.2 },
  { id: "close-left-ear", label: "Close to left ear", azimuth: -90, distance: 0 },
  { id: "close-right-ear", label: "Close to right ear", azimuth: 90, distance: 0 },
  { id: "far-left", label: "Far left", azimuth: -70, distance: 0.85 },
  { id: "far-right", label: "Far right", azimuth: 70, distance: 0.85 },
  { id: "behind", label: "Behind", azimuth: 180, distance: 0.3 },
  { id: "behind-wall", label: "Behind wall", azimuth: 160, distance: 0.9 },
  { id: "distant-front", label: "Distant front", azimuth: 0, distance: 1 },
];

/** Shortest-way azimuth interpolation (so 170 → -170 passes behind, not through the front). */
export function lerpAz(a: number, b: number, k: number) { let d = wrapAz(b - a); return wrapAz(a + d * k); }

/** Position at clip-relative tick `t` from keys (linear, held outside); undefined without keys. */
export function keyPosAt(keys: PositionKey[] | undefined, t: number): { azimuth: number; distance: number } | undefined {
  if (!keys?.length) return undefined;
  if (t <= keys[0].t) return { azimuth: keys[0].azimuth, distance: keys[0].distance };
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
    const a = keys[i - 1], b = keys[i], k = (t - a.t) / (b.t - a.t || 1);
    return { azimuth: lerpAz(a.azimuth, b.azimuth, k), distance: a.distance + (b.distance - a.distance) * k };
  }
  const l = keys[keys.length - 1]; return { azimuth: l.azimuth, distance: l.distance };
}

/** The clip's own position, else its track's; undefined = no spatial processing. */
export function spatialOf(p: Pick<Placement, "position" | "positionKeys">, track?: Pick<Track, "position">): { base: SpatialPos; keys?: PositionKey[] } | undefined {
  if (p.position || p.positionKeys?.length) return { base: { ...CENTRE, ...p.position }, ...(p.positionKeys?.length ? { keys: p.positionKeys } : {}) };
  if (track?.position) return { base: { ...CENTRE, ...track.position } };
  return undefined;
}
/** Position at clip-relative tick `t`. */
export function spatialAt(s: { base: SpatialPos; keys?: PositionKey[] }, t: number): SpatialPos {
  const k = keyPosAt(s.keys, t); return k ? { ...s.base, ...k } : s.base;
}

export const audioOutputOf = (p: Pick<Project, "settings">): Required<AudioOutput> => ({ mode: p.settings.audioOutput?.mode ?? "stereo", environment: p.settings.audioOutput?.environment ?? "room" });
export const REVERB = { room: { seconds: 1.4, decay: 3, level: 0.35 }, outdoor: { seconds: 0.7, decay: 6, level: 0.12 } } as const;

/**
 * Node settings for a position (stereo mode; binaural uses gain/lowpass/reverb/sideGain and a PannerNode for the mid).
 * mid → L = √2·cos θ, R = √2·sin θ with θ = (pan+1)·π/4, pan = sin(azimuth) (equal power, unity at centre);
 * side → ±width; distance → gain 1/(1+3d), lowpass 20 kHz→2 kHz (log), reverb send level·d² (0 at distance 0); behind → darker (down to ×0.45 cutoff).
 */
export function spatialParams(pos: SpatialPos, env: AudioEnvironment = "room") {
  const az = wrapAz(pos.azimuth), d = clamp01(pos.distance), w = clamp01(pos.width ?? 1) * (1 - 0.5 * d);
  const pan = Math.sin((az * Math.PI) / 180), th = ((pan + 1) * Math.PI) / 4;
  const rear = Math.abs(az) > 90 ? (Math.abs(az) - 90) / 90 : 0;
  return {
    midL: Math.SQRT2 * Math.cos(th), midR: Math.SQRT2 * Math.sin(th), side: w,
    gain: 1 / (1 + 3 * d),
    lowpass: 20000 * Math.pow(2000 / 20000, d) * (1 - 0.55 * rear),
    // P25: no room send at the ear (distance 0 is fully dry), growing with the square of distance so near spots stay dry.
    reverb: REVERB[env].level * d * d,
    metres: 1 + 19 * d,
    xyz: { x: Math.sin((az * Math.PI) / 180), y: 0, z: -Math.cos((az * Math.PI) / 180) },
  };
}

/** Validation for agents / JSON: error strings (empty = ok). */
export function positionErrors(path: string, v: unknown, allowWidth = true): string[] {
  const e: string[] = [];
  if (!v || typeof v !== "object") return [`${path} must be { "azimuth": -180..180, "distance": 0..1${allowWidth ? ', "width"?: 0..1' : ""} }.`];
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["azimuth", "distance", ...(allowWidth ? ["width"] : []), ...(path.includes("Keys") ? ["t"] : [])].includes(k)) e.push(`${path} has no field "${k}".`);
  if (typeof o.azimuth !== "number" || !Number.isFinite(o.azimuth) || o.azimuth < -180 || o.azimuth > 180) e.push(`${path}.azimuth must be degrees -180..180 (0 front, -90 left, 90 right, ±180 behind); got ${JSON.stringify(o.azimuth)}.`);
  if (typeof o.distance !== "number" || !(o.distance >= 0 && o.distance <= 1)) e.push(`${path}.distance must be 0 (at the ear) to 1 (≈20 m); got ${JSON.stringify(o.distance)}.`);
  if (o.width !== undefined && (typeof o.width !== "number" || !(o.width >= 0 && o.width <= 1))) e.push(`${path}.width must be 0 (mono point) to 1 (original stereo); got ${JSON.stringify(o.width)}.`);
  return e;
}
