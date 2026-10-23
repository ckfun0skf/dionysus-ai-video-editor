// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { joinHtml, splitHtml } from "./htmlSource";
import { THREE_TEMPLATE } from "../render/htmlClip";
import { Engine, cmd } from "../engine";
import { createProject, type Asset } from "../domain/model";

describe("HTML editor source", () => {
  it("splits into HTML/CSS/JS and joins back", () => {
    const p = splitHtml(THREE_TEMPLATE);
    expect(p.css).toContain("canvas{display:block}");
    expect(p.js).toContain("dionysus.onFrame");
    expect(p.html).toContain('<canvas id="c">');
    expect(p.module).toBe(true);
    const again = splitHtml(joinHtml(p));
    expect(again).toEqual(p);
  });
  it("saving adds a version and repoints the clip in one undo step", () => {
    const v = { id: "v1", createdAt: "", media: { blobKey: "a/v1", mime: "text/html", width: 1280, height: 720 }, provenance: { source: "import" as const, inputs: [] } };
    const asset = { id: "a", kind: "html", name: "x.html", selectedVersionId: "v1", versions: [v] } as unknown as Asset;
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.importAsset(asset));
    e.dispatch(cmd.addAssetToTimeline("a", 0, undefined, "p"));
    e.dispatch(cmd.addAssetVersion("a", { ...v, id: "v2", media: { ...v.media, blobKey: "a/v2" } }, "p"));
    const pr = () => e.getState().project;
    const src = () => pr().compositions[pr().rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === "p")!.source.versionId;
    expect(src()).toBe("v2");
    expect(pr().assets.a.selectedVersionId).toBe("v2");
    e.undo();
    expect(src()).toBe("v1");
  });
});

describe("clip config in the editor", () => {
  it("keeps the config script out of the JS pane", async () => {
    const { writeClipConfig } = await import("../render");
    const src = writeClipConfig("<!doctype html><html><head></head><body><script>go()</script></body></html>", { libs: [], assets: { "a.png": "data:," } });
    expect(splitHtml(src).js).toBe("go()");
  });
});
