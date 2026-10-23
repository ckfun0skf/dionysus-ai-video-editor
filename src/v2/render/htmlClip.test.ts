// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { clipCsp, HTML_RUNTIME, HTML_SANDBOX, HtmlClipHost, isValidFrame, THREE_INTEGRITY, THREE_PATH, THREE_TEMPLATE, threeUrl, withRuntime } from "./htmlClip";
import { frameWarnings } from "./export/encode";
import { mediaKindOf } from "../persistence/media";
import { audioPlan } from "./export/plan";
import { createProject } from "../domain";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("html clips", () => {
  it("injects CSP, pinned three.js import map and runtime after the doctype, before page content", () => {
    const three = "https://x.test/app/vendor/three.js";
    const out = withRuntime("<!DOCTYPE html><html><script>x()</script></html>", three);
    expect(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(out.indexOf(HTML_RUNTIME)).toBeLessThan(out.indexOf("<html>"));
    expect(out).toContain(`"integrity":{"${three}":"${THREE_INTEGRITY}"}`);
    const csp = clipCsp(three);
    expect(csp).toMatch(/^default-src 'none'/);
    expect(csp).toContain(`script-src 'unsafe-inline' blob: data: ${three}`);
    expect(csp).not.toMatch(/https?:\/\/(?!x\.test\/app\/vendor\/three\.js)/);
    expect(withRuntime('import * as T from "https://unpkg.com/three@0.160.0/build/three.module.js"', three)).toContain('from "three"');
    expect(THREE_TEMPLATE).toContain('from "three"');
    expect(THREE_TEMPLATE).not.toContain("unpkg");
    expect(threeUrl("/dionysus-ai-video-editor/", "https://h.io/dionysus-ai-video-editor/?v2")).toBe(`https://h.io/dionysus-ai-video-editor/${THREE_PATH}`);
  });

  it("vendored three.js matches its pinned integrity hash", () => {
    const buf = readFileSync(resolve(__dirname, "../../../public", THREE_PATH));
    expect(`sha384-${createHash("sha384").update(buf).digest("base64")}`).toBe(THREE_INTEGRITY);
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
