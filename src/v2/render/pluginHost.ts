import { isValidFrame } from "./htmlClip";
import { loadPluginLibs } from "./pluginLibs";
import type { ClipPluginMeta } from "../clipTypes";

/**
 * P85 (Phase 3 step 3.3, decision 10): the sandboxed renderer of third-party clip types.
 *
 * One **bootstrap iframe** per plugin package per Player (`sandbox="allow-scripts"`, so an opaque origin with no
 * access to the editor, its storage or cookies) runs only the host-written `PLUGIN_BOOTSTRAP_JS` under the clip CSP
 * with no network (`pluginCsp`). It never runs plugin code: per clip it starts one **classic worker** from a `blob:`
 * URL (`PLUGIN_WORKER_JS`), which inherits the page's CSP, installs the determinism shim (virtual
 * `performance.now` / `Date` / `requestAnimationFrame` from the clip time, seeded `Math.random`, reset before `init`
 * and before every frame so frames match in any order), loads the pinned libraries (classic text from
 * render/pluginLibs.ts) and the plugin's render entry, and draws each frame on an `OffscreenCanvas`, answering with an
 * `ImageBitmap`. A worker can be terminated, so a hung plugin can't freeze the editor or an export.
 *
 *   editor → iframe  {type:"start", wid, init}  /  {type:"post", wid, msg}  /  {type:"kill", wid}
 *   iframe → editor  {type:"ready"}  /  worker replies with `wid` added  /  {type:"crash", wid, message}
 *   editor → worker  {type:"init", width, height, duration, params, files, libs, entry}  /  {type:"frame", seq, t, duration, params}
 *   worker → editor  {type:"ready"}  /  {type:"error", message}  /  {type:"frame", seq, bmp?, error?}
 *
 * The watchdog (`PluginClipHost`, in the editor): `init` has 15 s; a frame 4 s; two frame timeouts in a row
 * terminate and restart the worker (as do an init failure or a crash); after three restarts the clip is stopped
 * ("Plugin stopped"; export reports its frames). Preview keeps showing the last frame while one is late.
 */

/** Same policy as HTML clips (render/htmlClip.ts `clipCsp`) minus every URL: inline bootstrap, blob: workers only. */
export function pluginCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' blob:",
    "worker-src blob:",
    "connect-src blob: data:",
    "img-src blob: data:", "font-src blob: data:", "media-src blob: data:",
    "style-src 'unsafe-inline'",
  ].join("; ");
}

/** The classic worker every plugin clip runs in (text, started from a blob: URL by the bootstrap). */
export const PLUGIN_WORKER_JS = `"use strict";(()=>{
let vt=0,s=0,def=null,ready=false,chain=Promise.resolve();const SEED=0x2f6b1d3,E=1767225600000,A={};
const vnow=()=>vt*1000;
try{Object.defineProperty(performance,"now",{value:vnow,configurable:true,writable:true})}catch(_){}
const OD=Date;self.Date=class extends OD{constructor(...a){a.length?super(...a):super(E+vnow())}static now(){return E+vnow()}};
const q=new Map();let rid=0;self.requestAnimationFrame=(cb)=>{q.set(++rid,cb);return rid};self.cancelAnimationFrame=(i)=>{q.delete(i)};
Math.random=()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const asset=(n)=>{if(typeof n!=="string")return null;const k=n.replace(/^\\.\\//,"");return A[k]||null};
const ctx={canvas:null,width:0,height:0,t:0,duration:0,progress:0,params:{},asset,random:()=>Math.random()};
self.dionysus=Object.freeze({clip(d){if(def)throw new Error("dionysus.clip() was called twice.");def=d},asset});
const text=(e)=>String((e&&e.message)||e||"error").slice(0,300);
const init=async(d)=>{
ctx.width=d.width;ctx.height=d.height;ctx.duration=d.duration||0;ctx.params=d.params||{};ctx.canvas=new OffscreenCanvas(d.width,d.height);
for(const[n,f]of Object.entries(d.files||{}))A[n]=URL.createObjectURL(new Blob([f.bytes],{type:f.type||"application/octet-stream"}));
try{for(const src of d.libs||[])importScripts(URL.createObjectURL(new Blob([src],{type:"text/javascript"})));
if(!A[d.entry])throw new Error("The render entry \\""+d.entry+"\\" is missing.");
importScripts(A[d.entry]);
if(!def||typeof def.render!=="function")throw new Error("The render script didn't call dionysus.clip({ render }).");
s=SEED;vt=0;if(typeof def.init==="function")await def.init(ctx);ready=true;postMessage({type:"ready"})}
catch(e){postMessage({type:"error",message:text(e)})}};
const frame=async(d)=>{if(!ready)return;
if(d.params)ctx.params=d.params;if(d.duration>0)ctx.duration=d.duration;
vt=d.t;ctx.t=d.t;ctx.progress=ctx.duration>0?Math.min(1,Math.max(0,d.t/ctx.duration)):0;s=SEED;
try{const cbs=[...q.values()];q.clear();for(const cb of cbs)cb(vnow());await def.render(d.t,ctx);
const bmp=await createImageBitmap(ctx.canvas);postMessage({type:"frame",seq:d.seq,bmp},[bmp])}
catch(e){postMessage({type:"frame",seq:d.seq,error:text(e)})}};
self.onmessage=(e)=>{const d=e.data;if(!d||typeof d!=="object")return;
if(d.type==="init")chain=chain.then(()=>init(d));else if(d.type==="frame")chain=chain.then(()=>frame(d))};
})();`;

