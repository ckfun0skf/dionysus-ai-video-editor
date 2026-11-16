// @vitest-environment jsdom
/**
 * P75 (Phase 2 step 2.2) in the UI: adding a GLB model to a scene from the Scene tab (a new version, one undo step),
 * scene assets in the picker's project list, the Scene tool on the phone clip toolbar, and no `volume` on scene clips.
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createProject, parseScene, SAMPLE_SCENE, versionOfPlacement, type Project } from "../domain";
import { Engine, cmd } from "../engine";
import { placementForAsset } from "../engine/commands";
import { clipUi } from "./clipTypeUi";
import { makeAnimatedGlb } from "./cubeGlb";
import { MediaPicker } from "./MediaPicker";
import { projectMediaList } from "./projectMedia";
import { ScenePanel } from "./ScenePanel";
import { sceneAsset } from "./sceneAsset";

const S = 120_000;
const readText = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const memBlobs = () => {
  const m = new Map<string, Blob & { text(): Promise<string> }>();
  return { m, put: async (k: string, b: Blob) => { const t = await readText(b); m.set(k, Object.assign(b, { text: async () => t })); }, get: async (k: string) => m.get(k), delete: async () => undefined, keys: async () => [...m.keys()] };
};
const clips = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

async function setup() {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, SAMPLE_SCENE);
  const e = new Engine(createProject("scene"));
  e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
  return { e, blobs, asset };
}

describe("P75 scene models in the UI", () => {
  it("Add GLB model embeds the file in a new scene version (one undo step) and lists its animations", async () => {
    const { e, blobs, asset } = await setup();
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    const draw = () => { const p = e.getState().project; root.render(<ScenePanel project={p} placement={clips(p)[0]} blobs={blobs as never} engine={e} />); };
    await act(async () => draw()); await settle();
    const button = [...el.querySelectorAll("button")].find((b) => /Add GLB model/.test(b.textContent ?? ""))!;
    expect(button).toBeTruthy();
    const input = el.querySelector<HTMLInputElement>('[data-testid="scene-model-input"]')!;
    expect(input.accept).toBe(".glb,model/gltf-binary");
    const file = new File([makeAnimatedGlb()], "bot.glb", { type: "model/gltf-binary" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle(); await act(async () => draw()); await settle();
    const p = e.getState().project;
    expect(p.assets[asset.id].versions).toHaveLength(2);
    const v = versionOfPlacement(p, clips(p)[0])!;
    expect(v.id).toBe(p.assets[asset.id].selectedVersionId);
    const doc = parseScene(await blobs.m.get(v.media.blobKey)!.text());
    expect(doc.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(doc.doc!.objects.at(-1)).toMatchObject({ id: "bot", model: "bot.glb", animation: "Wave" });
    expect(doc.doc!.files!["bot.glb"]).toMatch(/^data:model\/gltf-binary;base64,/);
    expect(el.querySelector('[aria-label="Scene objects"]')!.textContent).toMatch(/bot\s*model bot\.glb.*animations: Wave, Spin, Bounce/);
    expect(el.querySelector('[role="status"]')!.textContent).toMatch(/Added “bot” \(bot\.glb\)/);
    expect(cmd.addAssetVersion(asset.id, v, "sc", { label: "Add 3D model" }).label).toBe("Add 3D model");
    e.undo();
    expect(e.getState().project.assets[asset.id].versions).toHaveLength(1);
    act(() => root.unmount()); el.remove();
  });

  it("the picker's Code tab lists the project's scenes (no preview button), and adding one gives no volume", async () => {
    const { e, asset } = await setup();
    const media = projectMediaList(e.getState().project);
    expect(media.map((m) => [m.kind, m.name])).toEqual([["scene", "3D scene"]]);
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    let added: unknown;
    await act(async () => { root.render(<MediaPicker title="Add media" media={media} initialTab="code" onAdd={(p) => { added = p; }} onClose={() => undefined} loadMedia={async () => undefined} />); });
    const tile = el.querySelector<HTMLButtonElement>(".v2-pick-tile.kind-scene")!;
    expect(tile.getAttribute("aria-label")).toBe("3D scene");
    expect(el.querySelector('[aria-label="Preview 3D scene"]')).toBeNull();
    await act(async () => { tile.click(); });
    await act(async () => { [...el.querySelectorAll("button")].find((b) => b.textContent === "Add" || /^Add/.test(b.textContent ?? "") && b.className.includes("primary"))!.click(); });
    expect(added).toMatchObject({ assets: [asset.id] });
    act(() => root.unmount()); el.remove();
    const p = e.getState().project;
    expect("volume" in placementForAsset(p.assets[asset.id], p.assets[asset.id].versions[0], 0)).toBe(false);
    expect(clips(p)[0].volume).toBeUndefined();
    e.dispatch(cmd.addAssetToTimeline(asset.id, 10 * S));
    expect(clips(e.getState().project).map((c) => c.volume)).toEqual([undefined, undefined]);
  });

  it("existing types keep volume 1 when added; the phone toolbar starts with Scene", () => {
    for (const kind of ["video", "image", "audio", "html"] as const) {
      const a = { id: `a-${kind}`, kind, name: kind, versions: [{ id: "v", createdAt: "", media: { blobKey: "k", mime: "x" }, provenance: { source: "import" as const, inputs: [] } }] };
      expect(placementForAsset(a, a.versions[0], 0).volume).toBe(1);
    }
    const pl = { id: "s", startTicks: 0, durationTicks: S, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "scene" as const };
    expect(clipUi(pl).toolbarMain[0]).toBe("scene");
  });
});
