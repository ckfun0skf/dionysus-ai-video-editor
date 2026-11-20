import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { HTML_LIBRARIES } from "./htmlLibs";
import { loadPluginLibs, matchesIntegrity, moduleToClassic, pluginLibraries } from "./pluginLibs";

const file = (p: string) => readFileSync(new URL(`../../../public/${p}`, import.meta.url));

describe("P85 pinned libraries for plugin workers", () => {
  it("orders dependencies first and skips editor-only and unknown ids", () => {
    expect(pluginLibraries(["three-gltf"]).map((l) => l.id)).toEqual(["three", "three-gltf"]);
    expect(pluginLibraries(["three", "three-gltf", "three"]).map((l) => l.id)).toEqual(["three", "three-gltf"]);
    expect(pluginLibraries(["three-orbit", "nope"]).map((l) => l.id)).toEqual([]);
  });

  it("rewrites the vendored three.js and GLTFLoader into classic scripts that fill one THREE global", () => {
    const specs = ["three", "three/addons/loaders/GLTFLoader.js"];
    const three = moduleToClassic(file("vendor/three-0.160.0.module.min.js").toString("utf8"), specs);
    const gltf = moduleToClassic(file("vendor/three-gltfloader-0.160.0.min.js").toString("utf8"), specs);
    const g: Record<string, unknown> = { console };
    g.self = g;
    vm.createContext(g);
    vm.runInContext(three, g);
    vm.runInContext(gltf, g);
    const T = g.THREE as Record<string, any>;
    expect(T.REVISION).toBe("160");
    expect(typeof T.WebGLRenderer).toBe("function");
    expect(typeof T.GLTFLoader).toBe("function");
    expect(new T.Vector3(3, 4, 0).length()).toBe(5);
    // Nothing leaks besides THREE (the minified top-level names stay inside the function scope).
    expect(Object.keys(g).sort()).toEqual(["THREE", "console", "self"]);
  });

  it("refuses module syntax it can't rewrite", () => {
    expect(() => moduleToClassic(`import{a}from"lodash";export{a};`, ["three"])).toThrow(/not a pinned library/);
    expect(() => moduleToClassic(`const a=1;export{a};const b=2;`, [])).toThrow(/last statement/);
    expect(() => moduleToClassic(`const a=1;`, [])).toThrow(/one export list/);
    expect(() => moduleToClassic(`const a=import.meta.url;export{a};`, [])).toThrow(/module syntax/);
    expect(() => moduleToClassic(`const a=()=>import("x");export{a};`, [])).toThrow(/module syntax/);
    expect(moduleToClassic(`import{x as y,z}from"three";const a=y+z;export{a as A,a};`, ["three"])).toContain("const{x:y,z:z}=self.THREE;");
  });

  it("checks SRI hashes and loads each library once", async () => {
    for (const l of HTML_LIBRARIES) {
      const bytes = file(l.path);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      expect(await matchesIntegrity(ab, l.integrity), l.id).toBe(true);
      expect(await matchesIntegrity(ab, `sha384-${createHash("sha384").update("x").digest("base64")}`)).toBe(false);
    }
    const calls: string[] = [];
    const fake = (async (u: string) => { calls.push(u); const b = file(u); return new Response(b); }) as unknown as typeof fetch;
    const [a] = await loadPluginLibs(["three"], fake, (l) => l.path);
    const [b, c] = await loadPluginLibs(["three-gltf"], fake, (l) => l.path);
    expect(a).toBe(b);
    expect(c).toContain("GLTFLoader:");
    expect(calls).toEqual(["vendor/three-0.160.0.module.min.js", "vendor/three-gltfloader-0.160.0.min.js"]);
    vi.resetModules();
    const fresh = await import("./pluginLibs");
    const bad = (async () => new Response("tampered")) as unknown as typeof fetch;
    await expect(fresh.loadPluginLibs(["three"], bad, (l) => l.path)).rejects.toThrow(/doesn't match its pinned hash/);
    const gone = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(fresh.loadPluginLibs(["three"], gone, (l) => l.path)).rejects.toThrow(/HTTP 404/);
    expect(await fresh.loadPluginLibs(["three-orbit"], bad)).toEqual([]);
  });
});
