import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import type { Asset, ClipVersion } from "./types";
import { findClipAssetCycle, getAllowedChildClipAssets, getReferencedClipAssetIds, wouldCreateClipAssetCycle } from "./clipAssetGraph";
import { validateProject } from "./projectValidation";

function clipAsset(id: string, childIds: string[] = []): Asset {
  const version: ClipVersion = {
    id: id + "-version-1",
    name: "Version A",
    description: "",
    duration: 5,
    layers: childIds.map((childId, index) => ({
      id: id + "-layer-" + index,
      name: "Nested " + childId,
      kind: "composition",
      start: 0,
      duration: 5,
      assetId: childId,
      childCompositionId: childId,
    })),
    scriptVersionIds: [],
    generationRecords: [],
  };
  return {
    id,
    name: id,
    kind: "clip",
    canvasWidth: 1920,
    canvasHeight: 1080,
    clipVersions: [version],
    selectedClipVersionId: version.id,
  };
}

describe("Clip Asset reference graph", () => {
  it("permits a child when it does not contain the proposed parent", () => {
    const assets = [clipAsset("A"), clipAsset("B", ["A"])];
    expect(wouldCreateClipAssetCycle(assets, "A", "B")).toBe(true);
    expect(wouldCreateClipAssetCycle(assets, "B", "A")).toBe(false);
  });

  it("rejects direct self-reference", () => {
    const assets = [clipAsset("A")];
    expect(wouldCreateClipAssetCycle(assets, "A", "A")).toBe(true);
  });

  it("detects indirect A -> B -> C -> A cycles", () => {
    const assets = [clipAsset("A", ["B"]), clipAsset("B", ["C"]), clipAsset("C")];
    expect(wouldCreateClipAssetCycle(assets, "C", "A")).toBe(true);
    expect(findClipAssetCycle(assets)).toBeUndefined();
    const cyclic = [clipAsset("A", ["B"]), clipAsset("B", ["C"]), clipAsset("C", ["A"])];
    expect(findClipAssetCycle(cyclic)).toEqual(["A", "B"]);
  });

  it("filters the current Clip and descendants that would create a loop", () => {
    const assets = [clipAsset("A", ["B"]), clipAsset("B"), clipAsset("C")];
    expect(getAllowedChildClipAssets(assets, "A").map(asset => asset.id).sort()).toEqual(["C"]);
  });

  it("collects direct nested Clip Asset references from each saved version", () => {
    const assets = [clipAsset("A", ["B", "C"]), clipAsset("B"), clipAsset("C"), { id: "video", name: "video", kind: "video" }];
    expect(getReferencedClipAssetIds(assets[0], assets).sort()).toEqual(["B", "C"]);
  });

  it("rejects imported project JSON that contains an indirect Clip Asset cycle", () => {
    const base = JSON.parse(JSON.stringify(sampleProject));
    base.assets = [...base.assets, clipAsset("A", ["B"]), clipAsset("B", ["C"]), clipAsset("C", ["A"])];
    expect(validateProject(base)).toBe(false);
  });
});
