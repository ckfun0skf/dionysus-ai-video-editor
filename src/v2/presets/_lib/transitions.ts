/**
 * Render functions and param specs shared by several transition presets (same function, different defaults).
 * p is progress across the cut; mixOut/mixIn are opacities, tOut/tIn the extra look of each side.
 */
import type { RenderFn } from "../../registry/types";
import { bell, easeIO, n } from "./math";

export const push: RenderFn = (f, p, k) => { const e = easeIO(p), x = n(k.dirX, -1), y = n(k.dirY, 0);
  return { ...f, mixOut: 1, mixIn: 1, tOut: { dx: x * e, dy: y * e, blur: n(k.blur, 0) * bell(p) }, tIn: { dx: -x * (1 - e), dy: -y * (1 - e), blur: n(k.blur, 0) * bell(p) } }; };
export const wipeT: RenderFn = (f, p, k) => { const e = easeIO(p), x = n(k.dirX, 1), y = n(k.dirY, 0), r = 1 - e;
  return { ...f, mixOut: 1, mixIn: 1, tIn: { clip: [x > 0 ? 0 : x < 0 ? r : 0, y > 0 ? 0 : y < 0 ? r : 0, x > 0 ? r : 0, y > 0 ? r : 0] } }; };
export const zoomT: RenderFn = (f, p, k) => { const e = easeIO(p), o = n(k.outScale, 1.8), i = n(k.inScale, 0.6), b = n(k.blur, 0.02) * bell(p);
  return { ...f, mixOut: 1, mixIn: Math.min(1, Math.max(0, (p - 0.3) / 0.4)), tOut: { scale: 1 + (o - 1) * e, blur: b }, tIn: { scale: i + (1 - i) * e, blur: b } }; };
export const blurT: RenderFn = (f, p, k) => { const b = n(k.blur, 0.03) * bell(p), cut = n(k.cut, 0);
  return { ...f, mixOut: cut ? (p < 0.5 ? 1 : 0) : 1, mixIn: cut ? (p < 0.5 ? 0 : 1) : Math.max(0, Math.min(1, easeIO(p))), tOut: { blur: b }, tIn: { blur: b } }; };

