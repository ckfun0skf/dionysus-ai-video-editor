/**
 * P82: Script objects. The code lives in the scene's files as a data: URL (UTF-8), is checked statically (size,
 * imports, the build export, syntax), and the pure edits add one from a template or code, change its code or params,
 * turn it back into a shape and drop files no object uses. The scene page loads it (render/scenePage.ts); the agent
 * tool set_scene_script runs over the same edits.
 */
import { describe, expect, it } from "vitest";
import {
  addSceneScript, applySceneTool, removeSceneObject, removeSceneScript, SAMPLE_SCENE, SCENE_SCRIPT_TEMPLATES, sceneObjectsForAgent, sceneScriptCode,
  sceneTracks, scriptCodeOf, scriptDataUrl, scriptParamsProblem, scriptProblems, setSceneScriptCode, setSceneScriptParams, validateScene, type SceneDoc,
} from ".";
import { sceneEditPage } from "../render/sceneEditPage";
import { scenePage, scenePageKey, SCRIPT_WORKER_JS } from "../render/scenePage";
import { readManifest } from "./htmlClipPackage";

function freeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); }
  return v;
}
const sample = (): SceneDoc => freeze(structuredClone(SAMPLE_SCENE));
const errors = (d: SceneDoc) => validateScene(d).filter((i) => i.level === "error");
const ok = (r: ReturnType<typeof applySceneTool>) => { if (!r.ok) throw new Error(r.error); return r; };
const err = (r: ReturnType<typeof applySceneTool>) => { if (r.ok) throw new Error("expected an error"); return r.error; };
const CODE = "export function build(THREE, params) { return new THREE.Mesh(new THREE.BoxGeometry(params.s, 1, 1)); }\n";

