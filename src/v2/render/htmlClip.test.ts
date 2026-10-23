// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { clipCsp, HTML_RUNTIME_JS, HTML_SANDBOX, HtmlClipHost, isValidFrame, THREE_TEMPLATE, withRuntime } from "./htmlClip";
import { HTML_LIBRARIES, readClipConfig, vendorUrl, writeClipConfig } from "./htmlLibs";
import { frameWarnings } from "./export/encode";
import { mediaKindOf } from "../persistence/media";
import { audioPlan } from "./export/plan";
import { createProject } from "../domain";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("html clips", () => {
  it("builds import map + CSP only from the selected libraries, after the doctype", () => {
    const url = (l: { path: string }) => `https://x.test/app/${l.path}`;
    const three = HTML_LIBRARIES[0];
    const out = withRuntime('<!DOCTYPE html><html><script type="module">import * as T from "three"</script></html>', url);
    expect(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(out.indexOf("dionysus:ready")).toBeLessThan(out.indexOf("<html>"));
    expect(out).toContain(`"integrity":{"${url(three)}":"${three.integrity}"}`);
    // no library imported → no import map, no remote script origin at all
    const plain = withRuntime("<canvas></canvas><script>requestAnimationFrame(()=>{})</script>", url);
    expect(plain).not.toContain("importmap");
    expect(plain).not.toMatch(/https?:\/\//);
    // explicit selection overrides detection
    expect(withRuntime(writeClipConfig('<html><head></head>import "three"</html>', { libs: [] }), url)).not.toContain("importmap");
    const csp = clipCsp([url(three)]);
    expect(csp).toMatch(/^default-src 'none'/);
    expect(csp).toContain(`script-src 'unsafe-inline' blob: data: ${url(three)}`);
    expect(clipCsp()).not.toMatch(/https?:/);
    expect(withRuntime('import * as T from "https://unpkg.com/three@0.160.0/build/three.module.js"', url)).toContain('from "three"');
    expect(THREE_TEMPLATE).not.toContain("unpkg");
    expect(vendorUrl("vendor/x.js", "/dionysus-ai-video-editor/", "https://h.io/dionysus-ai-video-editor/?v2")).toBe("https://h.io/dionysus-ai-video-editor/vendor/x.js");
  });

  it("every registry library matches its pinned integrity hash", () => {
    for (const l of HTML_LIBRARIES) {
      const buf = readFileSync(resolve(__dirname, "../../../public", l.path));
      expect(`sha384-${createHash("sha384").update(buf).digest("base64")}`).toBe(l.integrity);
    }
  });

  it("only the registry mentions a specific library", () => {
    const src = readFileSync(resolve(__dirname, "htmlClip.ts"), "utf8").split("/** Starter clip")[0];
    expect(src.toLowerCase()).not.toContain("three");
  });

  it("clip config round-trips; attachments inline into CSS url() and the runtime", () => {
    const html = writeClipConfig("<html><head></head><body><style>i{background:url(./a.png)}</style></body></html>", { libs: ["three"], assets: { "a.png": "data:image/png;base64,AAAA" } });
    expect(readClipConfig(html)).toEqual({ libs: ["three"], assets: { "a.png": "data:image/png;base64,AAAA" } });
    expect(readClipConfig(writeClipConfig(html, {}))).toEqual({});
    const out = withRuntime(html, () => "https://x.test/t.js");
    expect(out).toContain('url("data:image/png;base64,AAAA")');
    expect(out).toContain('const ASSETS={"a.png":');
  });

  it("virtual-time shim: rAF, performance.now and Date.now follow t; Math.random is seeded", () => {
    const run = () => {
      const w: Record<string, unknown> = {};
      const perf = { now: () => 0 };
      const msgs: unknown[] = [];
      let listener: ((e: unknown) => void) | undefined;
      const parent = { postMessage: (m: unknown) => msgs.push(m) };
      class MO { observe() {} }
      class XHR {} (XHR.prototype as unknown as { open: () => void }).open = () => {};
      const M = Object.create(Math) as Math;
      const fn = new Function("window", "performance", "Date", "Math", "addEventListener", "parent", "document", "MutationObserver", "XMLHttpRequest", "URL", "Blob", "atob", "createImageBitmap",
        `const ASSETS={};${HTML_RUNTIME_JS}; return {Date: window.Date};`);
      w.fetch = () => {};
      const r = fn(w, perf, Date, M, (ev: string, f: (e: unknown) => void) => { if (ev === "message") listener = f; }, parent, { querySelector: () => null }, MO, XHR, URL, Blob, atob, undefined);
      return { w, perf, M, msgs, parent, send: (t: number) => listener!({ data: { type: "dionysus:frame", seq: 1, t }, source: parent }), D: r.Date as DateConstructor };
    };
    const a = run();
    const seen: number[] = [];
    const loop = (ts: number) => { seen.push(ts); (a.w.requestAnimationFrame as (f: (n: number) => void) => void)(loop); };
    (a.w.requestAnimationFrame as (f: (n: number) => void) => void)(loop);
    a.send(1.5);
    expect(seen).toEqual([1500]);
    expect(a.perf.now()).toBe(1500);
    expect(a.D.now() - new a.D().getTime()).toBe(0);
    a.send(2);
    expect(seen).toEqual([1500, 2000]);
    const b = run();
    expect([a.M.random(), a.M.random()]).toEqual([b.M.random(), b.M.random()]);
  });

  it("recognises .html files and keeps them out of the audio mix", () => {
    expect(mediaKindOf({ type: "text/html", name: "a" })).toBe("html");
    expect(mediaKindOf({ type: "", name: "scene.HTM" })).toBe("html");
    const p = createProject();
    p.assets.h = { id: "h", kind: "html", name: "s.html", versions: [{ id: "1", createdAt: "", media: { blobKey: "k", mime: "text/html" }, provenance: { source: "import", inputs: [] } }] };
    p.compositions[p.rootCompositionId].tracks[0].placements.push({ id: "x", startTicks: 0, durationTicks: 120000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "h", versionId: "1" }, clipType: "html" });
    expect(audioPlan(p)).toEqual([]);
  });

  it("runs sandboxed (scripts only, no same-origin) and requests only the latest frame", async () => {
    const onFrame = vi.fn();
    const host = new HtmlClipHost(Promise.resolve("<canvas></canvas>"), 640, 360, onFrame);
    await tick();
    expect(host.iframe.getAttribute("sandbox")).toBe(HTML_SANDBOX);
    expect(HTML_SANDBOX).not.toContain("same-origin");
    expect(host.iframe.srcdoc).toContain("dionysus:frame");
    const win = host.iframe.contentWindow!;
    const sent: { seq: number; t: number }[] = [];
    vi.spyOn(win, "postMessage").mockImplementation(((m: { seq: number; t: number }) => { sent.push(m); }) as never);
    const reply = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: win }));
    host.request(1); // not ready yet: nothing sent
    expect(sent).toHaveLength(0);
    reply({ type: "dionysus:ready" });
    expect(sent.map((m) => m.t)).toEqual([1]);
    host.request(2); host.request(3); // coalesced while frame 1 is in flight
    expect(sent).toHaveLength(1);
    expect(host.settled()).toBe(false);
    const done = host.settle(1000);
    reply({ type: "dionysus:frame", seq: sent[0].seq, bmp: null });
    expect(sent.map((m) => m.t)).toEqual([1, 3]);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "dionysus:frame", seq: sent[1].seq, bmp: null }, source: null })); // foreign: ignored
    expect(host.settled()).toBe(false);
    reply({ type: "dionysus:frame", seq: sent[1].seq, bmp: null });
    await done;
    expect(host.settled()).toBe(true);
    expect(onFrame).toHaveBeenCalledTimes(2);
    host.dispose();
    expect(host.iframe.isConnected).toBe(false);
  });

  it("rejects hostile frames and reports timeouts instead of hanging", async () => {
    class FakeBitmap { constructor(public width: number, public height: number) {} close = vi.fn(); }
    vi.stubGlobal("ImageBitmap", FakeBitmap);
    try {
      expect(isValidFrame(new FakeBitmap(640, 360))).toBe(true);
      for (const bad of [{ width: 10, height: 10 }, new FakeBitmap(0, 10), new FakeBitmap(1e6, 10), new FakeBitmap(NaN, 2), "x", null]) expect(isValidFrame(bad)).toBe(false);
      const host = new HtmlClipHost(Promise.resolve(""), 64, 64, () => undefined);
      await tick();
      const win = host.iframe.contentWindow!;
      const sent: { seq: number }[] = [];
      vi.spyOn(win, "postMessage").mockImplementation(((m: { seq: number }) => { sent.push(m); }) as never);
      const reply = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: win }));
      reply({ type: "dionysus:ready" });
      host.request(0);
      const good = new FakeBitmap(64, 64);
      reply({ type: "dionysus:frame", seq: sent[0].seq, bmp: good });
      expect(host.frame).toBe(good);
      host.request(1);
      const huge = new FakeBitmap(99999, 99999);
      reply({ type: "dionysus:frame", seq: sent[1].seq, bmp: huge });
      expect(host.frame).toBe(good); // previous good frame kept
      expect(huge.close).toHaveBeenCalled();
      expect(await host.settle(10)).toBe("invalid");
      host.request(2); // page never answers
      expect(await host.settle(10)).toBe("timeout");
      host.dispose();
    } finally { vi.unstubAllGlobals(); }
  });

  it("summarises frame issues per clip for the export dialog", () => {
    const p = createProject();
    p.assets.h = { id: "h", kind: "html", name: "scene.html", versions: [] };
    p.compositions[p.rootCompositionId].tracks[0].placements.push({ id: "x", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "h", versionId: "1" }, clipType: "html" });
    const w = frameWarnings(p, [{ placementId: "x", t: 240000, issue: "timeout" }, { placementId: "x", t: 120000, issue: "timeout" }, { placementId: "x", t: 360000, issue: "invalid" }]);
    expect(w).toEqual(["scene.html: 2 frames timed out (4 s), 1 invalid frame, first at 1.00 s. Those frames reuse the last good image (or are blank)."]);
    expect(frameWarnings(p, [])).toEqual([]);
  });
});
