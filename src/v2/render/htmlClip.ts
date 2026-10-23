/**
 * HTML / three.js clips. The user's HTML runs in a sandboxed iframe (scripts only: opaque origin, no
 * access to the editor, storage or cookies). It is driven by time, never by its own clock:
 *   editor → iframe  {type:"dionysus:frame", seq, t}   (t = clip-local seconds)
 *   iframe → editor  {type:"dionysus:frame", seq, bmp}  (ImageBitmap of its first <canvas>)
 * Pages register a renderer with `dionysus.onFrame(t => …)`; the runtime below is injected ahead of
 * the page so any canvas (2D, WebGL, three.js) is captured right after it renders frame t.
 */
export const HTML_RUNTIME = `<script>(()=>{const fns=[];window.dionysus={t:0,onFrame(f){fns.push(f)}};
addEventListener("message",async(e)=>{const d=e.data;if(!d||d.type!=="dionysus:frame"||e.source!==parent)return;
window.dionysus.t=d.t;try{for(const f of fns){const r=f(d.t);if(r&&r.then)await r}}catch(err){console.error(err)}
const c=document.querySelector("canvas");let bmp=null;if(c&&c.width&&c.height){try{bmp=await createImageBitmap(c)}catch(_){}}
parent.postMessage({type:"dionysus:frame",seq:d.seq,bmp},"*",bmp?[bmp]:[])});
addEventListener("load",()=>parent.postMessage({type:"dionysus:ready"},"*"))})()</script>`;

/** three.js is self-hosted (public/vendor) and pinned by SRI; it is the only script URL a clip may load. */
export const THREE_PATH = "vendor/three-0.160.0.module.min.js";
export const THREE_INTEGRITY = "sha384-8/hf5tabFfIo0BPku31TKUvGIKpWGYaMwNtlSNqNyZzXgZCMd4lnOGWbJElML9dv";
const LEGACY_THREE = /https:\/\/unpkg\.com\/three@[\d.]+\/build\/three\.module(?:\.min)?\.js/g;

/** Absolute URL of the vendored three.js for this deployment (works from the opaque-origin iframe). */
export function threeUrl(base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/", href = globalThis.location?.href ?? "http://localhost/"): string {
  return new URL(`${base}${THREE_PATH}`, href).href;
}

/** Locked-down policy: nothing remote except the pinned three.js file; inline/blob:/data: for the page itself. */
export function clipCsp(three: string): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' blob: data: ${three}`,
    "style-src 'unsafe-inline' blob: data:",
    "img-src blob: data:", "font-src blob: data:", "media-src blob: data:", "connect-src blob: data:", "worker-src blob:",
  ].join("; ");
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Prepend (after a doctype, if any) the CSP meta, an import map exposing `three` with its integrity hash,
 * and the frame-seek runtime, so all three apply before any page markup or script. Old clips that import
 * three.js from unpkg are pointed at the pinned local copy.
 */
export function withRuntime(html: string, three = threeUrl()): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${attr(clipCsp(three))}">`
    + `<script type="importmap">${JSON.stringify({ imports: { three }, integrity: { [three]: THREE_INTEGRITY } })}</script>`
    + HTML_RUNTIME;
  const page = html.replace(LEGACY_THREE, "three");
  const m = /^\s*<!doctype[^>]*>/i.exec(page);
  return m ? m[0] + head + page.slice(m[0].length) : head + page;
}

export const HTML_SANDBOX = "allow-scripts";
/** Largest frame accepted from a clip (8K); anything else is treated as a bad frame. */
export const MAX_FRAME_SIDE = 8192;

/** A frame from the iframe is untrusted: only a real, non-empty, bounded ImageBitmap may reach drawImage. */
export function isValidFrame(v: unknown): v is ImageBitmap {
  if (typeof ImageBitmap === "undefined" || !(v instanceof ImageBitmap)) return false;
  const { width: w, height: h } = v;
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= MAX_FRAME_SIDE && h <= MAX_FRAME_SIDE;
}

