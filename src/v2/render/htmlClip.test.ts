// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { HTML_RUNTIME, HTML_SANDBOX, HtmlClipHost, THREE_TEMPLATE, withRuntime } from "./htmlClip";
import { mediaKindOf } from "../persistence/media";
import { audioPlan } from "./export/plan";
import { createProject } from "../domain";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("html clips", () => {
  it("injects the frame runtime after the doctype and before page scripts", () => {
    const out = withRuntime("<!DOCTYPE html><html><script>x()</script></html>");
    expect(out.startsWith("<!DOCTYPE html>" + HTML_RUNTIME)).toBe(true);
    expect(withRuntime("<p>hi</p>")).toBe(HTML_RUNTIME + "<p>hi</p>");
    expect(THREE_TEMPLATE).toContain("dionysus.onFrame");
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
});
