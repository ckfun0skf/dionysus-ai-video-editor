import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { readManifest, SAMPLE_SCENE, type SceneDoc } from "../domain";
import { BENCHMARK_SHOT } from "../domain/__fixtures__/benchmarkShot";
import { scenePage, scenePageKey } from "./scenePage";
import { sceneEditPage, sceneEditPageKey } from "./sceneEditPage";
import { libById } from "./htmlLibs";

/** The page's module script (the scene runtime) — compiled, never run, so a syntax error in the template fails here. */
const moduleOf = (html: string) => html.split('<script type="module">')[1].split("</script>")[0];
const compiles = (html: string) => transformSync(moduleOf(html), { format: "esm", loader: "js", target: "es2022" });

describe("Scene Phase 1 (#350): the scene pages", () => {
  it("an old scene's page lists no new libraries; a scene with a look loads the vendored look addons and its files", () => {
    expect(readManifest(scenePage(SAMPLE_SCENE))).toEqual({});
    const m = readManifest(scenePage(BENCHMARK_SHOT));
    expect(m.libs).toEqual(["three", "three-look"]);
    expect(Object.keys(m.files ?? {})).toEqual(["fireflies.js"]);
    expect(readManifest(sceneEditPage(BENCHMARK_SHOT)).libs).toEqual(["three", "three-orbit", "three-transform", "three-look"]);
    // Toon materials or fog alone need no addon; an .hdr environment does.
    const toon: SceneDoc = { format: "dionysus.scene/1", world: { fog: {} }, objects: [{ id: "a", material: "toon" }] };
    expect(readManifest(scenePage(toon))).toEqual({});
    const hdr: SceneDoc = { format: "dionysus.scene/1", world: { environment: { file: "sky.hdr" } }, objects: [], files: { "sky.hdr": "data:application/octet-stream;base64,AA==" } };
    expect(readManifest(scenePage(hdr))).toEqual({ libs: ["three", "three-look"], files: { "sky.hdr": "data:application/octet-stream;base64,AA==" } });
    expect(libById("three-look")).toMatchObject({ version: "0.160.0", path: "vendor/three-look-0.160.0.min.js", requires: ["three"], editorOnly: true });
  });

  it("the generated page code compiles (clip page and Edit view, with and without a look)", () => {
    for (const d of [SAMPLE_SCENE, BENCHMARK_SHOT]) { expect(() => compiles(scenePage(d))).not.toThrow(); expect(() => compiles(sceneEditPage(d))).not.toThrow(); }
    const js = moduleOf(scenePage(BENCHMARK_SHOT));
    // Determinism: the composer never reads its clock (sceneClip.test checks the page uses no clock or unseeded random).
    expect(js).toContain("composer.render(0)");
  });

  it("the page is rebuilt when the look's structure changes, not when its animated values do", () => {
    const d = structuredClone(BENCHMARK_SHOT);
    const k = scenePageKey(d);
    expect(scenePageKey({ ...d, world: { ...d.world, post: { ...d.world!.post, exposure: 2, vignette: 0.5 } } })).toBe(k);
    expect(scenePageKey({ ...d, world: { ...d.world, fog: { ...d.world!.fog, near: 3 } } })).toBe(k);
    expect(scenePageKey({ ...d, world: { ...d.world, post: { ...d.world!.post, aa: "fxaa" } } })).not.toBe(k);
    expect(scenePageKey({ ...d, world: { ...d.world, sky: undefined } })).not.toBe(k);
    expect(scenePageKey({ ...d, objects: d.objects.map((o) => (o.id === "house" ? { ...o, material: "unlit" as const } : o)) })).not.toBe(k);
    // The Edit view: a shadow switch rebuilds it (it is set up once), a light's colour does not.
    const lights = d.world!.lights!;
    const e = sceneEditPageKey(d);
    expect(sceneEditPageKey({ ...d, world: { ...d.world, lights: lights.map((l, i) => (i === 1 ? { ...l, color: "#ffffff" } : l)) } })).toBe(e);
    expect(sceneEditPageKey({ ...d, world: { ...d.world, lights: lights.map((l, i) => (i === 1 ? { ...l, shadow: undefined } : l)) } })).not.toBe(e);
  });
});
