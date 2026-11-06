import { describe, expect, it } from "vitest";
import { selectedLibraries } from "../render/htmlLibs";
import { withRuntime } from "../render/htmlClip";
import { CODE_FILE_ACCEPT, MODEL_EXT, withModelMime } from "./CodeEditor";
import { writeManifest } from "../domain";

describe("P38 3D files in code clips", () => {
  it("accepts glb/gltf/bin/hdr and stores glb as model/gltf-binary", () => {
    for (const e of [".glb", ".gltf", ".bin", ".hdr"]) expect(CODE_FILE_ACCEPT).toContain(e);
    expect(MODEL_EXT.test("a.GLB")).toBe(true);
    expect(withModelMime("a.glb", "data:application/octet-stream;base64,AAA")).toBe("data:model/gltf-binary;base64,AAA");
    expect(withModelMime("a.gltf", "data:;base64,AAA")).toBe("data:model/gltf+json;base64,AAA");
    expect(withModelMime("a.png", "data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });
  it("three-gltf brings three into the import map", () => {
    const html = writeManifest('<script type="module">import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";</script>', { format: "dionysus.htmlclip/1", libs: ["three-gltf"] });
    expect(selectedLibraries(html).map((l) => l.id)).toEqual(["three", "three-gltf"]);
    const page = withRuntime(html, (l) => `https://x/${l.path}`);
    expect(page).toContain('"three":"https://x/vendor/three-0.160.0.module.min.js"');
    expect(page).toContain('"three/addons/loaders/GLTFLoader.js":"https://x/vendor/three-gltfloader-0.160.0.min.js"');
  });
});
