import { describe, expect, it } from "vitest";
import { CODE_ROLE_GUIDE, CODE_VIDEO_GUIDE, codeWizardPrompt, nearestAspect, newWizardAnswers, wizardIssues, wizardParams, wizardPackageInput } from "./codeWizard";
import { HTML_CLIP_CONTRACT, HTML_CLIP_PACKAGE_REPLY, htmlClipPackagePrompt, lintHtmlClip, htmlClipTemplate, promptManifest } from "./htmlClipPackage";

const LIBS = [{ id: "three", name: "three.js", version: "0.160.0", specifier: "three" }, { id: "other", name: "Other", version: "1", specifier: "other" }];
const SPEC = "https://app.test/base/ai/HTML_CLIP_PACKAGE.md";

describe("Code AI mode wizard (P4B)", () => {
  const hud = { ...newWizardAnswers("overlay"), description: "Object-detection HUD that boxes people in drone footage", params: [{ key: "boxColor", type: "color" as const, default: "#00ff88", label: "Box colour" }], aspect: "16:9", durationSec: 12, refs: [{ name: "drone.mp4", kind: "video" as const, durationSec: 12.5, width: 3840, height: 2160 }] };

  it("needs a description, valid unique param names and a sane duration", () => {
    expect(wizardIssues(newWizardAnswers()).map((i) => i.step)).toEqual(["describe"]);
    expect(wizardIssues({ ...hud, params: [...hud.params, { key: "boxColor", type: "text" }, { key: "1x", type: "number" }], durationSec: 0 }).map((i) => i.step)).toEqual(["params", "params", "size"]);
    expect(wizardIssues(hud)).toEqual([]);
  });
  it("declares params with types and defaults, and adds videoOffset for a video", () => {
    const ps = wizardParams(hud);
    expect(ps.boxColor).toEqual({ type: "color", default: "#00ff88", label: "Box colour" });
    expect(ps.videoOffset).toMatchObject({ type: "number", default: 0 });
    expect(wizardParams({ ...hud, refs: [] }).videoOffset).toBeUndefined();
    expect(wizardParams({ ...hud, params: [{ key: "mode", type: "select", options: "a, b", default: "b" }], refs: [] }).mode).toEqual({ type: "select", default: "b", options: ["a", "b"] });
  });
  it("builds the prompt from the package source: contract, template, spec link, role, video rules, zip reply", () => {
    const p = codeWizardPrompt(hud, { libs: LIBS, specUrl: SPEC });
    expect(p).toContain(HTML_CLIP_CONTRACT);
    expect(p).toContain(htmlClipTemplate(promptManifest(wizardPackageInput(hud), [])));
    expect(p).toContain(SPEC);
    expect(p).toContain(CODE_ROLE_GUIDE.overlay);
    expect(p).toContain(CODE_VIDEO_GUIDE);
    expect(p).toContain('"drone.mp4" (video, 3840×2160, 12.5 s)');
    expect(p).toContain('"background":"transparent"');
    expect(p).toContain('"videoOffset"');
    expect(p.endsWith(HTML_CLIP_PACKAGE_REPLY)).toBe(true);
    expect(p).toContain("Allowed libraries: none");
    const three = codeWizardPrompt({ ...hud, three: true, refs: [] }, { libs: LIBS, specUrl: SPEC });
    expect(three).toContain('"three" (three.js 0.160.0');
    expect(three).not.toContain('"other"');
    expect(three).not.toContain(CODE_VIDEO_GUIDE);
  });
  it("the default reply of the storyboard prompt is unchanged", () => {
    expect(htmlClipPackagePrompt({ brief: "x", name: "x" }, { libs: [], specUrl: SPEC })).toMatch(/Reply with ONE ```html code block/);
  });
  it("the template the prompt starts from lints clean", () => {
    expect(lintHtmlClip(htmlClipTemplate(promptManifest(wizardPackageInput(hud), [])), { libs: [] }).ok).toBe(true);
  });
  it("picks the nearest aspect for a reference", () => {
    expect(nearestAspect(3840, 2160)).toBe("16:9");
    expect(nearestAspect(1080, 1920)).toBe("9:16");
    expect(nearestAspect(1000, 990)).toBe("1:1");
  });
});