/** The host-written page of the bootstrap iframe: starts, feeds and terminates workers; never runs plugin code. */
export const PLUGIN_BOOTSTRAP_JS = `(()=>{const P=parent,W=new Map();
const url=URL.createObjectURL(new Blob([${JSON.stringify(PLUGIN_WORKER_JS).replace(/</g, "\\u003c")}],{type:"text/javascript"}));
const say=(m,tr)=>{try{P.postMessage(m,"*",tr||[])}catch(_){}};
addEventListener("message",(e)=>{if(e.source!==P)return;const d=e.data;if(!d||typeof d!=="object"||typeof d.wid!=="string")return;
if(d.type==="kill"){const w=W.get(d.wid);if(w)w.terminate();W.delete(d.wid);return}
if(d.type==="post"){const w=W.get(d.wid);if(w)w.postMessage(d.msg);return}
if(d.type!=="start")return;const old=W.get(d.wid);if(old)old.terminate();
let w;try{w=new Worker(url,{name:"dionysus-plugin"})}catch(err){say({type:"crash",wid:d.wid,message:String(err&&err.message||err)});return}
W.set(d.wid,w);
w.onmessage=(m)=>{const x=m.data;if(!x||typeof x!=="object"||W.get(d.wid)!==w)return;
const b=x.bmp instanceof ImageBitmap?x.bmp:null;say({type:x.type,seq:x.seq,message:typeof x.message==="string"?x.message:undefined,error:typeof x.error==="string"?x.error:undefined,bmp:b,wid:d.wid},b?[b]:[])};
w.onerror=(ev)=>{ev.preventDefault();if(W.get(d.wid)===w)say({type:"crash",wid:d.wid,message:String(ev.message||"The plugin's worker failed.")})};
w.postMessage(Object.assign({},d.init,{type:"init"}))});
say({type:"ready"})})();`;

/** The bootstrap page (CSP first, so it applies before the script). */
export const pluginBootstrapPage = () =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${pluginCsp()}"></head><body><script>${PLUGIN_BOOTSTRAP_JS}</script></body></html>`;

/** What the worker's `init` gets. */
export interface PluginInit {
  width: number;
  height: number;
  duration: number;
  params: Record<string, unknown>;
  files: Record<string, { bytes: Uint8Array; type: string }>;
  libs: string[];
  entry: string;
}

/** A reply from a worker (through the bootstrap). */
export interface PluginReply { type: string; seq?: number; bmp?: unknown; message?: string; error?: string }

/** How a clip host reaches its worker (the bootstrap iframe; a fake in tests). */
export interface PluginChannel {
  start(wid: string, init: PluginInit, onReply: (r: PluginReply) => void): void;
  frame(wid: string, msg: { type: "frame"; seq: number; t: number; duration?: number; params?: Record<string, unknown> }): void;
  kill(wid: string): void;
}

