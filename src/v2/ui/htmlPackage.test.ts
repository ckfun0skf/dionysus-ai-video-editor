// @vitest-environment jsdom
/** V2-HTML-PKG: single-file ⇄ portable ZIP round trip, folder-zipped packages, and media-bin import of a ZIP. */
import { describe, expect, it } from "vitest";
import { createProject, HTML_CLIP_FORMAT, htmlClipTemplate, lintHtmlClip, readManifest, writeManifest } from "../domain";
import { BlobSink, createMemoryStorage, exportProjectArchive, importProjectArchive, readBlobBytes, readProjectArchive, readZipIndex, zipEntryBlob, ZipWriter } from "../persistence";
import { clipFileFrom, exportHtmlFile, exportHtmlZip, importHtmlPackage, importHtmlZip, packageBaseName, PackageError } from "./htmlPackage";

const dec = new TextDecoder();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const clip = writeManifest(`<!doctype html>
<html><head><meta charset="utf-8"><style>canvas{display:block}</style><style>body{margin:0}</style></head>
<body><canvas id="c"></canvas><script type="module">
const g = document.getElementById("c").getContext("2d");
dionysus.clip({ async init(ctx) { await ctx.image("dot.png"); }, render(t, ctx) { g.fillRect(0, 0, ctx.width * ctx.progress, 10); } });
</script></body></html>`, { format: HTML_CLIP_FORMAT, name: "First Light dot", durationSec: 3, width: 640, height: 360, params: { accent: { type: "color", default: "#ffb347" } }, files: { "dot.png": PNG } });

async function entries(zip: Blob): Promise<Record<string, string>> {
  const index = await readZipIndex(zip);
  const out: Record<string, string> = {};
  for (const [n, e] of index) out[n] = dec.decode(await readBlobBytes(await zipEntryBlob(zip, e)));
  return out;
}
async function zipOf(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const sink = new BlobSink();
  const z = new ZipWriter(sink);
  for (const [n, d] of Object.entries(files)) await z.addBytes(n, typeof d === "string" ? new TextEncoder().encode(d) : d);
  await z.finish();
  return sink.blob();
}
const norm = (html: string) => html.replace(/\s+/g, " ").trim();
const scriptOf = (html: string) => /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1].trim();

describe("HTML clip packages (V2-HTML-PKG)", () => {
  it("splits the single file into manifest.json, index.html, style.css, script.js and the embedded files", async () => {
    const files = await entries(await exportHtmlZip(clip));
    expect(Object.keys(files).sort()).toEqual(["dot.png", "index.html", "manifest.json", "script.js", "style.css"]);
    const m = JSON.parse(files["manifest.json"]);
    expect(m).toMatchObject({ format: HTML_CLIP_FORMAT, name: "First Light dot", durationSec: 3 });
    expect(m.files).toBeUndefined(); // embedded files are ordinary files in the ZIP
    expect(files["index.html"]).toContain('<link rel="stylesheet" href="style.css">');
    expect(files["index.html"]).toContain('<script type="module" src="script.js"></script>');
    expect(files["index.html"]).not.toContain("dionysus-clip");
    expect(files["style.css"]).toBe("canvas{display:block}\nbody{margin:0}\n");
    expect(files["script.js"]).toContain("dionysus.clip(");
  });

  it("round-trips: ZIP → single file keeps the manifest, code and embedded files, and still lints clean", async () => {
    const back = await importHtmlZip(await exportHtmlZip(clip));
    expect(readManifest(back)).toEqual(readManifest(clip));
    expect(scriptOf(back)).toBe(scriptOf(clip));
    expect(norm(back)).toContain("canvas{display:block}");
    const r = lintHtmlClip(back, { libs: [] });
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    // …and once more gives the same file (stable).
    expect(await importHtmlZip(await exportHtmlZip(back))).toBe(back);
  });

  it("reads a zipped folder, skips macOS junk, and reports a ZIP that isn't a clip", async () => {
    const z = await zipOf({
      "my-clip/index.html": '<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><canvas></canvas><script src="script.js"></script></body></html>',
      "my-clip/style.css": "body{margin:0}",
      "my-clip/script.js": "dionysus.clip({ render() {} });",
      "my-clip/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "__MACOSX/my-clip/._index.html": "junk",
    });
    const html = await importHtmlZip(z);
    expect(html).toContain("<style>body{margin:0}</style>");
    expect(html).toContain("<script>dionysus.clip({ render() {} });</script>");
    expect(Object.keys(readManifest(html).files ?? {})).toEqual(["logo.svg"]);
    expect(readManifest(html).files!["logo.svg"]).toMatch(/^data:image\/svg\+xml;base64,/);
    await expect(importHtmlZip(await zipOf({ "notes.txt": "hi" }))).rejects.toBeInstanceOf(PackageError);
    await expect(importHtmlZip(await zipOf({ "index.html": "<html></html>", "manifest.json": "{nope" }))).rejects.toThrow(/manifest\.json/);
  });

  it("imports .html as is, rejects other files, and exports the single file with a format", async () => {
    expect(await importHtmlPackage(new File([clip], "a.html", { type: "text/html" }))).toBe(clip);
    await expect(importHtmlPackage(new File(["x"], "a.pdf", { type: "application/pdf" }))).rejects.toThrow(/not an HTML clip/);
    const legacy = "<!doctype html><html><head></head><body><canvas></canvas></body></html>";
    const out = dec.decode(await readBlobBytes(exportHtmlFile(legacy)));
    expect(readManifest(out).format).toBe(HTML_CLIP_FORMAT);
    expect(packageBaseName(clip)).toBe("First-Light-dot");
    expect(packageBaseName(legacy, "Logo page")).toBe("Logo-page");
  });

  it("a ZIP dropped in the media bin becomes its single-file .html; other files pass through", async () => {
    const f = await clipFileFrom(new File([await exportHtmlZip(htmlClipTemplate())], "title.dionysus-html.zip", { type: "application/zip" }));
    expect(f.name).toBe("title.html");
    expect(f.type).toBe("text/html");
    expect(readManifest(dec.decode(await readBlobBytes(f))).name).toBe("Template");
    const png = new File(["x"], "a.png", { type: "image/png" });
    expect(await clipFileFrom(png)).toBe(png);
  });

  it("a project export (.dionysus.zip, #201) carries the clip's single file byte for byte", async () => {
    const src = createMemoryStorage();
    const p = createProject("Clips");
    p.assets = { h1: { id: "h1", kind: "html", name: "Dot", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "2026-10-24T00:00:00.000Z", media: { blobKey: "h1/v1", mime: "text/html", width: 640, height: 360 }, provenance: { source: "import", inputs: [] } }] } };
    await src.blobs.put("h1/v1", new Blob([clip], { type: "text/html" }));
    await src.projects.save(p);
    const sink = new BlobSink();
    await exportProjectArchive(p, src.blobs, sink);
    const dst = createMemoryStorage();
    const got = await importProjectArchive(dst, await readProjectArchive(sink.blob()), "new");
    const v = got.assets.h1.versions[0];
    expect(v.media.mime).toBe("text/html");
    expect(dec.decode(await readBlobBytes((await dst.blobs.get(v.media.blobKey))!))).toBe(clip);
  });
});
