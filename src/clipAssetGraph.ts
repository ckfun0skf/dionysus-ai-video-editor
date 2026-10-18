import type { Asset } from "./types";

/** Returns the child Clip Assets directly referenced by a Clip Asset's saved versions. */
export function getReferencedClipAssetIds(parent: Asset, assets: Asset[]): string[] {
  if (parent.kind !== "clip") return [];
  const knownClipIds = new Set(assets.filter(asset => asset.kind === "clip").map(asset => asset.id));
  const referenced = new Set<string>();

  for (const version of parent.clipVersions ?? []) {
    for (const layer of version.layers) {
      if (layer.assetId && knownClipIds.has(layer.assetId)) referenced.add(layer.assetId);
      if (layer.childCompositionId && knownClipIds.has(layer.childCompositionId)) referenced.add(layer.childCompositionId);
    }
  }

  return [...referenced];
}

/**
 * Returns true when adding parent -> child would create a direct or indirect cycle.
 * A Clip Asset may only reference another Clip Asset when traversing from that child
 * cannot reach the proposed parent.
 */
export function wouldCreateClipAssetCycle(assets: Asset[], parentId: string, childId: string): boolean {
  if (parentId === childId) return true;

  const byId = new Map(assets.filter(asset => asset.kind === "clip").map(asset => [asset.id, asset]));
  if (!byId.has(parentId) || !byId.has(childId)) return false;

  const visited = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === parentId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const current = byId.get(currentId);
    if (current) stack.push(...getReferencedClipAssetIds(current, assets));
  }
  return false;
}

/** Finds the first cyclic reference in a collection of Clip Assets, if one exists. */
export function findClipAssetCycle(assets: Asset[]): string[] | undefined {
  const clipAssets = assets.filter(asset => asset.kind === "clip");
  for (const parent of clipAssets) {
    for (const childId of getReferencedClipAssetIds(parent, assets)) {
      if (wouldCreateClipAssetCycle(assets, parent.id, childId)) return [parent.id, childId];
    }
  }
  return undefined;
}

/** Safe selector choices for nesting one existing Clip Asset inside another. */
export function getAllowedChildClipAssets(assets: Asset[], parentId: string): Asset[] {
  return assets.filter(asset =>
    asset.kind === "clip" &&
    asset.id !== parentId &&
    !wouldCreateClipAssetCycle(assets, parentId, asset.id)
  );
}
