import { describe, expect, it } from "vitest";
import { CODE_ROLE_GUIDE } from "./codeWizard";
import { CODE_REVISE_GUIDE, REVISE_EMBED_MAX_CHARS, codeRevisePrompt, defaultReviseDelivery, reviseIssues } from "./codeRevise";
import { HTML_CLIP_CONTRACT, HTML_CLIP_FORMAT, HTML_CLIP_PACKAGE_REPLY, htmlClipTemplate, lintHtmlClip, writeManifest } from "./htmlClipPackage";

const LIBS = [{ id: "three", name: "three.js", version: "0.160.0", specifier: "three" }, { id: "three-gltf", name: "three.js GLTFLoader", version: "0.160.0", specifier: "three/addons/loaders/GLTFLoader.js" }];
const SPEC = "https://app.test/base/ai/HTML_CLIP_PACKAGE.md";
const MARKER = "REVISE_MARKER_9f3c";

const hud = () => {
  const html = `${htmlClipTemplate({
    format: HTML_CLIP_FORMAT, name: "HUD Overlay", role: "effect", durationSec: 8, width: 1080, height: 1920, aspect: "9:16", background: "#111111", libs: ["three"],
    params: { amount: { type: "number", default: 0.4, min: 0, max: 1, label: "Amount" } },
    bindings: { plate: { type: "video", label: "Plate", asset: "plate" } },
    inputs: { picture: { type: "graphic", label: "Picture" }, kick: { type: "beat", label: "Kick" } },
  })}\n<!-- ${MARKER} -->\n`;
  return html;
};

describe("Revise with AI prompt (P44)", () => {
  const brief = "Soften the colour split and keep the plate binding.";
  const opts = { libs: LIBS, specUrl: SPEC };

  it("needs a change description", () => {
    expect(reviseIssues("  ").map((i) => i.step)).toEqual(["describe"]);
    expect(reviseIssues("fade the title")).toEqual([]);
  });

  it("embeds a small package and attaches a large one", () => {
    expect(defaultReviseDelivery("x".repeat(REVISE_EMBED_MAX_CHARS))).toBe("embed");
    expect(defaultReviseDelivery("x".repeat(REVISE_EMBED_MAX_CHARS + 1))).toBe("attach");
    expect(REVISE_EMBED_MAX_CHARS).toBe(32 * 1024);
  });

  it("builds the prompt from the package contract, the current manifest and the embedded HTML", () => {
    const html = hud();
    const p = codeRevisePrompt({ html, brief, delivery: "embed", fileName: "HUD-Overlay.html" }, opts);
    expect(p).toContain("Dionysus does not call an AI.");
    expect(p).toContain(brief);
    expect(p).toContain("- Name: HUD Overlay");
    expect(p).toContain("- Role: effect");
    expect(p).toContain(CODE_ROLE_GUIDE.effect);
    expect(p).toContain("- Duration: 8 s");
    expect(p).toContain("- Frame: 1080×1920 (9:16)");
    expect(p).toContain("- Background: #111111");
    expect(p).toContain('"three" (three.js 0.160.0, import from "three")');
    expect(p).toContain('"amount" (number 0–1, default 0.4) Amount');
    expect(p).toContain('"picture" (graphic) Picture');
    expect(p).toContain('"kick" (beat, legacy alias of audio) Kick');
    expect(p).toContain('"plate" (video) Plate asset "plate"');
    expect(p).toContain(CODE_REVISE_GUIDE);
    expect(p).toContain("not a diff");
    expect(p).toContain(HTML_CLIP_CONTRACT);
    expect(p).toContain(HTML_CLIP_PACKAGE_REPLY);
    expect(p).toContain(SPEC);
    expect(p).toContain("```html\n");
    expect(p).toContain(MARKER);
    expect(p.endsWith("```")).toBe(true);
  });

  it("attach mode names the file and leaves the HTML out", () => {
    const html = hud();
    const p = codeRevisePrompt({ html, brief, delivery: "attach", fileName: "HUD-Overlay.html" }, opts);
    expect(p).toContain("attached to this chat as HUD-Overlay.html (dionysus.htmlclip/1)");
    expect(p).toContain(CODE_REVISE_GUIDE);
    expect(p).toContain(HTML_CLIP_CONTRACT);
    expect(p).not.toContain(MARKER);
    expect(p).not.toContain("```html\n");
  });

  it("states a timeline clip and a transition from the manifest", () => {
    const clip = writeManifest("<!doctype html><html><body><canvas></canvas><!-- CLIP_ONLY --></body></html>", { format: HTML_CLIP_FORMAT, name: "Title card", durationSec: 4, width: 1920, height: 1080, aspect: "16:9", background: "transparent" });
    const c = codeRevisePrompt({ html: clip, brief: "larger type", delivery: "attach", fileName: "Title-card.html" }, { libs: [], specUrl: SPEC });
    expect(c).toContain("- Role: clip");
    expect(c).toContain('leave "role" unset');
    expect(c).toContain("- Libraries: none");
    expect(c).toContain("- Params: none");
    expect(c).toContain("- Inputs: none");
    expect(c).toContain("- Bindings: none");
    expect(c).toContain("Allowed libraries: none");
    expect(c).not.toContain("CLIP_ONLY");
    const wipe = writeManifest("<!doctype html><html><body><canvas></canvas></body></html>", { format: HTML_CLIP_FORMAT, name: "Wipe", role: "transition", durationSec: 1, width: 1920, height: 1080, aspect: "16:9", background: "#000000" });
    expect(codeRevisePrompt({ html: wipe, brief: "slower", delivery: "embed", fileName: "Wipe.html" }, opts)).toContain(CODE_ROLE_GUIDE.transition);
  });

  it("warns when the reply drops a param or binding from the current clip", () => {
    const reply = htmlClipTemplate({ format: HTML_CLIP_FORMAT, name: "N", durationSec: 4, width: 1920, height: 1080, background: "#000000" });
    const r = lintHtmlClip(reply, { libs: [], expectParams: { title: { type: "text", default: "Hi" } }, expectBindings: { logo: "image" }, expectSource: "revise" });
    const text = r.issues.map((i) => i.message).join("\n");
    expect(r.ok).toBe(true);
    expect(text).toContain('Param "title" (text) is declared on the current clip but not in the manifest "params", so values already set for it on the timeline are dropped.');
    expect(text).toContain('Binding "logo" (image) is expected but not declared');
    expect(text).not.toContain("storyboard");
    expect(text).not.toContain("in AI mode");
  });
});
