import { readClipConfig, selectedLibraries, vendorUrl, type HtmlLibrary } from "./htmlLibs";

/**
 * HTML clips. The user's HTML runs in a sandboxed iframe (scripts only: opaque origin, no access to the
 * editor, storage or cookies). It is driven by timeline time, never by its own clock:
 *   editor → iframe  {type:"dionysus:frame", seq, t}   (t = clip-local seconds)
 *   iframe → editor  {type:"dionysus:frame", seq, bmp}  (ImageBitmap of its first <canvas>)
 * Library-agnostic time contract: pages may use `dionysus.onFrame(t => …)` OR plain
 * requestAnimationFrame / performance.now / Date.now, which the shim below drives from t. Math.random is
 * seeded so export is deterministic. Attached files resolve by relative name to blob: URLs.
 */
export const HTML_RUNTIME_JS = `const fns=[],q=new Map();let vt=0,rid=0,s=0x2f6b1d3;const E=1767225600000;
const vnow=()=>vt*1000;performance.now=vnow;const OD=Date;
window.Date=class extends OD{constructor(...a){a.length?super(...a):super(E+vnow())}static now(){return E+vnow()}};
window.requestAnimationFrame=(cb)=>{q.set(++rid,cb);return rid};window.cancelAnimationFrame=(i)=>{q.delete(i)};
Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const A={};for(const[n,d]of Object.entries(ASSETS)){const m=/^data:([^;,]*)(;base64)?,([\\s\\S]*)$/.exec(d);if(!m)continue;
const raw=m[2]?atob(m[3]):decodeURIComponent(m[3]);const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);
A[n]=URL.createObjectURL(new Blob([u],{type:m[1]||"application/octet-stream"}))}
const res=(n)=>typeof n==="string"?A[n.replace(/^\\.\\//,"")]:undefined;
const of=window.fetch;window.fetch=(i,o)=>of(res(i)||i,o);
const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return xo.call(this,m,res(u)||u,...r)};
const AT=["src","href","poster","data"];const fix=(el)=>{if(!el.getAttribute)return;for(const a of AT){const v=el.getAttribute(a),b=res(v);if(b)el.setAttribute(a,b)}};
new MutationObserver((ms)=>{for(const m of ms){if(m.type==="attributes")fix(m.target);for(const n of m.addedNodes)if(n.nodeType===1){fix(n);n.querySelectorAll("*").forEach(fix)}}})
.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:AT});
window.dionysus={t:0,onFrame(f){fns.push(f)},asset:(n)=>res(n)};
addEventListener("message",async(e)=>{const d=e.data;if(!d||d.type!=="dionysus:frame"||e.source!==parent)return;
vt=d.t;window.dionysus.t=d.t;try{const cbs=[...q.values()];q.clear();for(const cb of cbs)cb(vnow());
for(const f of fns){const r=f(d.t);if(r&&r.then)await r}}catch(err){console.error(err)}
const c=document.querySelector("canvas");let bmp=null;if(c&&c.width&&c.height){try{bmp=await createImageBitmap(c)}catch(_){}}
parent.postMessage({type:"dionysus:frame",seq:d.seq,bmp},"*",bmp?[bmp]:[])});
addEventListener("load",()=>parent.postMessage({type:"dionysus:ready"},"*"));`;

/** Runtime script tag with the clip's attachments inlined (name → data: URL). */
export const htmlRuntime = (assets: Record<string, string> = {}) =>
  `<script>(()=>{const ASSETS=${JSON.stringify(assets).replace(/</g, "\\u003c")};${HTML_RUNTIME_JS}})()</script>`;
export const HTML_RUNTIME = htmlRuntime();

/** Locked-down policy: nothing remote except the selected, pinned library files; inline/blob:/data: for the page. */
export function clipCsp(libUrls: string[] = []): string {
  return [
    "default-src 'none'",
    ["script-src 'unsafe-inline' blob: data:", ...libUrls].join(" "),
    "style-src 'unsafe-inline' blob: data:",
    "img-src blob: data:", "font-src blob: data:", "media-src blob: data:", "connect-src blob: data:", "worker-src blob:",
  ].join("; ");
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Prepend (after a doctype, if any) the CSP meta, an import map for the selected libraries (with SRI),
 * and the runtime, so all apply before any page markup or script. CSS url(name) references to
 * attachments are inlined. Legacy CDN URLs of a selected library point at its pinned copy.
 */
export function withRuntime(html: string, url: (l: HtmlLibrary) => string = (l) => vendorUrl(l.path)): string {
  const libs = selectedLibraries(html);
  const urls = libs.map(url);
  const assets = readClipConfig(html).assets ?? {};
  const map = { imports: Object.fromEntries(libs.map((l, i) => [l.specifier, urls[i]])), integrity: Object.fromEntries(libs.map((l, i) => [urls[i], l.integrity])) };
  const head = `<meta http-equiv="Content-Security-Policy" content="${attr(clipCsp(urls))}">`
    + (libs.length ? `<script type="importmap">${JSON.stringify(map)}</script>` : "")
    + htmlRuntime(assets);
  let page = html;
  for (const l of libs) if (l.legacy) page = page.replace(new RegExp(l.legacy.source, "g"), l.specifier);
  for (const [n, d] of Object.entries(assets)) page = page.replace(new RegExp(`url\\(\\s*(["']?)(?:\\./)?${esc(n)}\\1\\s*\\)`, "g"), `url("${d}")`);
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

/** Starter clip (example using the three.js registry entry): a scene whose every pixel is a function of t (so preview == export). */
export const THREE_TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block}</style></head>
<body><canvas id="c"></canvas>
<script type="module">
import * as THREE from "three"; // pinned, self-hosted library (see render/htmlLibs.ts)
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 4;
const cube = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.28, 160, 24), new THREE.MeshStandardMaterial({ color: 0x5ad1c8, metalness: 0.3, roughness: 0.35 }));
scene.add(cube, new THREE.AmbientLight(0xffffff, 0.4));
const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(2, 3, 4); scene.add(light);
// Draw frame t (seconds into the clip). Plain requestAnimationFrame / performance.now also follow t.
dionysus.onFrame((t) => {
  cube.rotation.set(t * 0.9, t * 1.3, 0);
  scene.background = new THREE.Color().setHSL((t * 0.05) % 1, 0.35, 0.12);
  renderer.render(scene, camera);
});
</script></body></html>
`;
