/** V2-HTML-PKG: the dionysus.htmlclip/1 manifest, validation, AI-reply extraction, package prompts and bindings. */
import { describe, expect, it } from "vitest";
import { createProject, type Project } from "./model";
import * as board from "./storyboard";
import { validateStoryboard, type StoryDoc } from "./storyJson";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import {
  extractHtml, HTML_CLIP_CONTRACT, HTML_CLIP_FORMAT, htmlClipPackagePrompt, htmlClipTemplate, lintHtmlClip, readManifest, sizeForAspect, validateManifest,
  writeManifest, type ClipLibrary,
} from "./htmlClipPackage";
import { bindingSignature, resolveClipBindings, slotBindings, slotDurationSec, slotPackageInput } from "./htmlClipBindings";

const LIBS: ClipLibrary[] = [{ id: "three", name: "three.js", version: "0.160.0", specifier: "three", legacy: /unpkg\.com\/three@[^"']*\/build\/three\.module\.js/ }];
const codes = (html: string, opts = {}) => lintHtmlClip(html, { libs: LIBS, ...opts }).issues.map((i) => `${i.level}:${i.code}`);
const SPEC = "https://video.example.com/ai/HTML_CLIP_PACKAGE.md";

describe("manifest", () => {
  it("writes the manifest as the first thing in <head> and reads it back; replaces an existing one", () => {
    const html = "<!doctype html><html><head><title>x</title></head><body><canvas></canvas></body></html>";
    const out = writeManifest(html, { format: HTML_CLIP_FORMAT, name: "A", durationSec: 3 });
    expect(out).toMatch(/<head><script type="application\/json" id="dionysus-clip">\{/);
    expect(readManifest(out)).toMatchObject({ format: HTML_CLIP_FORMAT, name: "A", durationSec: 3 });
    const again = writeManifest(out, { format: HTML_CLIP_FORMAT, name: "B" });
    expect(again.match(/id="dionysus-clip"/g)).toHaveLength(1);
    expect(readManifest(again).name).toBe("B");
  });

  it("validates every field with a code and a readable message", () => {
    const v = (m: unknown) => validateManifest(m, LIBS).map((i) => i.code);
    expect(v({ format: HTML_CLIP_FORMAT, durationSec: 4, width: 1920, height: 1080, libs: ["three"] })).toEqual([]);
    expect(v([])).toEqual(["manifest-json"]);
    expect(v({ format: "other/2" })).toContain("format");
    expect(v({ format: HTML_CLIP_FORMAT, durationSec: -1, width: 3.5 })).toEqual(expect.arrayContaining(["duration", "size"]));
    expect(v({ format: HTML_CLIP_FORMAT, libs: ["jquery"] })).toContain("lib-unknown");
    expect(v({ format: HTML_CLIP_FORMAT, bindings: { "1x": { type: "image" }, ok: { type: "pdf" } } })).toEqual(expect.arrayContaining(["binding-name", "binding-type"]));
    expect(v({ format: HTML_CLIP_FORMAT, params: { n: { type: "number", default: "x" }, s: { type: "select", default: "c", options: ["a", "b"] } } })).toEqual(["param-default", "param-default"]);
    expect(v({ format: HTML_CLIP_FORMAT, files: { "a.png": "http://x/a.png" } })).toContain("file");
  });

  it("sizes from the aspect", () => {
    expect(sizeForAspect("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(sizeForAspect(undefined)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("lintHtmlClip", () => {
  it("accepts the template and keeps a legacy clip importable with warnings only", () => {
    expect(codes(htmlClipTemplate()).filter((c) => c.startsWith("error"))).toEqual([]);
    expect(lintHtmlClip(htmlClipTemplate(), { libs: LIBS }).legacy).toBe(false);
    const legacy = '<html><body><canvas></canvas><script>function f(){requestAnimationFrame(f)}f()</script></body></html>';
    const r = lintHtmlClip(legacy, { libs: LIBS });
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(true);
    expect(codes(legacy)).toEqual(expect.arrayContaining(["warning:manifest-missing", "warning:render-legacy"]));
    // A static legacy page that draws once still imports (it just won't animate).
    expect(lintHtmlClip("<html></html>", { libs: LIBS }).ok).toBe(true);
    expect(codes("<html></html>")).toContain("warning:render-missing");
  });

  it("blocks network access, unknown or undeclared libraries and a broken manifest", () => {
    const page = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body><canvas></canvas>${body}<script>dionysus.clip({render(){}})</script></body></html>`;
    expect(codes(page('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'))).toContain("error:network");
    expect(codes(page("", '<img src="//cdn.example.com/a.png">'))).toContain("error:network");
    expect(codes(page("", '<script type="module">import x from "lodash"</script>'))).toContain("error:lib-unknown");
    const m = `<script type="application/json" id="dionysus-clip">{"format":"${HTML_CLIP_FORMAT}","libs":[]}</script>`;
    expect(codes(page(m, '<script type="module">import * as T from "three"</script>'))).toContain("error:lib-undeclared");
    expect(codes(page('<script type="application/json" id="dionysus-clip">{oops</script>'))).toContain("error:manifest-json");
    expect(codes(page(""), {})).not.toContain("error:network");
    expect(codes("")).toEqual(["error:empty"]);
    expect(lintHtmlClip("just some words", { libs: LIBS }).ok).toBe(false);
  });

  it("maps a legacy CDN copy of a registry library to a warning and flags non-determinism", () => {
    const html = `<html><body><canvas></canvas><script type="module">import * as T from "https://unpkg.com/three@0.150.0/build/three.module.js"; dionysus.clip({render(t){ Math.random(); }})</script></body></html>`;
    const c = codes(html);
    expect(c).toContain("warning:lib-cdn");
    expect(c).not.toContain("error:network");
    expect(c).toContain("warning:nondeterministic");
  });

  it("checks the storyboard's expected bindings", () => {
    const m = `<script type="application/json" id="dionysus-clip">{"format":"${HTML_CLIP_FORMAT}","bindings":{"logo":{"type":"video"},"extra":{"type":"image"}}}</script>`;
    const html = `<html><head>${m}</head><body><canvas></canvas><script>dionysus.clip({render(t,ctx){ctx.bindings["logo"]}})</script></body></html>`;
    const c = codes(html, { expectBindings: { logo: "image", photo: "image" } });
    expect(c).toEqual(expect.arrayContaining(["warning:binding-mismatch", "warning:binding-missing", "warning:binding-unused"]));
    expect(c.every((x) => x.startsWith("warning"))).toBe(true);
  });
});

describe("extractHtml", () => {
  it("takes the largest ```html block of an AI reply, or the document itself", () => {
    const doc = htmlClipTemplate();
    expect(extractHtml(`Here you go:\n\n\`\`\`html\n${doc}\`\`\`\n\nEnjoy!`)?.trim()).toBe(doc.trim());
    expect(extractHtml("```html\n<p>small</p>\n```\n```html\n" + doc + "```")?.trim()).toBe(doc.trim());
    expect(extractHtml(doc)?.trim()).toBe(doc.trim());
    expect(extractHtml("Sorry, I can't do that.")).toBeUndefined();
  });
});

describe("package prompts", () => {
  const input = { brief: "A warm sunrise title, letters rise one by one.", name: "First Light title", id: "title", durationSec: 5, aspect: "16:9", bindings: [{ name: "logo", type: "image" as const, label: "Logo" }] };

  it("the short prompt combines the brief with the filled-in package block and links the spec", () => {
    const p = htmlClipPackagePrompt(input, { libs: LIBS, specUrl: SPEC });
    expect(p).toContain("DESIGN BRIEF\nA warm sunrise title");
    expect(p).toContain(`- Spec: ${SPEC}\n`);
    const m = JSON.parse(p.match(/id="dionysus-clip">(.*?)<\/script>/)![1]);
    expect(m).toMatchObject({ format: HTML_CLIP_FORMAT, name: "First Light title", durationSec: 5, width: 1920, height: 1080, bindings: { logo: { type: "image", asset: "logo" } } });
    expect(p).toContain('"three" (three.js 0.160.0, import from "three")');
    expect(p).toContain("Reply with ONE ```html code block");
    expect(p).toContain("Copy full prompt");
    expect(p).not.toContain(HTML_CLIP_CONTRACT);
    expect(p).not.toMatch(/github\.(io|com)/);
  });

  it("the full prompt inlines the contract and a template filled with the asset's manifest that lints clean", () => {
    const p = htmlClipPackagePrompt(input, { libs: LIBS, specUrl: SPEC, full: true });
    expect(p).toContain(HTML_CLIP_CONTRACT);
    expect(p).not.toContain(SPEC);
    const tpl = p.match(/```html\n([\s\S]*?)```/)![1];
    const r = lintHtmlClip(tpl, { libs: LIBS, expectBindings: { logo: "image" } });
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.manifest).toMatchObject({ name: "First Light title", durationSec: 5 });
  });
});

describe("storyboard bindings (LANTERN_KEEPER + an html title)", () => {
  const raw = JSON.parse(JSON.stringify(LANTERN_KEEPER)) as StoryDoc & { assets: unknown[] };
  raw.assets.push({ id: "beam-title", name: "Beam title", type: "html", aspect: "16:9", prompt: "The title draws itself along the lighthouse beam.", references: ["lantern", "cliff", "keeper"], source: "generate", qa: ["Title readable"] });
  const s3 = raw.shots.find((s) => s.id === "s3")!;
  s3.layers = [...(s3.layers ?? []), { id: "s3-beam", type: "html", asset: "beam-title", startSec: 0.5, endSec: 4, box: { x: 0, y: 0, width: 1, height: 1 } }];
  const r = validateStoryboard(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const sb = board.storyboardFromDoc(r.doc);
  const slot = sb.slots["beam-title"];

  it("expects the referenced media as bindings, and takes the length from where it plays", () => {
    expect(slotBindings(sb, slot)).toEqual([
      { name: "lantern", type: "image", label: "Brass lantern" },
      { name: "cliff", type: "image", label: "Cliff and lighthouse" },
      { name: "keeper", type: "image", label: "The keeper" },
    ]);
    expect(slotDurationSec(sb, "beam-title")).toBe(3.5);
    const input = slotPackageInput(sb, slot);
    expect(input).toMatchObject({ brief: slot.prompt, durationSec: 3.5, aspect: "16:9", background: "transparent" });
    expect(input.context).toContain('Shot "s3"');
    expect(input.context).toContain("an overlay layer");
  });

  it("resolves bindings to the selected version of the slot's asset and changes the signature with it", () => {
    let p: Project = board.setStoryboard(createProject("t"), sb);
    const img = { blobKey: "k1", mime: "image/png", width: 16, height: 16 };
    p = board.addStoryVersion(p, { slot: "lantern" }, img, { versionId: "v1", now: "2026-10-24T00:00:00Z" });
    const m = { format: HTML_CLIP_FORMAT, bindings: { lantern: { type: "image" as const }, glow: { type: "image" as const, asset: "missing" } } };
    const b1 = resolveClipBindings(p, m);
    expect(b1).toMatchObject([{ name: "lantern", type: "image", versionId: "v1", blobKey: "k1" }]);
    p = board.addStoryVersion(p, { slot: "lantern" }, { ...img, blobKey: "k2" }, { versionId: "v2", now: "2026-10-24T00:00:00Z" });
    const b2 = resolveClipBindings(p, m);
    expect(bindingSignature(b2)).not.toBe(bindingSignature(b1));
  });
});
