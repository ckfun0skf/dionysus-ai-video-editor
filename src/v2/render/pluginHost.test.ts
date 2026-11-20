// @vitest-environment jsdom
/**
 * P85 (Phase 3 step 3.3): the sandboxed plugin renderer. The bootstrap page and its CSP, the worker script's
 * determinism shim and contract (run in a Node VM with a fake OffscreenCanvas), and the editor-side watchdog
 * (`PluginClipHost` with a fake channel and fake timers): lazy start, coalescing, params, timeouts, restarts,
 * "Plugin stopped", crashes and stale replies. The real iframe + worker path is checked in Chrome (see the PR).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPluginFiles, parsePluginManifest } from "../domain";
import { PLUGIN_BOOTSTRAP_JS, PLUGIN_TIME_LIMITS, PLUGIN_WORKER_JS, PluginClipHost, PluginSandbox, pluginBootstrapPage, pluginCsp, pluginFileType, pluginInitFor, type PluginChannel, type PluginInit, type PluginReply } from "./pluginHost";
import { pluginCoreOf } from "../clipTypes";

const enc = new TextEncoder();
const SAMPLES = resolve(__dirname, "../../../public/plugins/samples");

class FakeBitmap { constructor(public width: number, public height: number, public data: string) {} close() { this.closed = true; } closed = false; }

/** Run the worker script in a VM: `post` collects its messages; `send` delivers one and waits for the chain. */
function workerVm() {
  const posted: Record<string, unknown>[] = [];
  const blobs = new Map<string, string>();
  let n = 0;
  class Canvas {
    log: string[] = [];
    constructor(public width: number, public height: number) {}
    getContext() { const log = this.log; return new Proxy({}, { get: (_t, k) => (...a: unknown[]) => { log.push(`${String(k)}(${a.join(",")})`); }, set: (_t, k, v) => { log.push(`${String(k)}=${v}`); return true; } }); }
  }
  const g: Record<string, unknown> = {
    console, Promise, JSON, Object, Error, String, Number, Array, Map, Uint8Array, TextDecoder,
    Date, Math: Object.create(Math), performance: { now: () => 123456 },
    OffscreenCanvas: Canvas,
    Blob: class { constructor(public parts: unknown[]) {} },
    URL: { createObjectURL: (b: { parts: unknown[] }) => { const u = `blob:null/${++n}`; const p = b.parts[0]; blobs.set(u, typeof p === "string" ? p : new TextDecoder().decode(p as Uint8Array)); return u; } },
    importScripts: (u: string) => { const src = blobs.get(u); if (src === undefined) throw new Error(`blocked ${u}`); vm.runInContext(src, ctx); },
    createImageBitmap: async (c: Canvas) => new FakeBitmap(c.width, c.height, c.log.splice(0).join(";")),
    postMessage: (m: Record<string, unknown>) => { posted.push(m); },
  };
  g.self = g;
  const ctx = vm.createContext(g);
  vm.runInContext(PLUGIN_WORKER_JS, ctx);
  const send = async (d: Record<string, unknown>) => { (g.onmessage as (e: { data: unknown }) => void)({ data: d }); for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { posted, send, g };
}
const initMsg = (render: string, extra: Partial<PluginInit> = {}): Record<string, unknown> =>
  ({ type: "init", width: 64, height: 36, duration: 2, params: { k: 1 }, files: { "render.js": { bytes: enc.encode(render), type: "text/javascript" } }, libs: [], entry: "render.js", ...extra });

describe("P85 bootstrap page and CSP", () => {
  it("allows no network: no http(s) sources, connect only to blob:/data:, workers only from blob:", () => {
    const csp = pluginCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src blob: data:");
    expect(csp).toContain("worker-src blob:");
    expect(csp).toMatch(/script-src 'unsafe-inline' blob:(;|$)/);
    expect(csp).not.toMatch(/https?:|\*|'unsafe-eval'/);
    const page = pluginBootstrapPage();
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script>"));
    expect(page.match(/<script/g)).toHaveLength(1);
    expect(PLUGIN_BOOTSTRAP_JS).not.toMatch(/<\/script/i);
    // the bootstrap never evaluates plugin code itself: only workers do
    const own = PLUGIN_BOOTSTRAP_JS.replace(JSON.stringify(PLUGIN_WORKER_JS).replace(/</g, "\\u003c"), "WORKER");
    expect(own).toContain("new Blob([WORKER]");
    expect(own).not.toMatch(/\beval\(|new Function|importScripts/);
  });

  it("creates a scripts-only sandboxed iframe and routes replies by worker id", () => {
    const sb = new PluginSandbox();
    expect(sb.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(sb.iframe.srcdoc).toBe(pluginBootstrapPage());
    const sent: unknown[] = [];
    const win = sb.iframe.contentWindow!;
    vi.spyOn(win, "postMessage").mockImplementation(((m: unknown) => { sent.push(m); }) as never);
    const got: PluginReply[] = [];
    sb.start("w1", { width: 1, height: 1, duration: 0, params: {}, files: {}, libs: [], entry: "r.js" }, (r) => got.push(r));
    expect(sent).toEqual([]); // queued until the page says ready
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ready" }, source: win }));
    expect(sent).toMatchObject([{ type: "start", wid: "w1" }]);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "frame", seq: 1, wid: "w1" }, source: win }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "frame", seq: 2, wid: "w1" }, source: window })); // not from the iframe
    window.dispatchEvent(new MessageEvent("message", { data: { type: "frame", seq: 3, wid: "other" }, source: win }));
    expect(got.map((r) => r.seq)).toEqual([1]);
    sb.kill("w1");
    expect(sent.at(-1)).toEqual({ type: "kill", wid: "w1" });
    sb.dispose();
    expect(sb.iframe.isConnected).toBe(false);
  });
});

