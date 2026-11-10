import { describe, expect, it } from "vitest";
import {
  dataUrlBytes, dataUrlToBlob, decodeTextDataUrl, fileExt, findAttachedName, formatBytes, gltfExternalUris,
  kindLabel, meshStats, mimeOf, missingGltfExternals, missingGltfMessage, previewKind,
} from "./codeFilePreview";
import { bytesToDataUrl, makeCubeGlb } from "./cubeGlb";

const PNG = "data:image/png;base64,AAAA";
const textUrl = (s: string, mime = "text/plain") => `data:${mime};base64,${btoa(s)}`;

describe("P57 file preview helpers", () => {
  it("detects type from extension and data: MIME", () => {
    expect(previewKind("a.PNG")).toBe("image");
    expect(previewKind("b.jpg")).toBe("image");
    expect(previewKind("c.webp")).toBe("image");
    expect(previewKind("d.gif")).toBe("image");
    expect(previewKind("icon.svg")).toBe("image");
    expect(previewKind("clip.mp4")).toBe("video");
    expect(previewKind("song.mp3")).toBe("audio");
    expect(previewKind("model.glb")).toBe("model");
    expect(previewKind("model.gltf")).toBe("model");
    expect(previewKind("notes.txt")).toBe("text");
    expect(previewKind("data.json")).toBe("text");
    expect(previewKind("app.js")).toBe("text");
    expect(previewKind("skin.css")).toBe("text");
    expect(previewKind("page.html")).toBe("text");
    expect(previewKind("mesh.bin")).toBe("other");
    expect(previewKind("font.woff2")).toBe("other");
    expect(previewKind("blob", "data:image/webp;base64,AA")).toBe("image");
    expect(previewKind("blob", "data:video/mp4;base64,AA")).toBe("video");
    expect(previewKind("blob", "data:audio/mpeg;base64,AA")).toBe("audio");
    expect(fileExt("Foo.Bar.GLB")).toBe("glb");
  });

  it("selects a renderer kind and labels it", () => {
    expect(kindLabel(previewKind("pic.jpeg"))).toBe("Image");
    expect(kindLabel(previewKind("a.gltf"))).toBe("3D model");
    expect(kindLabel(previewKind("a.bin"))).toBe("File");
    expect(mimeOf("cube.glb", bytesToDataUrl(makeCubeGlb(), "model/gltf-binary"))).toBe("model/gltf-binary");
    expect(mimeOf("notes.txt")).toBe("text/plain");
    expect(formatBytes(200)).toBe("200 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(dataUrlBytes(PNG)).toBe(Math.round(4 * 0.75));
  });

  it("decodes text and reports a load error for a bad data URL", () => {
    expect(decodeTextDataUrl(textUrl("hello {\"a\":1}"))).toBe("hello {\"a\":1}");
    expect(() => decodeTextDataUrl("not-data")).toThrow(/Couldn't read this file as text/);
    expect(() => dataUrlToBlob("zzz")).toThrow(/Couldn't read this file/);
    const blob = dataUrlToBlob(textUrl("hi"));
    expect(blob.type).toBe("text/plain");
  });

  it("resolves glTF external buffers against other attached files", () => {
    const json = { asset: { version: "2.0" }, buffers: [{ uri: "buffers/mesh.bin", byteLength: 4 }], images: [{ uri: "data:image/png;base64,AA" }] };
    expect(gltfExternalUris(json)).toEqual(["buffers/mesh.bin"]);
    expect(findAttachedName({ "mesh.bin": "data:application/octet-stream;base64,AA" }, "buffers/mesh.bin")).toBe("mesh.bin");
    expect(missingGltfExternals(JSON.stringify(json), { "mesh.bin": "data:," })).toEqual([]);
    expect(missingGltfExternals(JSON.stringify(json), {})).toEqual(["mesh.bin"]);
    expect(missingGltfMessage(["mesh.bin"])).toBe("This glTF needs \"mesh.bin\" attached as well, or use a .glb.");
    expect(missingGltfMessage(["a.bin", "b.png"])).toBe("This glTF needs \"a.bin\" and \"b.png\" attached as well, or use a .glb.");
    expect(() => missingGltfExternals("not-json", {})).toThrow(/Couldn't read this glTF file/);
  });

  it("counts meshes and triangles from a scene graph", () => {
    const scene = {
      traverse(fn: (o: { isMesh?: boolean; geometry?: { index?: { count: number }; attributes?: { position?: { count: number } } } }) => void) {
        fn({ isMesh: true, geometry: { index: { count: 36 } } });
        fn({ isMesh: true, geometry: { attributes: { position: { count: 9 } } } });
        fn({ isMesh: false });
      },
    };
    expect(meshStats(scene)).toEqual({ meshes: 2, triangles: 15 });
  });

  it("builds a valid GLB header for the cube fixture", () => {
    const bytes = makeCubeGlb();
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("glTF");
    expect(new DataView(bytes.buffer, bytes.byteOffset, 12).getUint32(4, true)).toBe(2);
    expect(bytesToDataUrl(bytes, "model/gltf-binary")).toMatch(/^data:model\/gltf-binary;base64,/);
  });
});
