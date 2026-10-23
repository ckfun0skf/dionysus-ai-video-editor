// Enforces the v2 layering rules from docs/v2/MODULE_DESIGN.md §3 by scanning imports.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const V2 = resolve(__dirname);
const ALLOWED: Record<string, string[]> = {
  domain: ["domain"],
  ports: ["domain", "ports"],
  engine: ["domain", "ports", "engine"],
  persistence: ["domain", "ports", "persistence"],
  render: ["domain", "ports", "render"],
  ui: ["domain", "ports", "engine", "persistence", "render", "ui"],
};
/** Known violations being fixed in follow-up PRs; must shrink to empty. */
const KNOWN_VIOLATIONS = new Set(["persistence/autosave.ts", "ui/V2App.tsx", "ui/Timeline.tsx", "ui/useEditor.ts", "ui/useThumbs.ts"]);
const NO_DOM = new Set(["domain", "ports", "engine"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const layerOf = (file: string) => relative(V2, file).split(/[\\/]/)[0];

describe("v2 architecture", () => {
  const all = files(V2).filter((f) => layerOf(f) in ALLOWED);
  it("finds v2 sources", () => expect(all.length).toBeGreaterThan(5));
  for (const file of all) {
    const layer = layerOf(file);
    const name = relative(V2, file).replace(/\\/g, "/");
    (KNOWN_VIOLATIONS.has(name) ? it.skip : it)(`${name} respects layer rules`, () => {
      const src = readFileSync(file, "utf8");
      const specs = [...src.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
      for (const spec of specs) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const rel = relative(V2, target);
          expect(rel.startsWith(".."), `${spec}: v2 must not import legacy src`).toBe(false);
          const tLayer = rel.split(/[\\/]/)[0];
          expect(ALLOWED[layer], `${layer} -> ${tLayer} (${spec})`).toContain(tLayer);
          if (layer === "ui" && tLayer !== "ui") expect(rel.split(/[\\/]/).length, `ui must import ${tLayer} via its index.ts barrel (${spec})`).toBeLessThanOrEqual(1);
        } else if (NO_DOM.has(layer)) {
          expect(["react", "react-dom"].some((r) => spec === r || spec.startsWith(`${r}/`)), `${layer} must not import ${spec}`).toBe(false);
        }
      }
      if (NO_DOM.has(layer)) expect(/\b(document|window|indexedDB|HTMLElement)\b/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${layer} must not use DOM globals`).toBe(false);
    });
  }
});
