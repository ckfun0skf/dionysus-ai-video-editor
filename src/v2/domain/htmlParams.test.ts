/** V2-HTML-PARAMS: typed params on html assets, per-use values on shots and layers, resolution and lint. */
import { describe, expect, it } from "vitest";
import { validateStoryboard } from "./storyJson";
import * as board from "./storyboard";
import {
  HTML_CLIP_FORMAT, checkParamValue, cleanParamDecls, htmlClipPackagePrompt, lintHtmlClip, resolveHtmlParams, validateParamDecls,
  type ClipLibrary, type HtmlClipParam,
} from "./htmlClipPackage";
import { slotPackageInput } from "./htmlClipBindings";

const LIBS: ClipLibrary[] = [];
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DECLS: Record<string, HtmlClipParam> = {
  text: { type: "text", default: "Title", label: "Text" },
  size: { type: "number", default: 0.1, min: 0.05, max: 0.3 },
  color: { type: "color", default: "#ffffff" },
  shadow: { type: "boolean", default: true },
  place: { type: "select", options: ["center", "lower-left"], default: "center" },
};
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "card", name: "Card", type: "html", prompt: "Text card brief", qa: [], params: structuredClone(DECLS) },
    { id: "bg", name: "BG", type: "image", prompt: "plain", qa: [] },
  ],
  shots: [
    { id: "s1", title: "One", durationSec: 3, prompt: "walk", assets: ["bg"], qa: [],
      layers: [{ id: "l1", type: "html", asset: "card", startSec: 0, endSec: 2, box: { x: 0, y: 0, width: 1, height: 1 }, params: { text: "5:58 AM", place: "lower-left" } }] },
    { id: "s2", title: "End", durationSec: 2, render: "html", clip: "card", assets: [], qa: [], params: { text: "THE END" } },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut" }],
});
const run = (mut: (d: J) => void = () => {}) => { const d = base(); mut(d); return validateStoryboard(d); };
const errs = (mut: (d: J) => void) => { const r = run(mut); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warns = (mut: (d: J) => void) => { const r = run(mut); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.warnings.map((w) => `${w.path}: ${w.message}`); };

describe("param declarations", () => {
  it("accepts every type and rejects bad keys, types, defaults and ranges", () => {
    expect(validateParamDecls(DECLS)).toEqual([]);
    const codes = (p: unknown) => validateParamDecls(p).map((i) => i.code);
    expect(codes([])).toEqual(["params"]);
    expect(codes({ "1x": { type: "text", default: "" } })).toEqual(["param-name"]);
    expect(codes({ a: { type: "font", default: "" } })).toEqual(["param-type"]);
    expect(codes({ a: { type: "number", default: 9, min: 0, max: 1 } })).toEqual(["param-default"]);
    expect(codes({ a: { type: "number", default: 0, min: 2, max: 1 } })).toContain("param-range");
    expect(codes({ a: { type: "select", options: [], default: "x" } })).toEqual(["param-default"]);
    expect(codes({ a: { type: "select", options: ["y"], default: "x" } })).toEqual(["param-default"]);
    expect(codes({ a: { type: "color", default: "red" } })).toEqual(["param-default"]);
    expect(codes({ a: { type: "boolean", default: "yes" } })).toEqual(["param-default"]);
    expect(Object.keys(cleanParamDecls({ ok: DECLS.text, bad: { type: "x" } }))).toEqual(["ok"]);
  });

  it("checks one value: wrong types rejected, numbers clamped", () => {
    expect(checkParamValue(DECLS.text, "Hi")).toEqual({ value: "Hi" });
    expect(checkParamValue(DECLS.text, 3).problem).toBeTruthy();
    expect(checkParamValue(DECLS.size, 2)).toMatchObject({ value: 0.3, clamped: true });
    expect(checkParamValue(DECLS.color, "#00ff00")).toEqual({ value: "#00ff00" });
    expect(checkParamValue(DECLS.color, "green").value).toBeUndefined();
    expect(checkParamValue(DECLS.place, "top").value).toBeUndefined();
    expect(checkParamValue(DECLS.shadow, false)).toEqual({ value: false });
  });

  it("resolves defaults overridden by valid per-use values; unknown keys are not passed", () => {
    expect(resolveHtmlParams(DECLS, undefined)).toEqual({ text: "Title", size: 0.1, color: "#ffffff", shadow: true, place: "center" });
    expect(resolveHtmlParams(DECLS, { text: "THE END", size: 9, color: "nope", shadow: false, ghost: 1 }))
      .toEqual({ text: "THE END", size: 0.3, color: "#ffffff", shadow: false, place: "center" });
    expect(resolveHtmlParams(undefined, { text: "x" })).toEqual({});
  });
});

describe("storyboard params", () => {
  it("imports declared params and per-use values on html shots and layers", () => {
    const r = run();
    expect(r.ok && r.warnings).toEqual([]);
    if (!r.ok) return;
    expect(r.doc.assets[0].params).toEqual(DECLS);
    expect(r.doc.shots[1].params).toEqual({ text: "THE END" });
    expect(r.doc.shots[0].layers![0]).toMatchObject({ type: "html", params: { text: "5:58 AM", place: "lower-left" } });
  });

  it("rejects invalid declarations and values of the wrong type", () => {
    expect(errs((d) => { d.assets[0].params.size.min = 1; }).join("\n")).toMatch(/assets\[0\]\.params/);
    expect(errs((d) => { d.shots[1].params = "THE END"; }).join("\n")).toMatch(/shots\[1\]\.params/);
    expect(errs((d) => { d.shots[1].params = { text: 5 }; }).join("\n")).toMatch(/text/);
    expect(errs((d) => { d.shots[0].layers[0].params = { place: "top" }; }).join("\n")).toMatch(/place/);
    expect(errs((d) => { d.shots[1].params = { color: "red" }; }).join("\n")).toMatch(/color/);
  });

  it("warns, drops or clamps: unknown keys, misplaced params, out-of-range numbers", () => {
    expect(warns((d) => { d.shots[1].params = { text: "x", ghost: 1 }; }).join("\n")).toMatch(/ghost/);
    const g = run((d) => { d.shots[1].params = { text: "x", ghost: 1 }; });
    expect(g.ok && g.doc.shots[1].params).toEqual({ text: "x" });
    const r = run((d) => { d.shots[1].params = { size: 5 }; });
    expect(r.ok && r.warnings.map((w) => w.path)).toContain("shots[1].params.size");
    expect(r.ok && r.doc.shots[1].params).toEqual({ size: 0.3 });
    expect(warns((d) => { d.assets[1].params = DECLS; }).join("\n")).toMatch(/Only html assets/);
    expect(warns((d) => { d.shots[0].params = { text: "x" }; }).join("\n")).toMatch(/shots\[0\]\.params/);
  });

  it("without declarations, values are kept as written", () => {
    const r = run((d) => { delete d.assets[0].params; });
    expect(r.ok && r.doc.shots[1].params).toEqual({ text: "THE END" });
  });

  it("slotPackageInput carries the asset's params and the values its shots and layers use", () => {
    const r = run(); if (!r.ok) throw new Error("bad");
    const b = board.storyboardFromDoc(r.doc);
    const input = slotPackageInput(b, b.slots.card);
    expect(input.params).toEqual(DECLS);
    expect(input.paramUses).toEqual(expect.arrayContaining([{ text: "THE END" }, { text: "5:58 AM", place: "lower-left" }]));
    expect(slotPackageInput(b, b.slots.bg).params).toBeUndefined();
  });
});

describe("lint against the storyboard's params", () => {
  const clip = (params: unknown, code = "render(t, ctx) { ctx.params.text; }") => `<!doctype html><html><head><script type="application/json" id="dionysus-clip">${JSON.stringify({ format: HTML_CLIP_FORMAT, name: "c", durationSec: 2, width: 1920, height: 1080, ...(params ? { params } : {}) })}</script></head><body><canvas></canvas><script>dionysus.clip({ ${code} });</script></body></html>`;
  const codes = (html: string) => lintHtmlClip(html, { libs: LIBS, expectParams: DECLS }).issues.map((i) => `${i.level}:${i.code}`);
  it("warns about missing or mistyped params and params the code never reads", () => {
    expect(codes(clip(DECLS)).filter((c) => c.includes("param"))).toEqual([]);
    expect(codes(clip({ ...DECLS, text: undefined }))).toContain("warning:param-missing");
    expect(codes(clip({ ...DECLS, size: { type: "text", default: "1" } }))).toContain("warning:param-mismatch");
    expect(codes(clip(DECLS, "render(t, ctx) {}"))).toContain("warning:param-unused");
  });

  it("the package prompt declares the params and shows the uses", () => {
    const text = htmlClipPackagePrompt({ brief: "b", name: "Card", id: "card", params: DECLS, paramUses: [{ text: "THE END" }, { text: "5:58 AM" }] }, { libs: LIBS, specUrl: "https://x/ai/HTML_CLIP_PACKAGE.md" });
    expect(text).toContain('"params"');
    expect(text).toContain("ctx.params.<key>");
    expect(text).toContain("THE END");
    expect(text).toContain("5:58 AM");
  });
});
