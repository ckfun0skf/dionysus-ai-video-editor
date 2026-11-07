/**
 * P49 clip mask raster. Preview and export both call `paintClip` from Player.draw. Feather is a box blur of the
 * mask alpha (three passes) — never `canvas.filter`, which Safari does not implement for this. Hard shapes with no
 * feather and no expand use a clip path. Editor chrome is not drawn here.
 */
import { maskAt, prepareMask, signedDistance, type ClipMask } from "../domain/mask";
import type { Placement } from "../domain/model";
import type { Placed } from "./frame";
import { applyTrackMask } from "./trackMask";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Clamp-to-edge box blur of one channel. Deterministic; no canvas.filter. */
export function boxBlur(src: Uint8Array, w: number, h: number, radius: number, passes = 3): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0 || w < 1 || h < 1) return src;
  const win = r * 2 + 1;
  const tmp = new Uint8Array(src.length);
  let cur = new Uint8Array(src);
  const horiz = (from: Uint8Array, to: Uint8Array) => {
    const pref = new Float64Array(w + 1);
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      pref[0] = 0;
      for (let x = 0; x < w; x += 1) pref[x + 1] = pref[x] + from[row + x];
      for (let x = 0; x < w; x += 1) {
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        let sum = pref[b + 1] - pref[a];
        const left = r - (x - a), right = r - (b - x);
        if (left > 0) sum += from[row + a] * left;
        if (right > 0) sum += from[row + b] * right;
        to[row + x] = Math.round(sum / win);
      }
    }
  };
  const vert = (from: Uint8Array, to: Uint8Array) => {
    const pref = new Float64Array(h + 1);
    for (let x = 0; x < w; x += 1) {
      pref[0] = 0;
      for (let y = 0; y < h; y += 1) pref[y + 1] = pref[y] + from[y * w + x];
      for (let y = 0; y < h; y += 1) {
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        let sum = pref[b + 1] - pref[a];
        const up = r - (y - a), down = r - (b - y);
        if (up > 0) sum += from[a * w + x] * up;
        if (down > 0) sum += from[b * w + x] * down;
        to[y * w + x] = Math.round(sum / win);
      }
    }
  };
  for (let p = 0; p < passes; p += 1) { horiz(cur, tmp); vert(tmp, cur); }
  return cur;
}

export interface MaskBuffer {
  w: number; h: number; sx: number; sy: number; sw: number; sh: number; pad: number;
}

/** Map a buffer pixel to a source fraction. Padding sits outside the placed (cropped) rect. */
export function bufferToSource(x: number, y: number, srcW: number, srcH: number, b: MaskBuffer): { nx: number; ny: number } {
  const lx = x - b.pad - b.w / 2, ly = y - b.pad - b.h / 2;
  return {
    nx: (((lx + b.w / 2) / (b.w || 1)) * b.sw + b.sx) / srcW,
    ny: (((ly + b.h / 2) / (b.h || 1)) * b.sh + b.sy) / srcH,
  };
}

/**
 * Multiply `data` (straight RGBA) by the mask. Only this buffer changes — a neighbouring layer is a different buffer.
 * Coverage is computed on a grid no wider than 480px and sampled bilinearly; feather is a blur of that grid.
 */
