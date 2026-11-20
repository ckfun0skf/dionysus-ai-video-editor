import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_FORMAT, PLUGIN_LIMITS, checkPluginFiles, comparePluginVersions, isPluginFilePath, parsePluginManifest,
  validatePluginManifest, type PluginIssue, type PluginManifest,
} from "./pluginManifest";

const SAMPLE_DIR = resolve(__dirname, "../../../public/plugins/samples/x-dionysus-stripes");
const sampleText = readFileSync(resolve(SAMPLE_DIR, "manifest.json"), "utf8");
const LIBS = ["three", "three-gltf"];

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: PLUGIN_FORMAT, id: "x-acme-dots", name: "Dots", version: "1.0.0",
  render: { entry: "render.js" }, files: ["render.js"],
  params: { size: { type: "number", default: 4, min: 1, max: 10 }, tint: { type: "color", default: "#ff0000" } },
  ...over,
});
const errors = (issues: PluginIssue[]) => issues.filter((i) => i.level === "error");
const at = (issues: PluginIssue[], path: string) => issues.filter((i) => i.path === path);

describe("dionysus.cliptype/1 manifest (P83)", () => {
  it("accepts the sample package and a minimal manifest with no problems", () => {
    const { manifest, issues } = parsePluginManifest(sampleText, { libs: LIBS });
    expect(issues).toEqual([]);
    expect(manifest?.id).toBe("x-dionysus-stripes");
    expect(validatePluginManifest(base(), { libs: LIBS })).toEqual([]);
    expect(validatePluginManifest({ format: PLUGIN_FORMAT, id: "x-a", name: "A", version: "0.1.0", render: { entry: "a.js" }, files: ["a.js"] })).toEqual([]);
  });

  it("reports bad JSON and a non-object at the root", () => {
    expect(parsePluginManifest("{").issues[0]).toMatchObject({ level: "error", path: "", message: expect.stringMatching(/Not valid JSON/) });
    expect(validatePluginManifest([])).toEqual([{ level: "error", path: "", message: "The manifest must be a JSON object." }]);
    expect(parsePluginManifest("{}").manifest).toBeUndefined();
  });

  it("checks format, api, id, name, version and the identity fields with paths", () => {
    const issues = validatePluginManifest(base({
      format: "dionysus.cliptype/2", api: 2, id: "acme-dots", name: "", version: "1.0", publisher: 5,
      description: "x".repeat(PLUGIN_LIMITS.description + 1), homepage: "http://example.com", icon: "rocket", trackKind: "audio",
    }));
    const paths = errors(issues).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["format", "api", "id", "name", "version", "publisher", "description", "homepage", "icon", "trackKind"]));
    expect(at(issues, "id")[0].message).toMatch(/start with "x-"/);
    expect(at(issues, "api")[0].message).toMatch(/needs a newer Dionysus \(host API 2; this build has 1\)/);
    expect(errors(validatePluginManifest(base({ id: "x-Acme" })))[0].path).toBe("id");
    expect(errors(validatePluginManifest(base({ id: `x-${"a".repeat(70)}` })))[0].message).toMatch(/most is 64/);
    expect(errors(validatePluginManifest(base({ id: undefined, name: undefined, version: undefined }))).map((i) => i.path)).toEqual(["id", "name", "version"]);
    expect(validatePluginManifest(base({ version: "2.0.0-beta.1" }))).toEqual([]);
  });

  it("allows only visual, keyable caps in v1 (no sound, no media)", () => {
    const issues = validatePluginManifest(base({ caps: { visual: false, keyable: "yes", sound: true, sourceTime: true, asset: "media", glow: true } }));
    expect(errors(issues).map((i) => i.path)).toEqual(["caps.visual", "caps.keyable", "caps.sound", "caps.sourceTime", "caps.asset"]);
    expect(at(issues, "caps.sound")[0].message).toMatch(/can't play sound/);
    expect(at(issues, "caps.glow")[0].level).toBe("warning");
    expect(errors(validatePluginManifest(base({ durationSec: 0 })))[0].path).toBe("durationSec");
    expect(errors(validatePluginManifest(base({ inputs: {}, bindings: {}, storyboard: {} }))).map((i) => i.path)).toEqual(["inputs", "bindings", "storyboard"]);
  });

  it("checks files and the render entry", () => {
    expect(errors(validatePluginManifest(base({ files: undefined }))).map((i) => i.path)).toEqual(["files"]);
    const issues = validatePluginManifest(base({ files: ["render.js", "../x.js", "/abs.js", "a\\b.js", "render.js", "manifest.json", "fonts/ok.woff2"] }));
    expect(errors(issues).map((i) => i.path)).toEqual(["files[1]", "files[2]", "files[3]", "files[4]", "files[5]"]);
    expect(at(issues, "files[4]")[0].message).toMatch(/listed twice/);
    expect(errors(validatePluginManifest(base({ render: { entry: "main.js" } })))[0]).toMatchObject({ path: "render.entry", message: expect.stringMatching(/not listed/) });
    expect(errors(validatePluginManifest(base({ render: { entry: "index.html" }, files: ["index.html"] })))[0].message).toMatch(/\.js file/);
    expect(errors(validatePluginManifest(base({ render: undefined })))[0].path).toBe("render");
    expect(errors(validatePluginManifest(base({ files: Array.from({ length: PLUGIN_LIMITS.files + 1 }, (_, i) => `f${i}.js`), render: { entry: "f0.js" } })))[0].path).toBe("files");
  });

  it("checks libraries against the host's list", () => {
    const issues = validatePluginManifest(base({ render: { entry: "render.js", libs: ["three", "jquery"], worker: true } }), { libs: LIBS });
    expect(errors(issues)).toEqual([expect.objectContaining({ path: "render.libs[1]", message: expect.stringMatching(/Unknown library "jquery"\. Allowed: "three", "three-gltf"/) })]);
    expect(at(issues, "render.worker")[0].level).toBe("warning");
    expect(errors(validatePluginManifest(base({ render: { entry: "render.js", libs: "three" } })))[0].path).toBe("render.libs");
  });

  it("reports param problems at the param's own path", () => {
    const issues = validatePluginManifest(base({ params: {
      "1bad": { type: "number", default: 1 },
      kind: { type: "slider", default: 1 },
      n: { type: "number", default: 20, min: 0, max: 10 },
      c: { type: "color", default: "red" },
      s: { type: "select", default: "a", options: [] },
      l: { type: "text", default: "", label: 3 },
    } }));
    const paths = errors(issues).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['params["1bad"]', "params.kind.type", "params.n.default", "params.c.default", "params.s.options", "params.l.label"]));
    expect(errors(validatePluginManifest(base({ params: [] })))[0].path).toBe("params");
  });

  it("checks the declarative editor form", () => {
    const ok = validatePluginManifest(base({ editor: { groups: [{ label: "Look", fields: ["size", "tint"] }] } }));
    expect(ok).toEqual([]);
    const issues = validatePluginManifest(base({ editor: { groups: [
      { label: "Look", fields: ["size", "nope", "size"], html: "<b>" },
      { label: "", fields: [] },
      "x",
    ], component: "Panel.tsx" } }));
    expect(errors(issues).map((i) => i.path)).toEqual(["editor.groups[0].fields[1]", "editor.groups[0].fields[2]", "editor.groups[1].label", "editor.groups[1].fields", "editor.groups[2]", "editor.component"]);
    expect(at(issues, "editor.component")[0].message).toMatch(/can't add their own editor UI/);
    expect(at(issues, "editor.groups[0].html")[0].level).toBe("warning");
    expect(at(issues, "params.tint")[0]).toMatchObject({ level: "warning", message: expect.stringMatching(/"More"/) });
    expect(errors(validatePluginManifest(base({ editor: { groups: "x" } })))[0].path).toBe("editor");
  });

  it("allows only structured agent hints, with examples checked against the params", () => {
    const ok = validatePluginManifest(base({ agent: { description: "Dots.", examples: [{ description: "Big red dots.", params: { size: 9, tint: "#ff0000" } }] } }));
    expect(ok).toEqual([]);
    const issues = validatePluginManifest(base({ agent: {
      description: "x".repeat(PLUGIN_LIMITS.agentDescription + 1),
      examples: [{ description: "", params: { size: 99, tint: "red", other: 1 } }, 3],
      rules: ["Always use dots."], tools: [{ name: "dots" }], mood: "happy",
    } }));
    expect(errors(issues).map((i) => i.path)).toEqual([
      "agent.description", "agent.examples[0].description", "agent.examples[0].params.size", "agent.examples[0].params.tint",
      "agent.examples[0].params.other", "agent.examples[1]", "agent.rules", "agent.tools",
    ]);
    expect(at(issues, "agent.rules")[0].message).toMatch(/can't add AI rules/);
    expect(at(issues, "agent.examples[0].params.size")[0].message).toMatch(/outside 1–10/);
    expect(at(issues, "agent.mood")[0].level).toBe("warning");
    const many = Array.from({ length: PLUGIN_LIMITS.examples + 1 }, () => ({ description: "d" }));
    expect(errors(validatePluginManifest(base({ agent: { examples: many } })))[0].path).toBe("agent.examples");
  });

  it("warns about unknown top-level fields and keeps the manifest", () => {
    const r = parsePluginManifest(JSON.stringify(base({ future: 1 })));
    expect(r.issues).toEqual([{ level: "warning", path: "future", message: 'Unknown field "future" is ignored.' }]);
    expect(r.manifest?.id).toBe("x-acme-dots");
  });

  it("checks package files and safe paths", () => {
    expect(isPluginFilePath("fonts/a.woff2")).toBe(true);
    for (const p of ["", "../a", "a/../b", "/a", "a//b", "./a", "manifest.json", "a b.js", 3]) expect(isPluginFilePath(p)).toBe(false);
    const m = { files: ["render.js", "data/a.json"] } as Pick<PluginManifest, "files">;
    expect(checkPluginFiles(m, ["manifest.json", "render.js", "data/a.json"])).toEqual([]);
    expect(checkPluginFiles(m, ["render.js", "extra.txt"])).toEqual([
      { level: "error", path: "files[1]", message: '"data/a.json" is listed but not in the package.' },
      { level: "warning", path: "files", message: '"extra.txt" is in the package but not listed; it is ignored.' },
    ]);
  });

  it("orders semantic versions", () => {
    const sorted = ["1.0.0", "0.9.9", "1.0.0-beta.2", "1.0.0-alpha", "1.0.0-beta.11", "2.0.0", "1.10.0", "1.2.0"].sort(comparePluginVersions);
    expect(sorted).toEqual(["0.9.9", "1.0.0-alpha", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0", "1.2.0", "1.10.0", "2.0.0"]);
    expect(comparePluginVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("sample plugin x-dionysus-stripes (P83)", () => {
  // Load render.js the way the host will (a classic script that calls dionysus.clip) and draw into a recording context.
  const load = () => {
    let def: { render(t: number, ctx: unknown): void } | undefined;
    new Function("dionysus", readFileSync(resolve(SAMPLE_DIR, "render.js"), "utf8"))({ clip: (d: typeof def) => { def = d; } });
    return def!;
  };
  const draw = (t: number, params: Record<string, unknown>) => {
    const calls: unknown[] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get: (_o, k) => (...a: unknown[]) => { calls.push([k, ...a]); },
      set: (_o, k, v) => { calls.push([`=${String(k)}`, v]); return true; },
    });
    const { manifest } = parsePluginManifest(sampleText);
    const defaults = Object.fromEntries(Object.entries(manifest!.params!).map(([k, p]) => [k, p.default]));
    load().render(t, { width: 640, height: 360, params: { ...defaults, ...params }, canvas: { getContext: () => g } });
    return calls;
  };

  it("registers a render function and draws the same calls for the same t in any order", () => {
    const a = draw(1.25, {}), b = draw(3, {}), a2 = draw(1.25, {});
    expect(a.length).toBeGreaterThan(5);
    expect(a2).toEqual(a);
    expect(b).not.toEqual(a);
  });

  it("draws the title band only when there is a title", () => {
    expect(draw(0, {}).some((c) => (c as unknown[])[0] === "fillText")).toBe(false);
    expect(draw(0, { title: "Hello" }).some((c) => (c as unknown[])[0] === "fillText" && (c as unknown[])[1] === "Hello")).toBe(true);
  });
});