/** One bootstrap iframe (per plugin package per Player): routes worker replies to their clip hosts by `wid`. */
export class PluginSandbox implements PluginChannel {
  readonly iframe: HTMLIFrameElement;
  private ready = false;
  private queue: [unknown, Transferable[]][] = [];
  private routes = new Map<string, (r: PluginReply) => void>();
  private onMsg = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow) return;
    const d: unknown = e.data;
    if (!d || typeof d !== "object") return;
    const r = d as PluginReply & { wid?: unknown };
    if (r.type === "ready" && r.wid === undefined) { this.ready = true; for (const [m, tr] of this.queue.splice(0)) this.send(m, tr); return; }
    const route = typeof r.wid === "string" ? this.routes.get(r.wid) : undefined;
    if (route) route(r);
    else if (typeof ImageBitmap !== "undefined" && r.bmp instanceof ImageBitmap) r.bmp.close();
  };

  constructor() {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.style.cssText = "position:fixed;left:-200px;top:0;width:100px;height:100px;border:0;pointer-events:none";
    this.iframe = f;
    window.addEventListener("message", this.onMsg);
    document.body.appendChild(f);
    f.srcdoc = pluginBootstrapPage();
  }

  private send(m: unknown, transfer: Transferable[] = []) {
    if (!this.ready) { this.queue.push([m, transfer]); return; }
    this.iframe.contentWindow?.postMessage(m, "*", transfer);
  }

  start(wid: string, init: PluginInit, onReply: (r: PluginReply) => void) {
    this.routes.set(wid, onReply);
    this.send({ type: "start", wid, init });
  }
  frame(wid: string, msg: Parameters<PluginChannel["frame"]>[1]) { this.send({ type: "post", wid, msg }); }
  kill(wid: string) { this.routes.delete(wid); this.send({ type: "kill", wid }); }
  get size() { return this.routes.size; }

  dispose() {
    window.removeEventListener("message", this.onMsg);
    this.routes.clear(); this.queue = [];
    this.iframe.remove();
  }
}

export const PLUGIN_TIME_LIMITS = { initMs: 15_000, frameMs: 4_000, restarts: 3 } as const;
export type PluginLimits = { initMs: number; frameMs: number; restarts: number };
export type PluginFrameIssue = "timeout" | "invalid" | "stopped";

const MIME: Record<string, string> = {
  js: "text/javascript", json: "application/json", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  glb: "model/gltf-binary", gltf: "model/gltf+json", bin: "application/octet-stream", wasm: "application/wasm",
};
export const pluginFileType = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Build a worker's `init` for a registered plugin at an output size (libraries fetched once per page). */
export async function pluginInitFor(meta: ClipPluginMeta, width: number, height: number, params: Record<string, unknown>, duration: number, libs: (ids: readonly string[]) => Promise<string[]> = loadPluginLibs): Promise<PluginInit> {
  const files: PluginInit["files"] = {};
  for (const [n, bytes] of meta.files ?? []) files[n] = { bytes, type: pluginFileType(n) };
  return { width, height, duration, params, files, libs: await libs(meta.manifest.render.libs ?? []), entry: meta.manifest.render.entry };
}

let widCount = 0;

/**
 * One plugin clip at one output size: its worker, the latest requested and delivered frame, and the watchdog. Same
 * surface as `HtmlClipHost` where the Player needs it (`frame`, `issue`, `settled`, `settle`, `request`, `dispose`).
 */
export class PluginClipHost {
  frame?: ImageBitmap;
  issue?: PluginFrameIssue;
  /** After too many restarts: the clip shows "Plugin stopped" until the project is opened again. */
  stopped = false;
  /** The plugin's own error messages (init failures, crashes, frame errors), newest last, at most 5. */
  errors: string[] = [];
  restarts = 0;
  private wid = `p${++widCount}`;
  private gen = 0;
  private state: "starting" | "ready" | "stopped" | "disposed" = "starting";
  private want?: number;
  private shown?: number;
  private inflight?: { seq: number; t: number; epoch: number };
  private seq = 0;
  private epoch = 0;
  private params: Record<string, unknown> = {};
  private paramSig = "{}";
  private duration = 0;
  private timeouts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private waiters = new Set<() => void>();

  constructor(private channel: PluginChannel, private init: (params: Record<string, unknown>, duration: number) => Promise<PluginInit>, private onFrame: () => void, readonly limits: PluginLimits = PLUGIN_TIME_LIMITS) {}

  private note(m: string | undefined) { if (!m) return; this.errors.push(m); if (this.errors.length > 5) this.errors.shift(); }
  private clear() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private wake() { if (!this.settled()) return; const w = [...this.waiters]; this.waiters.clear(); w.forEach((f) => f()); }

