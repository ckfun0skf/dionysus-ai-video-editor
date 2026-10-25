import type { HtmlClipManifest } from "../domain";
import { readClipConfig, selectedLibraries, vendorUrl, type HtmlLibrary } from "./htmlLibs";

/**
 * HTML clips (`dionysus.htmlclip/1`, docs/v2/HTML_CLIP_PACKAGE.md). The user's HTML runs in a sandboxed iframe
 * (scripts only: opaque origin, no access to the editor, storage or cookies). It is driven by timeline time, never by
 * its own clock:
 *   iframe → editor  {type:"dionysus:ready"}                                  (page loaded)
 *   editor → iframe  {type:"dionysus:init", width, height, duration, bindings:{name:{type, blob}}, params?}
 *   editor → iframe  {type:"dionysus:params", params}                          (V2-HTML-PARAMS: new per-use values; ctx.params = defaults ⊕ params)
 *   editor → iframe  {type:"dionysus:frame", seq, t, duration?}                (t = clip-local seconds)
 *   iframe → editor  {type:"dionysus:frame", seq, bmp}                        (ImageBitmap of its first <canvas>)
 * Contract: `dionysus.clip({ init?(ctx), render(t, ctx) })`; `init` (then document.fonts.ready) is awaited once before the first frame. Legacy
 * pages may use `dionysus.onFrame((t, ctx) => …)` OR plain requestAnimationFrame / performance.now / Date.now, which
 * the shim drives from t. Math.random is seeded so export is deterministic. Embedded files and bound assets resolve
 * by name to blob: URLs. Without an init message (the editor's live preview) the manifest's values are used.
 */