describe("P82 script code", () => {
  it("round-trips code through a data: URL, UTF-8 included, and reads percent-encoded URLs", () => {
    const code = "// 粒子 ✨\nexport function build(THREE) { return new THREE.Group(); }\n";
    const url = scriptDataUrl(code);
    expect(url).toMatch(/^data:text\/javascript;charset=utf-8;base64,/);
    expect(scriptCodeOf(url)).toBe(code);
    expect(scriptCodeOf("data:text/javascript," + encodeURIComponent(code))).toBe(code);
    expect(scriptCodeOf("not a url")).toBeUndefined();
    expect(scriptCodeOf(42)).toBeUndefined();
  });

  it("finds imports, a missing build export, syntax errors and oversized code", () => {
    expect(scriptProblems(CODE)).toEqual([]);
    expect(scriptProblems("export const build = (THREE) => new THREE.Group();")).toEqual([]);
    expect(scriptProblems('import * as T from "three";\n' + CODE).join(" ")).toMatch(/can't import/);
    expect(scriptProblems("const x = await import('x');\n" + CODE).join(" ")).toMatch(/can't import/);
    expect(scriptProblems("export function update() {}").join(" ")).toMatch(/must export a build/);
    expect(scriptProblems("export function build( {").join(" ")).toMatch(/^Syntax error/);
    expect(scriptProblems(CODE + "//" + "x".repeat(256 * 1024)).join(" ")).toMatch(/longer than 256 KB/);
  });

  it("checks params: plain names and number, text or switch values", () => {
    expect(scriptParamsProblem({ a: 1, b_2: "x", c: true })).toBeUndefined();
    expect(scriptParamsProblem([])).toMatch(/must be an object/);
    expect(scriptParamsProblem({ "a-b": 1 })).toMatch(/not a plain name/);
    expect(scriptParamsProblem({ a: Infinity })).toMatch(/not a number/);
    expect(scriptParamsProblem({ a: { x: 1 } })).toMatch(/not a number/);
  });
});

describe("P82 Script objects in a scene", () => {
  it("every template adds a valid Script object with its code in files, selected by id, without changing the input", () => {
    const before = sample();
    for (const t of SCENE_SCRIPT_TEMPLATES) {
      const r = addSceneScript(before, t.id);
      const o = r.doc.objects.find((x) => x.id === r.id)!;
      expect(o.script).toEqual({ file: `${r.id}.js`, params: t.params });
      expect(sceneScriptCode(r.doc, r.id)).toBe(t.code);
      expect(scriptProblems(t.code)).toEqual([]);
      expect(errors(r.doc)).toEqual([]);
    }
    expect(before).toEqual(SAMPLE_SCENE);
    // A second one gets a free id and file.
    const two = addSceneScript(addSceneScript(before, "particles").doc, "particles");
    expect(two.id).toBe("particles-2");
    expect(Object.keys(two.doc.files!)).toEqual(["particles.js", "particles-2.js"]);
  });

  it("sets code and params, turns a script back into a shape, and drops files no object uses", () => {
    const a = addSceneScript(sample(), "empty");
    const b = setSceneScriptCode(freeze(a.doc), a.id, CODE);
    expect(sceneScriptCode(b, a.id)).toBe(CODE);
    expect(setSceneScriptCode(b, a.id, CODE)).toBe(b); // same code: no change
    const c = setSceneScriptParams(freeze(b), a.id, { s: 2 });
    expect(c.objects.find((o) => o.id === a.id)!.script).toEqual({ file: "empty.js", params: { s: 2 } });
    expect(setSceneScriptParams(c, a.id, {}).objects.find((o) => o.id === a.id)!.script).toEqual({ file: "empty.js" });
    const d = removeSceneScript(freeze(c), a.id);
    expect(d.objects.find((o) => o.id === a.id)!.script).toBeUndefined();
    expect(d.files).toBeUndefined();
    const e = removeSceneObject(freeze(c), a.id);
    expect(e.doc.files).toBeUndefined();
    // A plain shape becomes a Script object when it gets code.
    const f = setSceneScriptCode(sample(), "cube", CODE);
    expect(f.objects.find((o) => o.id === "cube")!.script).toEqual({ file: "cube.js" });
    expect(errors(f)).toEqual([]);
  });

  it("validates the script field: shape, model and script together, missing or bad files, params and unknown keys", () => {
    const base = addSceneScript(sample(), "empty").doc;
    const withObj = (script: unknown, extra: Record<string, unknown> = {}): SceneDoc => ({ ...base, objects: [...base.objects.slice(0, -1), { ...base.objects.at(-1)!, script, ...extra } as never] });
    const msgs = (d: SceneDoc) => validateScene(d).map((i) => `${i.level} ${i.path} ${i.message}`).join("\n");
    expect(msgs(withObj("x.js"))).toMatch(/error objects\[4\]\.script must be \{ "file"/);
    expect(msgs(withObj({ file: "empty.js" }, { model: "empty.js" }))).toMatch(/a model or a script, not both/);
    expect(msgs(withObj({ file: "nope.js" }))).toMatch(/warning objects\[4\]\.script\.file "nope\.js" is not in "files"/);
    expect(msgs(withObj({ file: "empty.js", params: { "bad name": 1 } }))).toMatch(/error objects\[4\]\.script\.params/);
    expect(msgs(withObj({ file: "empty.js", extra: 1 }))).toMatch(/error objects\[4\]\.script\.extra is not a script field/);
    const broken = { ...base, files: { "empty.js": scriptDataUrl("export function build( {") } };
    expect(msgs(broken)).toMatch(/error objects\[4\]\.script\.file Syntax error/);
  });

  it("gives Script objects their own track kind and changes the page key (and the page) when the code changes", () => {
    const a = addSceneScript(sample(), "particles");
    const t = sceneTracks(a.doc).find((x) => x.id === a.id)!;
    expect(t).toMatchObject({ kind: "script", detail: "script particles.js" });
    const b = setSceneScriptCode(a.doc, a.id, CODE);
    expect(scenePageKey(b)).not.toBe(scenePageKey(a.doc));
    expect(scenePageKey(setSceneScriptParams(a.doc, a.id, { count: 10 }))).not.toBe(scenePageKey(a.doc));
    // The page carries the files, and only three.js as a library (no GLTFLoader without models).
    for (const page of [scenePage(a.doc), sceneEditPage(a.doc)]) {
      const m = readManifest(page)!;
      expect(Object.keys(m.files ?? {})).toEqual(["particles.js"]);
      expect(m.libs).not.toContain("three-gltf");
      expect(page).toContain("loadScripts");
    }
  });

  it("runs scripts in a check worker under a time limit first; scripts get a seeded random and no clock", () => {
    expect(SCRIPT_WORKER_JS).toContain("onmessage");
    expect(SCRIPT_WORKER_JS).toContain("mod.build(THREE, params, ctx)");
    expect(scenePage(addSceneScript(sample(), "particles").doc)).toMatch(/SCRIPT_LIMIT_MS = 3000/);
    expect(SCRIPT_WORKER_JS).not.toMatch(/Math\.random|Date\.now/);
  });
});

describe("P82 set_scene_script (agent)", () => {
  it("adds a Script object from a template or code, with an id, params and position", () => {
    const a = ok(applySceneTool("set_scene_script", sample(), { template: "particles", id: "sparks", params: { count: 50 }, position: [0, 1, 0] }));
    expect(a.info.objectId).toBe("sparks");
    expect(a.doc.objects.at(-1)).toMatchObject({ id: "sparks", position: [0, 1, 0], script: { file: "particles.js", params: { count: 50 } } });
    const b = ok(applySceneTool("set_scene_script", sample(), { code: CODE, id: "crate", params: { s: 2 } }));
    expect(b.doc.objects.at(-1)).toMatchObject({ id: "crate", script: { file: "crate.js", params: { s: 2 } } });
    expect(sceneScriptCode(b.doc, "crate")).toBe(CODE);
  });

  it("changes code, template or params of a Script object, makes a shape a Script object, and turns it back", () => {
    const a = ok(applySceneTool("set_scene_script", sample(), { template: "empty", id: "knot" }));
    const b = ok(applySceneTool("set_scene_script", freeze(a.doc), { objectId: "knot", code: CODE, params: { s: 3 } }));
    expect(sceneScriptCode(b.doc, "knot")).toBe(CODE);
    expect(b.doc.objects.at(-1)!.script!.params).toEqual({ s: 3 });
    const c = ok(applySceneTool("set_scene_script", freeze(b.doc), { objectId: "knot", template: "text" }));
    expect(c.doc.objects.at(-1)!.script!.params).toMatchObject({ text: "Hello" });
    const d = ok(applySceneTool("set_scene_script", sample(), { objectId: "cube", template: "shape" }));
    expect(d.doc.objects.find((o) => o.id === "cube")!.script).toBeTruthy();
    const e = ok(applySceneTool("set_scene_script", freeze(c.doc), { objectId: "knot", remove: true }));
    expect(e.doc.objects.at(-1)!.script).toBeUndefined();
    expect(e.doc.files).toBeUndefined();
  });

  it("refuses bad input with what to fix, and nothing changes", () => {
    expect(err(applySceneTool("set_scene_script", sample(), {}))).toMatch(/Give "template" \(particles, shape, text, empty\) or "code"/);
    expect(err(applySceneTool("set_scene_script", sample(), { template: "fire" }))).toMatch(/"template" must be one of/);
    expect(err(applySceneTool("set_scene_script", sample(), { code: "import x from 'y';" }))).toMatch(/can't import/);
    expect(err(applySceneTool("set_scene_script", sample(), { code: CODE, params: { "a b": 1 } }))).toMatch(/"params" has a param name/);
    expect(err(applySceneTool("set_scene_script", sample(), { objectId: "cube" }))).toMatch(/not a Script object yet/);
    expect(err(applySceneTool("set_scene_script", sample(), { objectId: "cube", remove: true }))).toMatch(/not a Script object/);
    expect(err(applySceneTool("set_scene_script", sample(), { objectId: "nope", code: CODE }))).toMatch(/No object "nope"/);
    expect(err(applySceneTool("set_scene_script", sample(), { code: CODE, id: "cube" }))).toMatch(/"id": .*already used/);
  });

  it("list_scene_objects gives each Script object's code and the templates", () => {
    const a = ok(applySceneTool("set_scene_script", sample(), { code: CODE, id: "crate" }));
    const l = sceneObjectsForAgent(a.doc);
    expect(l.objects.find((o) => o.id === "crate")).toMatchObject({ script: { file: "crate.js", code: CODE } });
    expect(l.scriptTemplates.map((t) => t.id)).toEqual(["particles", "shape", "text", "empty"]);
  });
});
