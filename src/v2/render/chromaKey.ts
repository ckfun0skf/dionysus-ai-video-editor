/**
 * Chroma key (P3B-12): makes the pixels of a clip that are close to a key colour transparent, and removes the key
 * colour's tint (spill) from what is left. It runs inside Player.draw for video, image and html clips, so the preview
 * and the export (which renders through the same Player) key identically.
 *
 * Fast path: one shared WebGL canvas with a fragment shader (phones included). Fallback: getImageData on a small 2D
 * canvas. Both use the math of `keyPixel` (unit-tested), and the source is downscaled to at most KEY_MAX_SIDE pixels
 * on its long side so a 4K clip stays cheap on a phone.
 */
import type { ChromaKey } from "../domain/model";

/** Long side (px) the keyed picture is rendered at; enough for a 1080p export of an overlay. */
export const KEY_MAX_SIDE = 1280;
/** Fallback (CPU) long side: getImageData per frame is slow, so the CPU path works smaller. */
export const KEY_CPU_SIDE = 480;
/** Width of the soft edge in chroma distance units. */
export const KEY_SOFT = 0.08;

/** Hex "#rrggbb" → 0–1 RGB (fallback green). */
export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 1, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** 0–255 RGB → "#rrggbb". */
export const rgbHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

const cb = (r: number, g: number, b: number) => -0.1687 * r - 0.3313 * g + 0.5 * b;
const cr = (r: number, g: number, b: number) => 0.5 * r - 0.4187 * g - 0.0813 * b;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The key for one pixel (all values 0–1): alpha from the pixel's chroma distance to the key colour (`range` 0–1 maps
 * to a threshold 0–0.5, with a KEY_SOFT edge), and colour desaturated toward its luma by `spill` near the key.
 * Mirrors the GLSL in FRAG exactly.
 */
export function keyPixel(r: number, g: number, b: number, key: { rgb: [number, number, number]; range: number; spill: number }): [number, number, number, number] {
  const [kr, kg, kb] = key.rgb;
  const d = Math.hypot(cb(r, g, b) - cb(kr, kg, kb), cr(r, g, b) - cr(kr, kg, kb));
  const t0 = key.range * 0.5;
  const a = clamp01((d - t0) / KEY_SOFT);
  const s = key.spill * (1 - clamp01((d - t0) / (KEY_SOFT + 0.25)));
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (y - r) * s, g + (y - g) * s, b + (y - b) * s, a];
}

/** Whether a placement's key is active. */
export const keyActive = (k: ChromaKey | undefined): k is ChromaKey => !!k && !k.off;

const VERT = `attribute vec2 p;uniform vec4 crop;varying vec2 uv;void main(){uv=vec2(crop.x+(p.x*.5+.5)*crop.z,crop.y+(.5-p.y*.5)*crop.w);gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec3 key;uniform float range;uniform float spill;
float cbf(vec3 c){return -.1687*c.r-.3313*c.g+.5*c.b;}float crf(vec3 c){return .5*c.r-.4187*c.g-.0813*c.b;}
void main(){vec4 s=texture2D(tex,uv);vec3 c=s.rgb;float d=distance(vec2(cbf(c),crf(c)),vec2(cbf(key),crf(key)));float t0=range*.5;
float a=clamp((d-t0)/${KEY_SOFT.toFixed(2)},0.,1.);float k=spill*(1.-clamp((d-t0)/${(KEY_SOFT + 0.25).toFixed(2)},0.,1.));float y=dot(c,vec3(.299,.587,.114));
c=mix(c,vec3(y),k);float o=a*s.a;gl_FragColor=vec4(c*o,o);}`;

interface Gl { canvas: HTMLCanvasElement | OffscreenCanvas; gl: WebGLRenderingContext; tex: WebGLTexture; u: Record<string, WebGLUniformLocation | null> }
let glState: Gl | null | undefined;
let cpuCanvas: HTMLCanvasElement | OffscreenCanvas | undefined;

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | undefined {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  return undefined;
}

function initGl(): Gl | null {
  try {
    const canvas = makeCanvas(2, 2);
    const gl = canvas?.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false }) as WebGLRenderingContext | null;
    if (!canvas || !gl) return null;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const u = Object.fromEntries(["crop", "key", "range", "spill", "tex"].map((n) => [n, gl.getUniformLocation(prog, n)]));
    return { canvas, gl, tex, u };
  } catch { return null; }
}

/** Fit (w, h) inside a max side, keeping the aspect ratio. */
export function keySize(w: number, h: number, max: number): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** Test hook: force the CPU path (or reset to auto). */
export function forceCpuKey(on: boolean) { glState = on ? null : undefined; }

/**
 * The keyed crop (sx, sy, sw, sh) of `src` (full size srcW × srcH) as an image to draw in its place, or undefined
 * when keying is impossible here (then the caller draws the clip unkeyed).
 */
export function keyedImage(src: CanvasImageSource, srcW: number, srcH: number, sx: number, sy: number, sw: number, sh: number, key: ChromaKey): CanvasImageSource | undefined {
  if (sw <= 0 || sh <= 0) return undefined;
  if (glState === undefined) glState = initGl();
  const k = { rgb: hexRgb(key.color), range: key.range, spill: key.spill };
  if (glState) {
    const { canvas, gl, u } = glState;
    const { w, h } = keySize(sw, sh, KEY_MAX_SIDE);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    try {
      gl.viewport(0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
      gl.uniform4f(u.crop, sx / srcW, sy / srcH, sw / srcW, sh / srcH);
      gl.uniform3f(u.key, k.rgb[0], k.rgb[1], k.rgb[2]);
      gl.uniform1f(u.range, k.range); gl.uniform1f(u.spill, k.spill); gl.uniform1i(u.tex, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!gl.isContextLost()) return canvas;
    } catch { /* tainted or unsupported source: fall back to the CPU */ }
  }
  const { w, h } = keySize(sw, sh, KEY_CPU_SIDE);
  cpuCanvas ??= makeCanvas(w, h);
  if (!cpuCanvas) return undefined;
  if (cpuCanvas.width !== w || cpuCanvas.height !== h) { cpuCanvas.width = w; cpuCanvas.height = h; }
  const g = cpuCanvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!g) return undefined;
  try {
    g.clearRect(0, 0, w, h);
    g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    keyImageData(img.data, k);
    g.putImageData(img, 0, 0);
    return cpuCanvas;
  } catch { return undefined; }
}

/** Key RGBA bytes in place (CPU path; also used by tests). */
export function keyImageData(px: Uint8ClampedArray, k: { rgb: [number, number, number]; range: number; spill: number }) {
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const [r, g, b, a] = keyPixel(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, k);
    px[i] = r * 255; px[i + 1] = g * 255; px[i + 2] = b * 255; px[i + 3] = px[i + 3] * a;
  }
}

/**
 * Draw the crop of `src` into the box (dx, dy, dw, dh) of `g`, keyed when `key` is active (falls back to unkeyed).
 * The one call Player uses for every visual media clip.
 */
export function drawKeyed(
  g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number,
  sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, key: ChromaKey | undefined,
) {
  const keyed = keyActive(key) ? keyedImage(src, srcW, srcH, sx, sy, sw, sh, key) : undefined;
  if (keyed) g.drawImage(keyed, dx, dy, dw, dh);
  else g.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
}