export const HTML_RUNTIME_JS = `const fns=[],q=new Map();let vt=0,rid=0,s=0x2f6b1d3,def=null,boot=null;const E=1767225600000;
const vnow=()=>vt*1000;performance.now=vnow;const OD=Date;
window.Date=class extends OD{constructor(...a){a.length?super(...a):super(E+vnow())}static now(){return E+vnow()}};
window.requestAnimationFrame=(cb)=>{q.set(++rid,cb);return rid};window.cancelAnimationFrame=(i)=>{q.delete(i)};
Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const A={};for(const[n,d]of Object.entries(M.files||{})){const m=/^data:([^;,]*)(;base64)?,([\\s\\S]*)$/.exec(d);if(!m)continue;
const raw=m[2]?atob(m[3]):decodeURIComponent(m[3]);const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);
A[n]=URL.createObjectURL(new Blob([u],{type:m[1]||"application/octet-stream"}))}
const res=(n)=>typeof n==="string"?A[n.replace(/^\\.\\//,"")]:undefined;
const of=window.fetch;window.fetch=(i,o)=>of(res(i)||i,o);
const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return xo.call(this,m,res(u)||u,...r)};
const AT=["src","href","poster","data"];const fix=(el)=>{if(!el.getAttribute)return;for(const a of AT){const v=el.getAttribute(a),b=res(v);if(b)el.setAttribute(a,b)}};
new MutationObserver((ms)=>{for(const m of ms){if(m.type==="attributes")fix(m.target);for(const n of m.addedNodes)if(n.nodeType===1){fix(n);n.querySelectorAll("*").forEach(fix)}}})
.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:AT});
const D={};for(const[k,p]of Object.entries(M.params||{}))if(p&&"default"in p)D[k]=p.default;const P=Object.assign({},D);
const B={};for(const[n,b]of Object.entries(M.bindings||{}))B[n]={type:b&&b.type,url:null};
const once=new Map();const memo=(k,f)=>{if(!once.has(k))once.set(k,f());return once.get(k)};
const urlOf=(n)=>(B[n]&&B[n].url)||res(n)||null;
const ctx={get canvas(){return document.querySelector("canvas")},t:0,progress:0,duration:+M.durationSec||0,width:+M.width||innerWidth,height:+M.height||innerHeight,params:P,bindings:B,
asset:urlOf,
image:(n)=>memo("i:"+n,()=>{const u=urlOf(n);if(!u)return Promise.resolve(null);const i=new Image();i.src=u;return i.decode().then(()=>i)}),
video:(n)=>memo("v:"+n,()=>{const u=urlOf(n);if(!u)return Promise.resolve(null);const v=document.createElement("video");v.muted=true;v.playsInline=true;v.preload="auto";v.crossOrigin="anonymous";v.src=u;
return new Promise((ok,no)=>{v.onloadeddata=()=>ok(v);v.onerror=()=>no(new Error("video "+n))})}),
seek:(v,sec)=>new Promise((ok)=>{if(!v)return ok(v);const x=Math.max(0,Math.min(sec,(v.duration||sec)-0.001));if(Math.abs(v.currentTime-x)<0.0005&&v.readyState>=2)return ok(v);
const to=setTimeout(()=>ok(v),3000);v.addEventListener("seeked",()=>{clearTimeout(to);ok(v)},{once:true});v.currentTime=x})};
const start=()=>boot||(boot=(async()=>{try{if(def&&def.init)await def.init(ctx)}finally{if(document.fonts)await document.fonts.ready}})().catch((e)=>console.error(e)));
window.dionysus={t:0,ctx,manifest:M,onFrame(f){fns.push(f)},clip(d){def=d;if(d&&d.render)fns.push((t,c)=>d.render(t,c))},asset:urlOf};
addEventListener("message",async(e)=>{const d=e.data;if(!d||e.source!==parent)return;
if(d.type==="dionysus:init"){if(d.width)ctx.width=d.width;if(d.height)ctx.height=d.height;if(d.duration>0)ctx.duration=d.duration;
if(d.params)Object.assign(P,d.params);for(const[n,b]of Object.entries(d.bindings||{})){if(!b||!b.blob)continue;B[n]={type:b.type||(B[n]&&B[n].type),url:URL.createObjectURL(b.blob)}}return}
if(d.type==="dionysus:params"){for(const k of Object.keys(P))delete P[k];Object.assign(P,D,d.params||{});return}
if(d.type!=="dionysus:frame")return;
await start();if(d.duration>0)ctx.duration=d.duration;
vt=d.t;window.dionysus.t=d.t;ctx.t=d.t;ctx.progress=ctx.duration>0?Math.min(1,Math.max(0,d.t/ctx.duration)):0;
try{const cbs=[...q.values()];q.clear();for(const cb of cbs)cb(vnow());
for(const f of fns){const r=f(d.t,ctx);if(r&&r.then)await r}}catch(err){console.error(err)}
const c=document.querySelector("canvas");let bmp=null;if(c&&c.width&&c.height){try{bmp=await createImageBitmap(c)}catch(_){}}
parent.postMessage({type:"dionysus:frame",seq:d.seq,bmp},"*",bmp?[bmp]:[])});
addEventListener("load",()=>parent.postMessage({type:"dionysus:ready"},"*"));`;

/** Runtime script tag with the clip's manifest inlined (its embedded files, params, bindings and size). */
export const htmlRuntime = (manifest: HtmlClipManifest = {}) =>
  `<script>(()=>{const M=${JSON.stringify(manifest).replace(/</g, "\\u003c")};${HTML_RUNTIME_JS}})()</script>`;
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
  const manifest = readClipConfig(html);
  const assets = manifest.files ?? {};
  const map = { imports: Object.fromEntries(libs.map((l, i) => [l.specifier, urls[i]])), integrity: Object.fromEntries(libs.map((l, i) => [urls[i], l.integrity])) };
  const head = `<meta http-equiv="Content-Security-Policy" content="${attr(clipCsp(urls))}">`
    + (libs.length ? `<script type="importmap">${JSON.stringify(map)}</script>` : "")
    + htmlRuntime(manifest);
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

