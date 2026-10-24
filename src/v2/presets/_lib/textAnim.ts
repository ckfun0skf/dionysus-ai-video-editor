/**
 * Render functions shared by several text in/out presets (same function, different param defaults). A preset that
 * shares one must also share its `type` name, so the registry keeps one entry per behaviour.
 * In/out: p is 0 → hidden end, 1 → fully shown (out presets are fed 1 - outProgress by the caller).
 */
import type { RenderFn } from "../../registry/types";
import { ease, n } from "./math";

export const fade: RenderFn = (f, p) => ({ ...f, alpha: f.alpha * ease(p) });
export const slide: RenderFn = (f, p, k) => { const e = ease(p), d = n(k.distance, 0.08); return { ...f, alpha: f.alpha * e, dx: f.dx + (1 - e) * d * n(k.dirX, 0), dy: f.dy + (1 - e) * d * n(k.dirY, 1) }; };
export const zoom: RenderFn = (f, p) => ({ ...f, scale: f.scale * ease(p) });
export const wipe: RenderFn = (f, p) => ({ ...f, clip: [0, 0, 1 - ease(p), 0] });
export const blurIn: RenderFn = (f, p, k) => ({ ...f, alpha: f.alpha * ease(p), filter: `blur(${((1 - ease(p)) * n(k.blur, 8)).toFixed(2)}px)` });