export type FrameIssue = "timeout" | "invalid";

/** One iframe per placement; keeps the last delivered frame and requests at most one at a time. */
export class HtmlClipHost {
  readonly iframe: HTMLIFrameElement;
  frame?: ImageBitmap;
  private shown?: number;
  private want?: number;
  private inflight?: { seq: number; t: number };
  private seq = 0;
  private ready = false;
  private waiters = new Set<() => void>();
  /** Problem with the most recently delivered frame (cleared by a good frame). */
  issue?: FrameIssue;
  private onMsg = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow) return;
    const d: unknown = e.data;
    if (!d || typeof d !== "object") return;
    const { type, seq, bmp } = d as { type?: unknown; seq?: unknown; bmp?: unknown };
    if (type === "dionysus:ready") { this.ready = true; this.pump(); return; }
    if (type !== "dionysus:frame" || seq !== this.inflight?.seq) return;
    if (isValidFrame(bmp)) { this.frame?.close?.(); this.frame = bmp; this.issue = undefined; }
    else { this.issue = "invalid"; if (typeof ImageBitmap !== "undefined" && bmp instanceof ImageBitmap) bmp.close(); }
    this.shown = this.inflight?.t; this.inflight = undefined;
    this.onFrame();
    this.pump();
    if (this.settled()) { this.waiters.forEach((w) => w()); this.waiters.clear(); }
  };

  constructor(html: Promise<string | undefined>, width: number, height: number, private onFrame: () => void) {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", HTML_SANDBOX);
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.width = String(width); f.height = String(height);
    f.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`;
    this.iframe = f;
    window.addEventListener("message", this.onMsg);
    document.body.appendChild(f);
    void html.then((h) => { f.srcdoc = withRuntime(h ?? ""); });
  }

  /** Ask for frame at clip-local seconds `t` (coalesces: only the latest pending request is sent). */
  request(t: number) { this.want = t; this.pump(); }

  settled() { return this.want === undefined || (this.shown === this.want && !this.inflight); }

  /**
   * Resolves when the requested frame has arrived, or after `ms` so export never hangs on a broken page.
   * Returns the frame's problem, if any: "timeout" (the stale/blank previous frame is still shown) or "invalid".
   */
  settle(ms = 4000): Promise<FrameIssue | undefined> {
    if (this.settled()) return Promise.resolve(this.issue);
    return new Promise((res) => {
      const done = () => { clearTimeout(to); this.waiters.delete(done); res(this.settled() ? this.issue : "timeout"); };
      const to = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  private pump() {
    if (!this.ready || this.inflight || this.want === undefined || this.want === this.shown) return;
    this.inflight = { seq: ++this.seq, t: this.want };
    this.iframe.contentWindow?.postMessage({ type: "dionysus:frame", seq: this.seq, t: this.want }, "*");
  }

  dispose() {
    window.removeEventListener("message", this.onMsg);
    this.waiters.forEach((w) => w());
    this.frame?.close?.();
    this.iframe.remove();
  }
}

/** Starter clip: a three.js scene whose every pixel is a function of t (so preview == export). */
export const THREE_TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block}</style></head>
<body><canvas id="c"></canvas>
<script type="module">
import * as THREE from "three"; // pinned, self-hosted copy (see THREE_PATH)
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 4;
const cube = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.28, 160, 24), new THREE.MeshStandardMaterial({ color: 0x5ad1c8, metalness: 0.3, roughness: 0.35 }));
scene.add(cube, new THREE.AmbientLight(0xffffff, 0.4));
const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 3, 4); scene.add(light);
// Draw frame t (seconds into the clip). Never use Date.now()/requestAnimationFrame for motion.
dionysus.onFrame((t) => {
  cube.rotation.set(t * 0.9, t * 1.3, 0);
  scene.background = new THREE.Color().setHSL((t * 0.05) % 1, 0.35, 0.12);
  renderer.render(scene, camera);
});
</script></body></html>
`;
