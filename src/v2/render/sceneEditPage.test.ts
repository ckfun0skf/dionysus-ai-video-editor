/**
 * P81a: the scene editor's Edit view page: the scene page's build part plus the editor runtime, with the editor-only
 * control libraries pinned in its import map; those libraries are never offered to clips.
 */
import { describe, expect, it } from "vitest";
import { readManifest, SAMPLE_SCENE, type SceneDoc } from "../domain";
import { bytesToDataUrl, makeAnimatedGlb } from "../ui/cubeGlb";
import { withRuntime } from "./htmlClip";
import { CLIP_HTML_LIBRARIES, CLIP_LIBRARIES, detectLibraries, HTML_LIBRARIES, libById, selectedLibraries } from "./htmlLibs";
import { sceneEditPage, SCENE_EDIT_JS } from "./sceneEditPage";
import { SCENE_BUILD_JS, scenePage, SCENE_RUNTIME_JS } from "./scenePage";

describe("P81a Edit view page", () => {
  it("is the scene page's build part plus the editor runtime (the clip page is unchanged)", () => {
    expect(SCENE_RUNTIME_JS.startsWith(SCENE_BUILD_JS)).toBe(true);
    expect(SCENE_RUNTIME_JS.slice(SCENE_BUILD_JS.length).startsWith("dionysus.clip({")).toBe(true);
    expect(SCENE_BUILD_JS).not.toContain("dionysus.clip");
    const page = sceneEditPage(SAMPLE_SCENE);
    expect(page).toContain(SCENE_BUILD_JS + SCENE_EDIT_JS);
    expect(page).not.toContain("dionysus.clip(");
    expect(scenePage(SAMPLE_SCENE)).not.toContain("OrbitControls");
    for (const t of ["scene-edit:ready", "scene-edit:state", "scene-edit:pick", "scene-edit:drag", "scene-edit:home", "scene-edit:cancel", "e.source !== parent", "GridHelper", "TransformControls(view, canvas)", "OrbitControls(view, canvas)", "tc.reset()"]) expect(SCENE_EDIT_JS).toContain(t);
    // It never draws timeline frames and never asks for the clip clock.
    expect(SCENE_EDIT_JS).not.toContain("dionysus:frame");
  });

  it("pins three.js and the two controls (GLTFLoader and files only with models) in the import map with SRI", () => {
    const url = (l: { path: string }) => `https://x.test/app/${l.path}`;
    expect(readManifest(sceneEditPage(SAMPLE_SCENE))).toEqual({ libs: ["three", "three-orbit", "three-transform"] });
    const glb = bytesToDataUrl(makeAnimatedGlb(), "model/gltf-binary");
    const robot: SceneDoc = { format: "dionysus.scene/1", files: { "bot.glb": glb }, objects: [{ id: "bot", model: "bot.glb", size: 1.6 }] };
    const m = readManifest(sceneEditPage(robot));
    expect(m.libs).toEqual(["three", "three-orbit", "three-transform", "three-gltf"]);
    expect(m.files).toEqual({ "bot.glb": glb });
    const embedded = sceneEditPage(robot).split('id="dionysus-scene">')[1].split("</script>")[0];
    expect(embedded).not.toContain("data:model"); // the files go in the manifest only, not the embedded scene
    const out = withRuntime(sceneEditPage(SAMPLE_SCENE), url);
    for (const id of ["three", "three-orbit", "three-transform"]) {
      const l = libById(id)!;
      expect(out).toContain(`"${l.specifier}":"${url(l)}"`);
      expect(out).toContain(`"${url(l)}":"${l.integrity}"`);
    }
    expect(out).not.toContain("three-gltfloader");
  });

  it("the editor-only libraries are not offered to clips (picker, AI prompts, lint, detection)", () => {
    const editorOnly = HTML_LIBRARIES.filter((l) => l.editorOnly).map((l) => l.id);
    expect(editorOnly).toEqual(["three-orbit", "three-transform"]);
    expect(CLIP_HTML_LIBRARIES.map((l) => l.id)).toEqual(["three", "three-gltf"]);
    expect(CLIP_LIBRARIES.map((l) => l.id)).toEqual(["three", "three-gltf"]);
    const clip = 'import * as T from "three"; import { OrbitControls } from "three/addons/controls/OrbitControls.js";';
    expect(detectLibraries(clip)).toEqual(["three"]);
    expect(selectedLibraries(clip).map((l) => l.id)).toEqual(["three"]);
  });
});
