// Enforces the v2 layering rules from docs/v2/MODULE_DESIGN.md §3 by scanning imports.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const V2 = resolve(__dirname);
const ALLOWED: Record<string, string[]> = {
  // Preset modules (V2-FX-MOD) sit under the registry: the registry loads them, they import only registry types.
  registry: ["registry", "presets"],
  presets: ["presets", "registry"],
  // P66: domain predicates read the clip type registry (clipTypes imports domain only as types, so no runtime cycle).
  domain: ["domain", "registry", "clipTypes"],
  // Clip type cores (P65, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): pure data; `domain` only through `import type`.
  clipTypes: ["clipTypes", "domain", "registry"],
  // P67: a clip type's renderer (clipTypes/<id>/render.ts) is render-layer code: it may use the canvas and render helpers.
  "clipTypes/render": ["clipTypes", "domain", "registry", "render"],
  // P69: a clip type's timeline UI (clipTypes/<id>/ui.tsx) is ui-layer code: React and ui helpers allowed.
  "clipTypes/ui": ["clipTypes", "domain", "registry", "render", "ui"],
  // P78: a clip type's agent runner (clipTypes/<id>/agent.ts) uses the domain at runtime; its core loads it lazily.
  "clipTypes/agent": ["clipTypes", "domain", "registry"],
  ports: ["registry", "domain", "ports"],
  engine: ["registry", "domain", "ports", "engine"],
  // P71: file import reads the clip type cores (`accepts`) through the clipTypes barrel.
  persistence: ["registry", "domain", "ports", "persistence", "clipTypes"],
  render: ["registry", "domain", "ports", "render", "clipTypes"],
  // P69: ui reads the clip type registry through the clipTypes/index.ts barrel (ui/clipTypeUi.tsx globs the ui.tsx modules).
  ui: ["domain", "ports", "engine", "persistence", "render", "registry", "ui", "clipTypes"],
};
/** Known violations being fixed in follow-up PRs; must shrink to empty. */
const KNOWN_VIOLATIONS = new Set<string>();
const NO_DOM = new Set(["registry", "presets", "domain", "ports", "engine", "clipTypes", "clipTypes/agent"]);
/** Matches a value (non-type) import or re-export from the domain layer, which clipTypes must not have. */
export const VALUE_DOMAIN_IMPORT = /\b(?:import|export)\s+(?!type\b)[^"'`;]*?\bfrom\s*["'](?:\.\.\/)+domain(?:\/[^"']*)?["']/;

/** A static (non-type) import of a sibling `./agent` module. */
export const STATIC_AGENT_IMPORT = /\b(?:import|export)\s+(?!type\b)[^"'`;()]*?\bfrom\s*["']\.\/agent(?:\.ts)?["']|\bimport\s*["']\.\/agent(?:\.ts)?["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
/** Every module specifier: `import x from`, `export … from`, side-effect `import "x"`, and dynamic `import("x")`. */
export function importSpecs(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");
  const re = /\b(?:import|export)\s+(?:type\s+)?[^"'`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  return [...code.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3]);
}
const layerOf = (file: string) => {
  const parts = relative(V2, file).split(/[\\/]/);
  if (parts[0] === "clipTypes" && parts.length === 3 && parts[2] === "render.ts") return "clipTypes/render";
  if (parts[0] === "clipTypes" && parts.length === 3 && parts[2] === "ui.tsx") return "clipTypes/ui";
  if (parts[0] === "clipTypes" && parts.length === 3 && parts[2] === "agent.ts") return "clipTypes/agent";
  return parts[0];
};

describe("v2 architecture", () => {
  const all = files(V2).filter((f) => layerOf(f) in ALLOWED);
  it("finds v2 sources", () => expect(all.length).toBeGreaterThan(5));
  it("import scanner catches every import form", () => {
    expect(importSpecs([
      'import a from "./a";', 'import { b,\n c } from "../b";', 'import type { T } from "./t";', 'export * from "./e";',
      'export { f } from "./f";', 'import "./side";', "import './side2'", 'await import("./dyn");', '// import "./commented";',
    ].join("\n"))).toEqual(["./a", "../b", "./t", "./e", "./f", "./side", "./side2", "./dyn"]);
  });
  it("a clip type loads its agent runner only with import()", () => {
    expect(STATIC_AGENT_IMPORT.test('import { runSceneTool } from "./agent";')).toBe(true);
    expect(STATIC_AGENT_IMPORT.test('import "./agent";')).toBe(true);
    expect(STATIC_AGENT_IMPORT.test('run: () => import("./agent").then((m) => m.run())')).toBe(false);
    expect(STATIC_AGENT_IMPORT.test('import type { X } from "./agent";')).toBe(false);
    expect(STATIC_AGENT_IMPORT.test('import { SCENE_AGENT_TOOLS } from "./agentDefs";')).toBe(false);
  });
  it("clipTypes domain-import check allows only type imports", () => {
    expect(VALUE_DOMAIN_IMPORT.test('import type { Placement } from "../domain/model";')).toBe(false);
    expect(VALUE_DOMAIN_IMPORT.test('import type { Placement } from "../../domain";')).toBe(false);
    expect(VALUE_DOMAIN_IMPORT.test('import { TEXT_SOURCE } from "../domain/model";')).toBe(true);
    expect(VALUE_DOMAIN_IMPORT.test('import { ops } from "../../domain";')).toBe(true);
    expect(VALUE_DOMAIN_IMPORT.test('export { x } from "../domain/model";')).toBe(true);
  });
  for (const file of all) {
    const layer = layerOf(file);
    const name = relative(V2, file).replace(/\\/g, "/");
    (KNOWN_VIOLATIONS.has(name) ? it.skip : it)(`${name} respects layer rules`, () => {
      const src = readFileSync(file, "utf8");
      const specs = importSpecs(src);
      for (const spec of specs) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const rel = relative(V2, target);
          expect(rel.startsWith(".."), `${spec}: v2 must stay self-contained under src/v2`).toBe(false);
          const tLayer = rel.split(/[\\/]/)[0];
          expect(ALLOWED[layer], `${layer} -> ${tLayer} (${spec})`).toContain(tLayer);
          if (layer === "presets" && tLayer === "registry") expect(rel.replace(/\\/g, "/"), `presets may import only registry/types (no cycle): ${spec}`).toMatch(/^registry\/types(\.ts)?$/);
          if (layer === "ui" && tLayer !== "ui") expect(rel.split(/[\\/]/).length, `ui must import ${tLayer} via its index.ts barrel (${spec})`).toBeLessThanOrEqual(1);
        } else if (NO_DOM.has(layer)) {
          expect(["react", "react-dom"].some((r) => spec === r || spec.startsWith(`${r}/`)), `${layer} must not import ${spec}`).toBe(false);
        }
      }
      if (layer === "clipTypes") expect(VALUE_DOMAIN_IMPORT.test(src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1")), "clipTypes may import domain only with `import type` (no runtime cycle)").toBe(false);
      // P78: a type's agent runner uses the domain at runtime, so its core (and anything else in the type) loads it with import() only.
      if (layer === "clipTypes" && name.split("/").length === 3) expect(STATIC_AGENT_IMPORT.test(src.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1")), "load ./agent with import() (it uses the domain at runtime)").toBe(false);
      if (NO_DOM.has(layer)) expect(/\b(document|window|indexedDB|HTMLElement)\b/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${layer} must not use DOM globals`).toBe(false);
    });
  }
});