describe("P85 worker script (determinism shim and contract)", () => {
  it("draws from t and params only: virtual clock, seeded Math.random reset per frame, rAF from t", async () => {
    const w = workerVm();
    await w.send(initMsg(`let initRand;
      dionysus.clip({
        init(ctx) { initRand = Math.random(); },
        render(t, ctx) {
          let raf = -1; requestAnimationFrame((ts) => { raf = ts; });
          const g = ctx.canvas.getContext("2d");
          g.note(t, ctx.progress, ctx.params.k, Math.random(), ctx.random(), Date.now(), performance.now(), new Date().getTime(), initRand, typeof ctx.asset("render.js"), ctx.asset("nope"));
        },
      });`));
    expect(w.posted).toEqual([{ type: "ready" }]);
    for (const [seq, t] of [[1, 1], [2, 0.5], [3, 1]] as const) await w.send({ type: "frame", seq, t, duration: 2, params: { k: seq } });
    const frames = w.posted.slice(1) as { seq: number; bmp: FakeBitmap }[];
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3]);
    const parts = frames.map((f) => f.bmp.data.replace(/^note\(|\)$/g, "").split(","));
    expect(parts[0][0]).toBe("1"); expect(parts[0][1]).toBe("0.5"); expect(parts[0][2]).toBe("1");
    expect(parts[0][5]).toBe(String(1767225600000 + 1000)); // Date.now follows t (1 s)
    expect(parts[0][6]).toBe("1000"); // performance.now in ms of t
    expect(parts[0][7]).toBe(parts[0][5]);
    expect(parts[0][9]).toBe("string"); expect(parts[0][10]).toBe("");
    // same t → same randoms in any order; another t sees the same sequence too (seed reset per frame)
    expect(parts[2].slice(3, 5)).toEqual(parts[0].slice(3, 5));
    expect(parts[1].slice(3, 5)).toEqual(parts[0].slice(3, 5));
    expect(parts[0][3]).not.toBe(parts[0][4]);
    expect(frames[0].bmp.width).toBe(64);
  });

  it("loads pinned library text before the entry and reports init and frame errors", async () => {
    const w = workerVm();
    await w.send(initMsg(`dionysus.clip({ render(t, ctx) { ctx.canvas.getContext("2d").lib(THREE.REVISION); } });`, { libs: [`self.THREE = { REVISION: "160" };`] }));
    await w.send({ type: "frame", seq: 1, t: 0 });
    expect((w.posted[1] as { bmp: FakeBitmap }).bmp.data).toBe("lib(160)");

    const noClip = workerVm();
    await noClip.send(initMsg(`// forgot to register`));
    expect(noClip.posted).toEqual([{ type: "error", message: "The render script didn't call dionysus.clip({ render })." }]);
    await noClip.send({ type: "frame", seq: 1, t: 0 });
    expect(noClip.posted).toHaveLength(1); // frames before a successful init are ignored

    const missing = workerVm();
    await missing.send(initMsg("", { entry: "other.js" }));
    expect(missing.posted[0]).toEqual({ type: "error", message: 'The render entry "other.js" is missing.' });

    const throwsInit = workerVm();
    await throwsInit.send(initMsg(`dionysus.clip({ async init() { throw new Error("no font"); }, render() {} });`));
    expect(throwsInit.posted[0]).toEqual({ type: "error", message: "no font" });

    const throwsFrame = workerVm();
    await throwsFrame.send(initMsg(`dionysus.clip({ render(t) { if (t > 0) throw new Error("bad t"); } });`));
    await throwsFrame.send({ type: "frame", seq: 1, t: 1 });
    await throwsFrame.send({ type: "frame", seq: 2, t: 0 });
    expect(throwsFrame.posted.slice(1).map((m) => [m.seq, m.error ?? "ok"])).toEqual([[1, "bad t"], [2, "ok"]]);

    const twice = workerVm();
    await twice.send(initMsg(`dionysus.clip({ render() {} }); dionysus.clip({ render() {} });`));
    expect(twice.posted[0]).toEqual({ type: "error", message: "dionysus.clip() was called twice." });
  });

  it("builds the init from the registered plugin: files with types, entry, libraries", async () => {
    // the three.js sample validates cleanly (libs: three) and lists exactly its files
    const parsed = parsePluginManifest(readFileSync(resolve(SAMPLES, "x-dionysus-orbit/manifest.json"), "utf8"), { libs: ["three", "three-gltf"] });
    expect(parsed.issues).toEqual([]);
    const m = parsed.manifest!;
    expect(checkPluginFiles(m, ["render.js"])).toEqual([]);
    const files = new Map([["render.js", enc.encode("x")]]);
    const core = pluginCoreOf(m, { hash: "sha256-ab" }, files);
    const asked: string[][] = [];
    const init = await pluginInitFor(core.plugin!, 320, 180, { a: 1 }, 6, async (ids) => { asked.push([...ids]); return ["LIB"]; });
    expect(init).toEqual({ width: 320, height: 180, duration: 6, params: { a: 1 }, files: { "render.js": { bytes: files.get("render.js"), type: "text/javascript" } }, libs: ["LIB"], entry: "render.js" });
    expect(asked).toEqual([["three"]]);
    expect([pluginFileType("a/b.WOFF2"), pluginFileType("m.glb"), pluginFileType("x")]).toEqual(["font/woff2", "model/gltf-binary", "application/octet-stream"]);
  });
});

