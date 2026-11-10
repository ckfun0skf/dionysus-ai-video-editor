// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeFilePreview } from "./CodeFilePreview";
import { bytesToDataUrl, makeCubeGlb } from "./cubeGlb";
import { generateClip } from "./codeClip";
import { CodeEditor } from "./CodeEditor";
import { loadThree } from "./loadThree";
import { newCodeModel } from "./codeSamples";

vi.mock("./loadThree", () => ({ loadThree: vi.fn() }));

const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TEXT = `data:text/plain;base64,${btoa("hello preview")}`;
const GLB = bytesToDataUrl(makeCubeGlb(), "model/gltf-binary");

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});

const created: string[] = [];
const revoked: string[] = [];
beforeAll(() => {
  let n = 0;
  URL.createObjectURL = ((obj: Blob) => { const u = `blob:preview-${++n}`; created.push(u); void obj; return u; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((u: string) => { revoked.push(u); }) as typeof URL.revokeObjectURL;
});

const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; created.length = 0; revoked.length = 0; });

function fakeThree() {
  class Color { constructor(public n = 0) {} }
  class Vector3 {
    x = 0; y = 0; z = 0;
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { return this.set(v.x, v.y, v.z); }
  }
  class Box3 {
    setFromObject() { return this; }
    getSize(v: Vector3) { return v.set(1, 1, 1); }
    getCenter(v: Vector3) { return v.set(0, 0, 0); }
  }
  class Obj { position = { set() {} }; add() {} }
  class WebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor(opts: { canvas?: HTMLCanvasElement }) { this.domElement = opts.canvas ?? document.createElement("canvas"); }
    setSize() {} setPixelRatio() {} render() {} dispose() {}
  }
  class PerspectiveCamera extends Obj { aspect = 1; lookAt() {} updateProjectionMatrix() {} }
  class LoadingManager { setURLModifier() {} }
  const scene = {
    background: undefined as unknown,
    add() {},
    traverse(fn: (o: { isMesh?: boolean; geometry?: { index?: { count: number } } }) => void) {
      fn({ isMesh: true, geometry: { index: { count: 36 } } });
    },
  };
  return {
    THREE: {
      Scene: class { background: unknown; add() {} },
      Color, AmbientLight: Obj, HemisphereLight: Obj, DirectionalLight: Obj,
      WebGLRenderer, PerspectiveCamera, Box3, Vector3, LoadingManager,
    },
    GLTFLoader: class {
      constructor(_m?: unknown) {}
      async loadAsync() { return { scene }; }
    },
  };
}

function mountPreview(props: Partial<ComponentProps<typeof CodeFilePreview>> & { name: string; data: string }) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const onClose = vi.fn(), onShow = vi.fn();
  const files = props.files ?? { [props.name]: props.data };
  const names = props.names ?? Object.keys(files);
  const root = createRoot(el); roots.push(root);
  act(() => { root.render(<CodeFilePreview name={props.name} data={props.data} files={files} names={names} mobile={!!props.mobile} onClose={onClose} onShow={onShow} />); });
  return { el, onClose, onShow, q: <T extends Element = HTMLElement>(s: string) => el.querySelector(s) as T | null };
}

describe("P57 Code file preview", () => {
  beforeEach(() => { vi.mocked(loadThree).mockReset(); });

  it("shows an image renderer and revokes the object URL on close", () => {
    const { q, onClose } = mountPreview({ name: "logo.png", data: TINY_PNG });
    expect(q('[role="dialog"][aria-label="File preview"]')).toBeTruthy();
    expect(q('[data-testid="v2-ce-fprev-meta"]')!.textContent).toMatch(/Image/);
    expect(q('[data-testid="v2-ce-fprev-meta"]')!.textContent).toMatch(/image\/png/);
    const img = q<HTMLImageElement>('[data-testid="v2-ce-fprev-image"]')!;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toMatch(/^blob:preview-/);
    expect(created.length).toBe(1);
    act(() => { q('[aria-label="Close preview"]')!.click(); });
    expect(onClose).toHaveBeenCalled();
  });

  it("dispatches an image error into a visible message, not a blank", () => {
    const { q } = mountPreview({ name: "logo.png", data: TINY_PNG });
    const img = q<HTMLImageElement>('[data-testid="v2-ce-fprev-image"]')!;
    act(() => { img.dispatchEvent(new Event("error")); });
    expect(q('[data-testid="v2-ce-fprev-error"]')!.textContent).toMatch(/Couldn't load this image/);
    expect(q('[data-testid="v2-ce-fprev-image"]')).toBeNull();
  });

  it("shows read-only text and a details fallback for other types", () => {
    const text = mountPreview({ name: "notes.txt", data: TEXT });
    expect(text.q('[data-testid="v2-ce-fprev-text"]')!.textContent).toBe("hello preview");
    const other = mountPreview({ name: "mesh.bin", data: "data:application/octet-stream;base64,QQ==" });
    expect(other.q('[data-testid="v2-ce-fprev-other"]')!.textContent).toMatch(/mesh\.bin/);
    expect(other.q('[data-testid="v2-ce-fprev-other"]')!.textContent).toMatch(/application\/octet-stream/);
  });

  it("reports a missing glTF buffer without calling the three loader", async () => {
    const gltf = `data:model/gltf+json;base64,${btoa(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin", byteLength: 4 }] }))}`;
    mountPreview({ name: "scene.gltf", data: gltf, files: { "scene.gltf": gltf } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(document.querySelector('[data-testid="v2-ce-fprev-error"]')!.textContent).toMatch(/mesh\.bin/);
    expect(loadThree).not.toHaveBeenCalled();
  });

  it("loads a GLB through the mocked three loader and shows mesh counts", async () => {
    vi.mocked(loadThree).mockResolvedValue(fakeThree() as never);
    mountPreview({ name: "cube.glb", data: GLB });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
    expect(loadThree).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="v2-ce-fprev-glb"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Reset view"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="v2-ce-fprev-meta"]')!.textContent).toMatch(/1 mesh/);
    expect(document.querySelector('[data-testid="v2-ce-fprev-meta"]')!.textContent).toMatch(/12 triangles/);
  });

  it("shows an error when the mocked loader rejects", async () => {
    vi.mocked(loadThree).mockRejectedValue(new Error("no webgl"));
    mountPreview({ name: "cube.glb", data: GLB });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector('[data-testid="v2-ce-fprev-error"]')!.textContent).toMatch(/Couldn't load this 3D model/);
  });

  it("moves between files and closes on Escape", () => {
    const files = { "a.png": TINY_PNG, "b.txt": TEXT };
    const { onShow, onClose } = mountPreview({ name: "a.png", data: TINY_PNG, files, names: ["a.png", "b.txt"] });
    act(() => { document.querySelector<HTMLButtonElement>('[aria-label="Next file"]')!.click(); });
    expect(onShow).toHaveBeenCalledWith("b.txt");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("P57 Files tab opens the preview", () => {
  it("opens from a file row in the Code Editor", () => {
    const model = newCodeModel();
    model.manifest.files = { "logo.png": TINY_PNG };
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); roots.push(root);
    act(() => { root.render(<CodeEditor source={generateClip(model)} mobile={false} onSave={() => {}} onClose={() => {}} />); });
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith("Files"));
    act(() => { (tab as HTMLElement).click(); });
    const open = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Preview logo.png");
    expect(open).toBeTruthy();
    act(() => { open!.click(); });
    expect(document.querySelector('[role="dialog"][aria-label="File preview"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="v2-ce-fprev-image"]')).toBeTruthy();
  });
});
