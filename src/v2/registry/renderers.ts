/** Code registry of pure render functions, keyed by descriptor `type`. */
import type { PresetFrame, RenderFn } from "./types";

const ease = (x: number) => 1 - (1 - x) ** 3;
const n = (v: number | string | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: number | string | undefined, d: string) => (typeof v === "string" ? v : d);
const wave = (p: number) => Math.sin(p * Math.PI * 2);
/** Ease in-out (smoothstep-like cubic) for transitions. */
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** 0 at both ends, 1 in the middle of a transition. */
const bell = (p: number) => Math.sin(Math.max(0, Math.min(1, p)) * Math.PI);
/** Deterministic pseudo-random 0..1 for an integer seed (glitch patterns must match in preview and export). */
export const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export const RENDERERS: Record<string, RenderFn> = {
  none: (f) => f,
  // in/out: p is 0 → hidden edge, 1 → fully shown (out presets are fed 1 - outProgress by the caller)
  fade: (f, p) => ({ ...f, alpha: f.alpha * ease(p) }),
  slide: (f, p, k) => { const e = ease(p), d = n(k.distance, 0.08); return { ...f, alpha: f.alpha * e, dx: f.dx + (1 - e) * d * n(k.dirX, 0), dy: f.dy + (1 - e) * d * n(k.dirY, 1) }; },
  pop: (f, p, k) => ({ ...f, scale: f.scale * (0.4 + 0.6 * ease(p) + Math.sin(p * Math.PI) * n(k.overshoot, 0.12)), alpha: f.alpha * Math.min(1, p * 3) }),
  zoom: (f, p) => ({ ...f, scale: f.scale * ease(p) }),
  typewriter: (f, p) => ({ ...f, chars: Math.min(f.chars, p) }),
  wipe: (f, p) => ({ ...f, clip: [0, 0, 1 - ease(p), 0] }),
  blurIn: (f, p, k) => ({ ...f, alpha: f.alpha * ease(p), filter: `blur(${((1 - ease(p)) * n(k.blur, 8)).toFixed(2)}px)` }),
  // loops: p is phase within one cycle
  pulse: (f, p, k) => ({ ...f, scale: f.scale * (1 + n(k.amount, 0.06) * wave(p)) }),
  wiggle: (f, p, k) => ({ ...f, rot: f.rot + n(k.degrees, 4) * Math.sin(p * Math.PI * 4) }),
  float: (f, p, k) => ({ ...f, dy: f.dy + n(k.amount, 0.015) * wave(p) }),
  blink: (f, p) => ({ ...f, alpha: f.alpha * (0.55 + 0.45 * Math.cos(p * Math.PI * 2)) }),
  // effects
  glow: (f, _p, k) => ({ ...f, fx: { ...f.fx, glowBlur: n(k.blur, 0.35), color: s(k.color, "#20d5ec") } }),
  neon: (f, _p, k) => ({ ...f, fx: { ...f.fx, neon: true, glowBlur: n(k.blur, 0.6), color: s(k.color, "#20d5ec") } }),
  hollow: (f) => ({ ...f, fx: { ...f.fx, hollow: true } }),
  echo: (f, _p, k) => { const o = n(k.offset, 0.06); return { ...f, fx: { ...f.fx, color: s(k.color, "#20d5ec"), echo: [{ dx: o * 2, dy: o * 2, alpha: 0.35 }, { dx: o, dy: o, alpha: 0.6 }] } }; },
  // video effects (V2-101): composed in effect-layer order onto the main-track frame
  vFadeIn: (f, p, k) => ({ ...f, alpha: f.alpha * Math.min(1, p / Math.max(0.01, n(k.length, 0.5))) }),
  vFadeOut: (f, p, k) => ({ ...f, alpha: f.alpha * Math.min(1, (1 - p) / Math.max(0.01, n(k.length, 0.5))) }),
  vBlur: (f, _p, k) => ({ ...f, blur: (f.blur ?? 0) + n(k.amount, 0.5) * 0.02 }),
  vZoom: (f, p, k) => ({ ...f, scale: f.scale * (1 + n(k.zoom, 0.25) * p), dx: f.dx + n(k.pan, 0.05) * p }),
  vShake: (f, p, k) => { const a = n(k.amount, 0.02), w = n(k.speed, 16) * Math.PI * 2 * p; return { ...f, dx: f.dx + a * Math.sin(w), dy: f.dy + a * Math.sin(w * 1.37 + 1), scale: f.scale * (1 + a * 2) }; },
  vVignette: (f, _p, k) => ({ ...f, vignette: Math.min(1, Math.max(f.vignette ?? 0, n(k.amount, 0.6))) }),
  vGray: (f, _p, k) => ({ ...f, gray: Math.min(1, (f.gray ?? 0) + n(k.amount, 1)) }),
  // transitions: p is progress across the cut; mixOut/mixIn are opacities, tOut/tIn the extra look of each side
  crossfade: (f, p) => ({ ...f, mixOut: 1, mixIn: Math.max(0, Math.min(1, p)) }),
  dip: (f, p) => ({ ...f, mixOut: p < 0.5 ? 1 - p * 2 : 0, mixIn: p < 0.5 ? 0 : (p - 0.5) * 2 }),
  dipColor: (f, p, k) => { const c = s(k.color, "#ffffff"); return p < 0.5
    ? { ...f, mixOut: 1, mixIn: 0, tOut: { tint: c, tintAlpha: p * 2 } }
    : { ...f, mixOut: 0, mixIn: 1, tIn: { tint: c, tintAlpha: 2 - p * 2 } }; },
  flash: (f, p, k) => ({ ...f, mixOut: 1, mixIn: p < 0.5 ? 0 : 1, tIn: { tint: s(k.color, "#ffffff"), tintAlpha: n(k.strength, 0.9) * bell(p) }, tOut: { tint: s(k.color, "#ffffff"), tintAlpha: n(k.strength, 0.9) * bell(p) } }),
  push: (f, p, k) => { const e = easeIO(p), x = n(k.dirX, -1), y = n(k.dirY, 0);
    return { ...f, mixOut: 1, mixIn: 1, tOut: { dx: x * e, dy: y * e, blur: n(k.blur, 0) * bell(p) }, tIn: { dx: -x * (1 - e), dy: -y * (1 - e), blur: n(k.blur, 0) * bell(p) } }; },
  cover: (f, p, k) => { const e = easeIO(p), x = n(k.dirX, -1), y = n(k.dirY, 0);
    return { ...f, mixOut: 1, mixIn: 1, tOut: { tint: "#000000", tintAlpha: 0.5 * e }, tIn: { dx: -x * (1 - e), dy: -y * (1 - e) } }; },
  wipeT: (f, p, k) => { const e = easeIO(p), x = n(k.dirX, 1), y = n(k.dirY, 0), r = 1 - e;
    return { ...f, mixOut: 1, mixIn: 1, tIn: { clip: [x > 0 ? 0 : x < 0 ? r : 0, y > 0 ? 0 : y < 0 ? r : 0, x > 0 ? r : 0, y > 0 ? r : 0] } }; },
  iris: (f, p) => ({ ...f, mixOut: 1, mixIn: 1, tIn: { iris: easeIO(p) } }),
  zoomT: (f, p, k) => { const e = easeIO(p), o = n(k.outScale, 1.8), i = n(k.inScale, 0.6), b = n(k.blur, 0.02) * bell(p);
    return { ...f, mixOut: 1, mixIn: Math.min(1, Math.max(0, (p - 0.3) / 0.4)), tOut: { scale: 1 + (o - 1) * e, blur: b }, tIn: { scale: i + (1 - i) * e, blur: b } }; },
  spin: (f, p, k) => { const e = easeIO(p), d = n(k.degrees, 180);
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { rot: d * e, scale: 1 - 0.7 * bell(p), blur: 0.01 * bell(p) }, tIn: { rot: -d * (1 - e), scale: 1 - 0.7 * bell(p), blur: 0.01 * bell(p) } }; },
  blurT: (f, p, k) => { const b = n(k.blur, 0.03) * bell(p), cut = n(k.cut, 0);
    return { ...f, mixOut: cut ? (p < 0.5 ? 1 : 0) : 1, mixIn: cut ? (p < 0.5 ? 0 : 1) : Math.max(0, Math.min(1, easeIO(p))), tOut: { blur: b }, tIn: { blur: b } }; },
  glitch: (f, p, k) => { const a = n(k.amount, 0.08) * bell(p), seed = Math.floor(p * 14), j = (hash(seed) - 0.5) * a * 0.5;
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { glitch: a, seed, dx: j }, tIn: { glitch: a, seed: seed + 7, dx: -j } }; },
  shake: (f, p, k) => { const a = n(k.amount, 0.04) * bell(p), seed = Math.floor(p * 20), jx = (hash(seed) - 0.5) * 2 * a, jy = (hash(seed + 99) - 0.5) * 2 * a;
    return { ...f, mixOut: p < 0.5 ? 1 : 0, mixIn: p < 0.5 ? 0 : 1, tOut: { dx: jx, dy: jy, scale: 1 + a * 2 }, tIn: { dx: jx, dy: jy, scale: 1 + a * 2 } }; },
  // stickers draw their SVG
  sticker: (f, _p, k) => ({ ...f, svg: s(k.svg, "") }),
} satisfies Record<string, (f: PresetFrame, p: number, k: Record<string, number | string>) => PresetFrame>;
