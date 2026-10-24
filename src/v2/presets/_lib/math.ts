/** Shared math for preset render functions (V2-FX-MOD). Pure; import what you need from "../_lib/math". */

/** Ease out (cubic): fast start, soft landing. In/out text presets use it. */
export const ease = (x: number) => 1 - (1 - x) ** 3;
/** Ease in-out (smoothstep-like cubic) for transitions. */
export const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** 0 at both ends, 1 in the middle of a transition. */
export const bell = (p: number) => Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
/** One sine cycle over p = 0..1 (loops). */
export const wave = (p: number) => Math.sin(p * Math.PI * 2);
/** Number param with fallback (params arrive already merged with defaults; the fallback guards hand-made calls). */
export const n = (v: number | string | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
/** String / colour param with fallback. */
export const s = (v: number | string | undefined, d: string) => (typeof v === "string" ? v : d);
/** Clamp to 0..1. */
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Deterministic pseudo-random 0..1 for an integer seed (glitch patterns must match in preview and export). */
export const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