/** Sent once after the page is ready, before its first frame (see the protocol above). */
export interface HtmlClipInit {
  width: number;
  height: number;
  duration?: number;
  bindings?: Record<string, { type: string; blob: Blob }>;
  params?: Record<string, unknown>;
}

/** One iframe per placement; keeps the last delivered frame and requests at most one at a time. */
export class HtmlClipHost {
  readonly iframe: HTMLIFrameElement;
  frame?: ImageBitmap;
  private shown?: number;
  private want?: number;
  private inflight?: { seq: number; t: number; epoch: number };
  /** Per-use param values last sent (V2-HTML-PARAMS); `epoch` bumps on a change so a frame in flight is redrawn. */
  private params?: Record<string, unknown>;
  private paramSig?: string;
  private epoch = 0;
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
    if (type === "dionysus:ready") {
      const go = (init: HtmlClipInit | undefined) => {
        if (init) this.iframe.contentWindow?.postMessage({ type: "dionysus:init", ...init }, "*");
        const sent = init?.params ? JSON.stringify(init.params) : undefined;
        if (this.params && this.paramSig !== sent) this.iframe.contentWindow?.postMessage({ type: "dionysus:params", params: this.params }, "*");
        else if (!this.params && sent) this.paramSig = sent;
        this.ready = true; this.pump();
      };
      // Without an init builder the message is known up front, so the first frame goes out synchronously.
      if (this.init) void this.init.then(go); else go(this.initDefault);
      return;
    }
    if (type !== "dionysus:frame" || seq !== this.inflight?.seq) return;
    if (isValidFrame(bmp)) { this.frame?.close?.(); this.frame = bmp; this.issue = undefined; }
    else { this.issue = "invalid"; if (typeof ImageBitmap !== "undefined" && bmp instanceof ImageBitmap) bmp.close(); }
    // A frame drawn before the latest params change is shown but not counted, so the same t is drawn again.
    this.shown = this.inflight?.epoch === this.epoch ? this.inflight.t : undefined; this.inflight = undefined;
    this.onFrame();
    this.pump();
    if (this.settled()) { this.waiters.forEach((w) => w()); this.waiters.clear(); }
  };

  private init?: Promise<HtmlClipInit | undefined>;
  private initDefault: HtmlClipInit;
  private duration?: number;

  /** `init` builds the init message from the clip's HTML (bound assets, size, length); omitted = manifest values. */
  constructor(html: Promise<string | undefined>, width: number, height: number, private onFrame: () => void, init?: (html: string) => Promise<HtmlClipInit | undefined>) {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", HTML_SANDBOX);
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.width = String(width); f.height = String(height);
    f.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`;
    this.iframe = f;
    this.initDefault = { width, height };
    window.addEventListener("message", this.onMsg);
    document.body.appendChild(f);
    void html.then((h) => {
      if (init) this.init = init(h ?? "").catch(() => this.initDefault);
      f.srcdoc = withRuntime(h ?? "");
    });
  }

  /** Ask for frame at clip-local seconds `t` (coalesces: only the latest pending request is sent). */
  request(t: number, duration?: number) { this.want = t; if (duration !== undefined) this.duration = duration; this.pump(); }

  /**
   * Per-use param values (V2-HTML-PARAMS): when they differ from the last ones, the page gets them (ctx.params is
   * reset to the manifest defaults plus these) and the current frame is drawn again. No reload.
   */
  setParams(params: Record<string, unknown>) {
    const sig = JSON.stringify(params);
    if (sig === this.paramSig) return;
    this.paramSig = sig; this.params = params;
    if (!this.ready) return;
    this.iframe.contentWindow?.postMessage({ type: "dionysus:params", params }, "*");
    this.epoch += 1; this.shown = undefined; this.pump();
  }

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
    this.inflight = { seq: ++this.seq, t: this.want, epoch: this.epoch };
    this.iframe.contentWindow?.postMessage({ type: "dionysus:frame", seq: this.seq, t: this.want, duration: this.duration }, "*");
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
