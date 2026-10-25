import { describe, expect, it } from "vitest";
import { htmlClipTemplate, lintHtmlClip, readManifest } from "../domain";
import { CLIP_LIBRARIES } from "../render";
import { BASE_CSS, cleanParam, fontFaceCss, freeKey, generateClip, generateRaw, paramRows, paramSnippet, parseClip, retype, rowsToParams, syntaxCheck, validateRows, type CodeClipModel } from "./codeClip";
import { CODE_SAMPLES, newCodeClipHtml, newCodeModel } from "./codeSamples";

const model = (over: Partial<CodeClipModel> = {}): CodeClipModel => ({ ...newCodeModel(), ...over });

describe("V2-CODE-EDITOR script ↔ package", () => {
  it("generates a dionysus.htmlclip/1 file and parses it back to the same model", () => {
    const m = model({ css: "canvas{image-rendering:pixelated}", markup: '<div id="probe" style="font-family:Brand">x</div>' });
    const html = generateClip(m);
    expect(html).toContain('<script type="application/json" id="dionysus-clip">');
    expect(html).toContain('<canvas id="c"></canvas>');
    expect(readManifest(html).format).toBe("dionysus.htmlclip/1");
    const back = parseClip(html);
    expect(back.kind).toBe("model");
    if (back.kind !== "model") return;
    expect(back.model.script).toBe(m.script);
    expect(back.model.css).toBe(m.css);
    expect(back.model.markup).toBe(m.markup);
    expect(back.model.manifest).toEqual(readManifest(html));
    expect(generateClip(back.model)).toBe(html);
  });

  it("the new-clip template is a valid package that parses as a model and lints clean", () => {
    const html = newCodeClipHtml();
    expect(parseClip(html).kind).toBe("model");
    const lint = lintHtmlClip(html, { libs: CLIP_LIBRARIES });
    expect(lint.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(syntaxCheck(newCodeModel().script)).toBeUndefined();
  });

  it("font files get generated @font-face rules that round-trip without leaking into the extra CSS", () => {
    const m = model({ manifest: { ...newCodeModel().manifest, files: { "Brand Sans.woff2": "data:font/woff2;base64,AAAA", "logo.png": "data:image/png;base64,AAAA" } }, css: "body{color:red}" });
    expect(fontFaceCss(m.manifest.files)).toBe('@font-face { font-family: "Brand Sans"; src: url("Brand Sans.woff2") format("woff2"); font-display: block; }');
    const html = generateClip(m);
    expect(html).toContain('font-family: "Brand Sans"');
    expect(html).not.toContain("logo.png\")");
    const back = parseClip(html);
    expect(back.kind === "model" && back.model.css).toBe("body{color:red}");
    // Removing the font drops its rule.
    if (back.kind !== "model") return;
    const html2 = generateClip({ ...back.model, manifest: { ...back.model.manifest, files: { "logo.png": "data:image/png;base64,AAAA" } } });
    expect(html2).not.toContain("@font-face");
  });

  it("escapes closing tags inside the script and CSS so the page stays well formed", () => {
    const html = generateClip(model({ script: 'const s = "</script>";\n', css: "/* </style> */" }));
    expect(html.match(/<\/script>/g)!.length).toBe(2);
    expect(html).toContain("<\\/script>");
    expect(html.match(/<\/style>/g)!.length).toBe(1);
  });

  it("other pages open raw (with a reason) and keep their HTML; generateRaw writes the edited manifest", () => {
    const legacy = '<!doctype html><html><head><style>body{background:#000}</style></head><body><h1 id="t">Hi</h1><script>dionysus.onFrame(()=>{})</script></body></html>';
    const p = parseClip(legacy);
    expect(p.kind).toBe("raw");
    if (p.kind !== "raw") return;
    expect(p.reason).toMatch(/raw HTML/);
    expect(p.html).toBe(legacy);
    const out = generateRaw(p.html, { format: "dionysus.htmlclip/1", name: "Legacy", durationSec: 3 });
    expect(readManifest(out).name).toBe("Legacy");
    expect(out).toContain('<h1 id="t">Hi</h1>');
    // Two scripts, or a page CSS that isn't the editor's, also open raw.
    expect(parseClip(generateClip(model()).replace("</body>", "<script>1</script></body>")).kind).toBe("raw");
    expect(parseClip(generateClip(model()).replace(BASE_CSS, "body{}")).kind).toBe("raw");
  });

  it("syntaxCheck accepts imports, top-level await and exports, and reports typos", () => {
    expect(syntaxCheck('import * as THREE from "three";\nimport {\n  a,\n  b,\n} from "x";\nawait 1;\nexport const k = 1;\n')).toBeUndefined();
    expect(syntaxCheck("dionysus.clip({ render(t) { if (t { } } });")?.message).toBeTruthy();
  });
});

describe("V2-CODE-EDITOR params editor ↔ manifest", () => {
  it("rows round-trip to the manifest's params in row order, keeping only the fields for each type", () => {
    const params = newCodeModel().manifest.params!;
    const rows = paramRows(params);
    expect(rows.map((r) => r.key)).toEqual(["title", "color", "size", "speed"]);
    expect(rowsToParams(rows)).toEqual(params);
    const reordered = [rows[3], rows[0], rows[1], rows[2]];
    expect(Object.keys(rowsToParams(reordered)!)).toEqual(["speed", "title", "color", "size"]);
    expect(rowsToParams([])).toBeUndefined();
    expect(cleanParam({ type: "text", default: "a", min: 1, options: ["x"], label: "" })).toEqual({ type: "text", default: "a" });
    expect(cleanParam({ type: "number", default: 1, min: 0, max: Number.NaN, step: undefined })).toEqual({ type: "number", default: 1, min: 0 });
  });

  it("an edited param list saves into the package and reads back identically", () => {
    const rows = paramRows(newCodeModel().manifest.params);
    rows[1] = { ...rows[1], key: "tint", param: { ...rows[1].param, default: "#ff0000", label: "Tint" } };
    rows.push({ id: "x", key: "shape", param: { type: "select", default: "ring", options: ["disc", "ring"], label: "Shape" } });
    rows.push({ id: "y", key: "glow", param: { type: "boolean", default: false } });
    const m = model();
    const html = generateClip({ ...m, manifest: { ...m.manifest, params: rowsToParams(rows) } });
    const back = parseClip(html);
    expect(back.kind === "model" && back.model.manifest.params).toEqual(rowsToParams(rows));
    expect(paramRows(readManifest(html).params).map((r) => [r.key, r.param])).toEqual(rows.map((r) => [r.key, cleanParam(r.param)]));
  });

  it("validates keys (format, duplicates) and each declaration", () => {
    const rows = [
      { id: "a", key: "", param: { type: "number" as const, default: 1 } },
      { id: "b", key: "9lives", param: { type: "number" as const, default: 1 } },
      { id: "c", key: "speed", param: { type: "number" as const, default: 1 } },
      { id: "d", key: "speed", param: { type: "number" as const, default: 1 } },
      { id: "e", key: "shape", param: { type: "select" as const, default: "x", options: ["a", "b"] } },
      { id: "f", key: "ok", param: { type: "color" as const, default: "#123456" } },
    ];
    const v = validateRows(rows);
    expect(v.get("a")![0].message).toMatch(/key/);
    expect(v.get("b")![0].message).toMatch(/must start with a letter/);
    expect(v.get("c")![0].code).toBe("param-dup");
    expect(v.get("d")![0].code).toBe("param-dup");
    expect(v.get("e")!.length).toBeGreaterThan(0);
    expect(v.has("f")).toBe(false);
  });

  it("snippets, retyping and free keys", () => {
    expect(paramSnippet("speed")).toBe("ctx.params.speed");
    expect(paramSnippet("bg-color")).toBe('ctx.params["bg-color"]');
    expect(retype({ type: "number", default: 3, label: "Size" }, "text")).toMatchObject({ type: "text", default: "3", label: "Size" });
    expect(retype({ type: "text", default: "big", label: "Size" }, "select")).toMatchObject({ type: "select", default: "big", options: ["big"] });
    expect(retype({ type: "text", default: "x" }, "boolean")).toEqual({ type: "boolean", default: true, label: undefined, description: undefined });
    expect(freeKey(paramRows({ param: { type: "number", default: 1 }, param2: { type: "number", default: 1 } }))).toBe("param3");
  });
});

describe("V2-CODE-EDITOR samples", () => {
  it("has Canvas animation and Three.js samples; each is a valid model clip", () => {
    expect(CODE_SAMPLES.map((s) => s.name)).toEqual(["Canvas animation", "Three.js"]);
    for (const s of CODE_SAMPLES) {
      const m = s.model();
      expect(syntaxCheck(m.script)).toBeUndefined();
      expect(validateRows(paramRows(m.manifest.params)).size).toBe(0);
      const html = generateClip(m);
      const lint = lintHtmlClip(html, { libs: CLIP_LIBRARIES });
      expect(lint.issues.filter((i) => i.level === "error"), s.name).toEqual([]);
      const back = parseClip(html);
      expect(back.kind).toBe("model");
      if (back.kind === "model") expect(back.model.script).toBe(m.script);
    }
    expect(CODE_SAMPLES[1].model().manifest.libs).toEqual(["three"]);
    expect(CODE_SAMPLES[1].model().script).toMatch(/import \* as THREE from "three"/);
  });

  it("hand-written pages in the editor's shape (single quotes, no trailing newline) open as a model", () => {
    const html = generateClip(model()).replace('<meta charset="utf-8">', "<meta charset='utf-8'>").replace('<canvas id="c">', "<canvas id='c'>").trimEnd();
    expect(parseClip(html).kind).toBe("model");
  });
  it("the AI prompt's template opens as Script + Params, not raw HTML", () => {
    const parsed = parseClip(htmlClipTemplate());
    expect(parsed.kind).toBe("model");
    if (parsed.kind === "model") expect(parsed.model.script).toContain("dionysus.clip({");
  });
});