export function multiplyMask(data: Uint8ClampedArray, bw: number, bh: number, mask: ClipMask, srcW: number, srcH: number, placed: { w: number; h: number; sx: number; sy: number; sw: number; sh: number }, pad: number): void {
  const buf: MaskBuffer = { w: placed.w, h: placed.h, sx: placed.sx, sy: placed.sy, sw: placed.sw, sh: placed.sh, pad };
  const long = Math.max(bw, bh);
  const cap = 480;
  const sc = long > cap ? cap / long : 1;
  const mw = Math.max(1, Math.round(bw * sc)), mh = Math.max(1, Math.round(bh * sc));
  const prep = prepareMask(mask, srcW, srcH);
  const bin = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y += 1) for (let x = 0; x < mw; x += 1) {
    const p = bufferToSource((x + 0.5) / sc, (y + 0.5) / sc, srcW, srcH, buf);
    bin[y * mw + x] = signedDistance(prep, p.nx, p.ny) >= 0 ? 255 : 0;
  }
  const featherPx = (mask.feather ?? 0) * Math.min(srcW, srcH) * ((placed.w || 1) / (placed.sw || 1)) * sc;
  const soft = featherPx >= 0.5 ? boxBlur(bin, mw, mh, Math.max(1, Math.round(featherPx / 2))) : bin;
  const inv = !!mask.invert;
  const sample = (x: number, y: number) => {
    const fx = clamp(x * sc - 0.5, 0, mw - 1), fy = clamp(y * sc - 0.5, 0, mh - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(mw - 1, x0 + 1), y1 = Math.min(mh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const a = soft[y0 * mw + x0] * (1 - tx) + soft[y0 * mw + x1] * tx;
    const b = soft[y1 * mw + x0] * (1 - tx) + soft[y1 * mw + x1] * tx;
    return (a * (1 - ty) + b * ty) / 255;
  };
  for (let y = 0; y < bh; y += 1) for (let x = 0; x < bw; x += 1) {
    let a = sample(x + 0.5, y + 0.5);
    if (inv) a = 1 - a;
    const o = (y * bw + x) * 4;
    data[o + 3] = Math.round(data[o + 3] * a);
  }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const needsRaster = (m: ClipMask) => (m.feather ?? 0) > 0.0005 || Math.abs(m.expand ?? 0) > 0.0005;

function trace(g: Ctx, mask: ClipMask, srcW: number, srcH: number, r: Placed, append = false) {
  const pt = (nx: number, ny: number) => {
    const x = -r.w / 2 + ((nx * srcW - r.sx) / (r.sw || 1)) * r.w;
    const y = -r.h / 2 + ((ny * srcH - r.sy) / (r.sh || 1)) * r.h;
    return [x, y] as const;
  };
  if (!append) g.beginPath();
  if (mask.shape === "rect" || mask.shape === "ellipse") {
    const hw = (mask.w ?? 0) / 2, hh = (mask.h ?? 0) / 2, th = ((mask.rotation ?? 0) * Math.PI) / 180;
    g.save();
    const c = pt(mask.x ?? 0.5, mask.y ?? 0.5);
    g.translate(c[0], c[1]); g.rotate(th);
    const s = r.w / (r.sw || 1);
    if (mask.shape === "ellipse") {
      const rx = Math.max(0.5, hw * srcW * s), ry = Math.max(0.5, hh * srcH * s);
      if (typeof g.ellipse === "function") g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      else { g.save(); g.scale(rx, ry); g.arc(0, 0, 1, 0, Math.PI * 2); g.restore(); }
    } else {
      const rw = hw * srcW * s, rh = hh * srcH * s, rad = Math.min((mask.radius ?? 0) * Math.min(rw * 2, rh * 2), rw, rh);
      if (rad > 0 && typeof g.roundRect === "function") g.roundRect(-rw, -rh, rw * 2, rh * 2, rad);
      else g.rect(-rw, -rh, rw * 2, rh * 2);
    }
    g.restore();
  } else if (mask.shape === "linear" || mask.shape === "band") {
    const th = ((mask.rotation ?? 0) * Math.PI) / 180;
    const c = pt(mask.x ?? 0.5, mask.y ?? 0.5);
    const len = Math.hypot(r.w, r.h) + 8;
    const px = Math.cos(th), py = Math.sin(th); // along the line (clockwise y-down: θ=0 → +x)
    // kept normal for θ=0 is up, which is -y. Normal = (-sin, -cos)? θ=0 → (0, -1). θ increases clockwise.
    const nx = -Math.sin(th), ny = -Math.cos(th);
    if (mask.shape === "linear") {
      const a = [c[0] - px * len, c[1] - py * len] as const;
      const b = [c[0] + px * len, c[1] + py * len] as const;
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(b[0] + nx * len, b[1] + ny * len); g.lineTo(a[0] + nx * len, a[1] + ny * len); g.closePath();
    } else {
      const thick = ((mask.w ?? 0) * srcW * (r.w / (r.sw || 1))) / 2;
      const ox = nx * thick, oy = ny * thick;
      g.moveTo(c[0] - px * len + ox, c[1] - py * len + oy);
      g.lineTo(c[0] + px * len + ox, c[1] + py * len + oy);
      g.lineTo(c[0] + px * len - ox, c[1] + py * len - oy);
      g.lineTo(c[0] - px * len - ox, c[1] - py * len - oy);
      g.closePath();
    }
  } else if (mask.nodes && mask.nodes.length >= 3) {
    const n0 = pt(mask.nodes[0].x, mask.nodes[0].y);
    g.moveTo(n0[0], n0[1]);
    for (let i = 0; i < mask.nodes.length; i += 1) {
      const a = mask.nodes[i], b = mask.nodes[(i + 1) % mask.nodes.length];
      const c1 = pt(a.x + (a.out?.x ?? 0), a.y + (a.out?.y ?? 0));
      const c2 = pt(b.x + (b.in?.x ?? 0), b.y + (b.in?.y ?? 0));
      const p = pt(b.x, b.y);
      g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
    }
    g.closePath();
  }
}

let scratch: AnyCanvas | undefined;
function scratchCanvas(w: number, h: number): AnyCanvas | undefined {
  const ww = Math.max(1, Math.ceil(w)), hh = Math.max(1, Math.ceil(h));
  if (!scratch) scratch = typeof document !== "undefined" ? document.createElement("canvas") : typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(ww, hh) : undefined;
  if (!scratch) return undefined;
  if (scratch.width !== ww || scratch.height !== hh) { scratch.width = ww; scratch.height = hh; }
  return scratch;
}

/**
 * Draw `draw` in the current local space (origin at the clip centre, already translated and rotated) with the tracker
 * mask and the clip mask. No-ops the clip mask when it is absent or bypassed.
 */
export function paintClip(g: Ctx, placement: Placement, mask: ClipMask | undefined, srcW: number, srcH: number, r: Placed, sourceTicks: number, offsetTicks: number, draw: (g: Ctx) => void): void {
  const live = mask && mask.enabled !== false ? maskAt({ ...placement, mask }, sourceTicks, offsetTicks).mask : undefined;
  if (!live || !needsRaster(live)) {
    applyTrackMask(g, placement, srcW, srcH, r, sourceTicks);
    if (live) {
      if (live.invert) { g.beginPath(); g.rect(-r.w / 2 - 4, -r.h / 2 - 4, r.w + 8, r.h + 8); trace(g, live, srcW, srcH, r, true); g.clip("evenodd"); }
      else { trace(g, live, srcW, srcH, r); g.clip("nonzero"); }
    }
    draw(g);
    return;
  }
  const featherPx = (live.feather ?? 0) * Math.min(srcW, srcH) * (r.w / (r.sw || 1));
  const expandPx = Math.max(0, live.expand ?? 0) * Math.min(srcW, srcH) * (r.w / (r.sw || 1));
  const pad = Math.ceil(featherPx + expandPx) + 2;
  const canvas = scratchCanvas(r.w + pad * 2, r.h + pad * 2);
  const bg = canvas?.getContext("2d") as Ctx | null;
  if (!canvas || !bg || !bg.getImageData) { applyTrackMask(g, placement, srcW, srcH, r, sourceTicks); draw(g); return; }
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.globalAlpha = 1; bg.globalCompositeOperation = "source-over";
  bg.clearRect(0, 0, canvas.width, canvas.height);
  bg.save();
  bg.translate(pad + r.w / 2, pad + r.h / 2);
  applyTrackMask(bg, placement, srcW, srcH, r, sourceTicks);
  draw(bg);
  bg.restore();
  try {
    const img = bg.getImageData(0, 0, canvas.width, canvas.height);
    multiplyMask(img.data, canvas.width, canvas.height, live, srcW, srcH, r, pad);
    bg.putImageData(img, 0, 0);
  } catch { /* a tainted canvas falls back to the unfeathered picture already in the buffer */ }
  g.drawImage(canvas, -r.w / 2 - pad, -r.h / 2 - pad);
}