  private start() {
    const gen = ++this.gen;
    this.state = "starting"; this.inflight = undefined; this.shown = undefined; this.timeouts = 0;
    this.clear();
    this.timer = setTimeout(() => { if (gen === this.gen) this.fail(`The plugin didn't finish starting within ${this.limits.initMs / 1000} s.`); }, this.limits.initMs);
    this.init(this.params, this.duration).then((init) => {
      if (gen !== this.gen || this.state !== "starting") return;
      this.channel.start(this.wid, init, (r) => { if (gen === this.gen) this.reply(r); });
    }, (e: unknown) => { if (gen === this.gen) this.fail(e instanceof Error ? e.message : String(e)); });
  }

  private reply(r: PluginReply) {
    if (this.state === "starting") {
      if (r.type === "ready") { this.clear(); this.state = "ready"; this.pump(); return; }
      if (r.type === "error" || r.type === "crash") { this.fail(r.message ?? "The plugin failed to start."); return; }
    }
    if (this.state !== "ready") return;
    if (r.type === "crash") { this.fail(r.message ?? "The plugin's worker failed."); return; }
    const inf = this.inflight;
    if (r.type !== "frame" || !inf || r.seq !== inf.seq) { if (isBitmap(r.bmp)) r.bmp.close(); return; }
    this.clear(); this.timeouts = 0;
    if (isValidFrame(r.bmp)) { this.frame?.close?.(); this.frame = r.bmp; this.issue = undefined; }
    else { this.issue = "invalid"; this.note(r.error); if (isBitmap(r.bmp)) r.bmp.close(); }
    this.shown = inf.epoch === this.epoch ? inf.t : undefined;
    this.inflight = undefined;
    this.onFrame();
    this.pump();
    this.wake();
  }

  private timeout() {
    this.timer = undefined;
    this.inflight = undefined;
    if (++this.timeouts >= 2) { this.fail(`A frame took longer than ${this.limits.frameMs / 1000} s twice in a row.`); return; }
    this.pump();
  }

  private fail(reason: string) {
    if (this.state === "disposed" || this.state === "stopped") return;
    this.clear();
    this.note(reason);
    this.channel.kill(this.wid);
    if (this.restarts >= this.limits.restarts) {
      this.state = "stopped"; this.stopped = true; this.issue = "stopped"; this.gen += 1;
      this.onFrame(); this.wake();
      return;
    }
    this.restarts += 1;
    this.start();
  }

  private pump() {
    if (this.state !== "ready" || this.inflight || this.want === undefined || this.want === this.shown) return;
    this.inflight = { seq: ++this.seq, t: this.want, epoch: this.epoch };
    this.channel.frame(this.wid, { type: "frame", seq: this.seq, t: this.want, duration: this.duration, params: this.params });
    this.timer = setTimeout(() => this.timeout(), this.limits.frameMs);
  }

  /** Ask for the frame at clip-local seconds `t` with these params (only the latest pending request is sent). */
  request(t: number, duration: number, params: Record<string, unknown>) {
    this.duration = duration;
    const sig = JSON.stringify(params);
    if (sig !== this.paramSig) { this.paramSig = sig; this.params = params; this.epoch += 1; this.shown = undefined; }
    this.want = t;
    if (this.gen === 0 && this.state === "starting") this.start();
    this.pump();
  }

  settled() { return this.stopped || this.state === "disposed" || this.want === undefined || (this.state === "ready" && this.shown === this.want && !this.inflight); }

  /** Resolves when the requested frame is in (or the clip stopped), or after `ms`, so export never hangs. */
  settle(ms = this.limits.initMs + 2 * this.limits.frameMs + 1000): Promise<PluginFrameIssue | undefined> {
    if (this.settled()) return Promise.resolve(this.issue);
    return new Promise((res) => {
      const done = () => { clearTimeout(to); this.waiters.delete(done); res(this.settled() ? this.issue : "timeout"); };
      const to = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  dispose() {
    if (this.state === "disposed") return;
    this.clear();
    if (this.gen > 0) this.channel.kill(this.wid);
    this.state = "disposed"; this.gen += 1;
    this.frame?.close?.(); this.frame = undefined;
    const w = [...this.waiters]; this.waiters.clear(); w.forEach((f) => f());
  }
}

const isBitmap = (v: unknown): v is ImageBitmap => typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap;
