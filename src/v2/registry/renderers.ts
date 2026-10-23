/** Code registry of pure render functions, keyed by descriptor `type`. */
import type { PresetFrame, RenderFn } from "./types";

const ease = (x: number) => 1 - (1 - x) ** 3;
const n = (v: number | string | undefined, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: number | string | undefined, d: string) => (typeof v === "string" ? v : d);
const wave = (p: number) => Math.sin(p * Math.PI * 2);

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
  // transitions: p is progress across the cut
  crossfade: (f, p) => ({ ...f, mixOut: 1, mixIn: Math.max(0, Math.min(1, p)) }),
  dip: (f, p) => ({ ...f, mixOut: p < 0.5 ? 1 - p * 2 : 0, mixIn: p < 0.5 ? 0 : (p - 0.5) * 2 }),
  // stickers draw their SVG
  sticker: (f, _p, k) => ({ ...f, svg: s(k.svg, "") }),
} satisfies Record<string, (f: PresetFrame, p: number, k: Record<string, number | string>) => PresetFrame>;