describe("P85 watchdog (PluginClipHost)", () => {
  const OrigBitmap = (globalThis as { ImageBitmap?: unknown }).ImageBitmap;
  beforeEach(() => { vi.useFakeTimers(); (globalThis as { ImageBitmap?: unknown }).ImageBitmap = FakeBitmap; });
  afterEach(() => { vi.useRealTimers(); (globalThis as { ImageBitmap?: unknown }).ImageBitmap = OrigBitmap; });

  function rig() {
    const log: string[] = [];
    const replies = new Map<string, (r: PluginReply) => void>();
    let started = 0;
    const channel: PluginChannel = {
      start: (wid, init, on) => { started += 1; log.push(`start ${init.width}x${init.height} ${JSON.stringify(init.params)}`); replies.set(wid, on); },
      frame: (_wid, m) => { log.push(`frame ${m.seq} t=${m.t} ${JSON.stringify(m.params)}`); },
      kill: () => { log.push("kill"); },
    };
    const draws = vi.fn();
    const host = new PluginClipHost(channel, async (params, duration) => ({ width: 64, height: 36, duration, params, files: {}, libs: [], entry: "r.js" }), draws);
    const reply = (r: PluginReply) => { for (const f of replies.values()) f(r); };
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    return { host, log, reply, flush, draws, started: () => started };
  }
  const bmp = () => new FakeBitmap(64, 36, "");

  it("starts lazily, waits for ready, coalesces requests and redraws on new params", async () => {
    const { host, log, reply, flush, draws } = rig();
    expect(log).toEqual([]);
    host.request(1, 2, { a: 1 });
    await flush();
    expect(log).toEqual(['start 64x36 {"a":1}']);
    expect(host.settled()).toBe(false);
    reply({ type: "ready" });
    expect(log.at(-1)).toBe('frame 1 t=1 {"a":1}');
    host.request(1.5, 2, { a: 1 }); host.request(1.6, 2, { a: 1 });
    expect(log).toHaveLength(2); // one frame in flight at a time
    const b1 = bmp();
    reply({ type: "frame", seq: 1, bmp: b1 });
    expect(host.frame).toBe(b1);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toBe('frame 2 t=1.6 {"a":1}'); // only the latest pending request
    reply({ type: "frame", seq: 2, bmp: bmp() });
    expect(b1.closed).toBe(true);
    expect(host.settled()).toBe(true);
    host.request(1.6, 2, { a: 1 });
    expect(log).toHaveLength(3); // same t, same params: nothing to draw
    host.request(1.6, 2, { a: 2 });
    expect(log.at(-1)).toBe('frame 3 t=1.6 {"a":2}');
    // a stale or foreign reply is ignored (and its bitmap closed)
    const stale = bmp();
    reply({ type: "frame", seq: 99, bmp: stale });
    expect(stale.closed).toBe(true);
    reply({ type: "frame", seq: 3, error: "boom" });
    expect(host.issue).toBe("invalid");
    expect(host.errors).toEqual(["boom"]);
    host.dispose();
    expect(log.at(-1)).toBe("kill");
  });

  it("restarts the worker after two frame timeouts in a row, and stops after three restarts", async () => {
    const { host, log, reply, flush, started, draws } = rig();
    host.request(0, 1, {});
    await flush();
    reply({ type: "ready" });
    const settled = host.settle(10 * 60_000);
    let result: unknown = "pending";
    void settled.then((r) => { result = r; });
    for (let round = 1; round <= 4; round++) {
      await vi.advanceTimersByTimeAsync(PLUGIN_TIME_LIMITS.frameMs); // first timeout: the same frame is asked again
      expect(host.stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(PLUGIN_TIME_LIMITS.frameMs); // second: kill and restart (or stop)
      await flush();
      if (round <= 3) { expect(started()).toBe(round + 1); reply({ type: "ready" }); }
    }
    expect(host.stopped).toBe(true);
    expect(host.issue).toBe("stopped");
    expect(host.restarts).toBe(3);
    expect(log.filter((l) => l === "kill")).toHaveLength(4);
    expect(host.settled()).toBe(true);
    await flush();
    expect(result).toBe("stopped");
    expect(draws).toHaveBeenCalled(); // the preview redraws to show "Plugin stopped"
    const n = log.length;
    host.request(0.5, 1, {});
    expect(log).toHaveLength(n); // a stopped plugin gets no more work
    expect(host.errors.at(-1)).toMatch(/longer than 4 s twice/);
  });

  it("a slow frame that answers after one timeout keeps the worker", async () => {
    const { host, log, reply, flush, started } = rig();
    host.request(0, 1, {});
    await flush();
    reply({ type: "ready" });
    await vi.advanceTimersByTimeAsync(PLUGIN_TIME_LIMITS.frameMs);
    expect(log.at(-1)).toBe("frame 2 t=0 {}");
    reply({ type: "frame", seq: 1, bmp: bmp() }); // the late answer to the abandoned request is stale
    reply({ type: "frame", seq: 2, bmp: bmp() });
    expect(host.settled()).toBe(true);
    await vi.advanceTimersByTimeAsync(PLUGIN_TIME_LIMITS.frameMs * 3);
    expect(started()).toBe(1);
    expect(host.restarts).toBe(0);
  });

  it("restarts on an init timeout, an init error or a crash; replies of an old worker are ignored", async () => {
    const { host, reply, flush, started } = rig();
    host.request(0, 1, {});
    await flush();
    await vi.advanceTimersByTimeAsync(PLUGIN_TIME_LIMITS.initMs);
    await flush();
    expect(started()).toBe(2);
    expect(host.errors.at(-1)).toMatch(/didn't finish starting within 15 s/);
    reply({ type: "error", message: "no font" });
    await flush();
    expect(started()).toBe(3);
    reply({ type: "ready" });
    reply({ type: "crash", message: "worker died" });
    await flush();
    expect(started()).toBe(4);
    expect(host.restarts).toBe(3);
    reply({ type: "crash", message: "again" });
    expect(host.stopped).toBe(true);
    expect(host.errors.slice(-3)).toEqual(["no font", "worker died", "again"]);
  });

  it("a failing init builder (library not available) counts as a failed start", async () => {
    const channel: PluginChannel = { start: vi.fn(), frame: vi.fn(), kill: vi.fn() };
    const host = new PluginClipHost(channel, async () => { throw new Error("The library three.js doesn't match its pinned hash."); }, () => undefined, { initMs: 1000, frameMs: 100, restarts: 1 });
    host.request(0, 1, {});
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(host.stopped).toBe(true);
    expect(channel.start).not.toHaveBeenCalled();
    expect(host.errors).toEqual(["The library three.js doesn't match its pinned hash.", "The library three.js doesn't match its pinned hash."]);
  });
});
