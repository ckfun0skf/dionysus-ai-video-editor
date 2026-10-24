// Enforces the v2 layering rules from docs/v2/MODULE_DESIGN.md §3 by scanning imports.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const V2 = resolve(__dirname);
const ALLOWED: Record<string, string[]> = {
  // Preset modules (V2-FX-MOD) sit under the registry: the registry loads them, they import only registry types.
  registry: ["registry", "presets"],
  presets: ["presets", "registry"],
  domain: ["domain", "registry"],
  ports: ["registry", "domain", "ports"],
  engine: ["registry", "domain", "ports", "engine"],
  persistence: ["registry", "domain", "ports", "persistence"],
  render: ["registry", "domain", "ports", "render"],
  ui: ["domain", "ports", "engine", "persistence", "render", "registry", "ui"],
};
/** Known violations being fixed in follow-up PRs; must shrink to empty. */
const KNOWN_VIOLATIONS = new Set<string>();
const NO_DOM = new Set(["registry", "presets", "domain", "ports", "engine"]);

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
const layerOf = (file: string) => relative(V2, file).split(/[\\/]/)[0];

describe("v2 architecture", () => {
  const all = files(V2).filter((f) => layerOf(f) in ALLOWED);
  it("finds v2 sources", () => expect(all.length).toBeGreaterThan(5));
  it("import scanner catches every import form", () => {
    expect(importSpecs([
      'import a from "./a";', 'import { b,\n c } from "../b";', 'import type { T } from "./t";', 'export * from "./e";',
      'export { f } from "./f";', 'import "./side";', "import './side2'", 'await import("./dyn");', '// import "./commented";',
    ].join("\n"))).toEqual(["./a", "../b", "./t", "./e", "./f", "./side", "./side2", "./dyn"]);
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
          expect(rel.startsWith(".."), `${spec}: v2 must not import legacy src`).toBe(false);
          const tLayer = rel.split(/[\\/]/)[0];
          expect(ALLOWED[layer], `${layer} -> ${tLayer} (${spec})`).toContain(tLayer);
          if (layer === "presets" && tLayer === "registry") expect(rel.replace(/\\/g, "/"), `presets may import only registry/types (no cycle): ${spec}`).toMatch(/^registry\/types(\.ts)?$/);
          if (layer === "ui" && tLayer !== "ui") expect(rel.split(/[\\/]/).length, `ui must import ${tLayer} via its index.ts barrel (${spec})`).toBeLessThanOrEqual(1);
        } else if (NO_DOM.has(layer)) {
          expect(["react", "react-dom"].some((r) => spec === r || spec.startsWith(`${r}/`)), `${layer} must not import ${spec}`).toBe(false);
        }
      }
      if (NO_DOM.has(layer)) expect(/\b(document|window|indexedDB|HTMLElement)\b/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${layer} must not use DOM globals`).toBe(false);
    });
  }
});
