/**
 * P38 (item 9): Clean up project. Unused media = assets nothing uses (no clip in any composition, no code effect or
 * transition, no storyboard slot or shot, no binding of a used code clip, not the source of a used asset's version).
 * Old versions = versions of kept assets that are not selected and that no clip, storyboard record or derived version
 * points at. Removing them is one undo step; their files are freed by the next start's storage clean-up.
 */
import type { Asset, AssetVersion, Project } from "./model";
import { codeAssetOf } from "./codeRoles";

export interface UnusedAsset { assetId: string; name: string; kind: Asset["kind"]; blobKeys: string[] }
export interface OldVersion { assetId: string; versionId: string; name: string; index: number; createdAt: string; blobKey: string }
export interface CleanupPlan { unused: UnusedAsset[]; oldVersions: OldVersion[] }

const sel = (a: Asset): AssetVersion | undefined => a.versions.find((v) => v.id === a.selectedVersionId) ?? a.versions[a.versions.length - 1];
const keysOf = (v: AssetVersion) => [v.media.blobKey, ...(v.media.thumbKey ? [v.media.thumbKey] : []), ...(v.media.specKey ? [v.media.specKey] : [])];

/**
 * `bindingRefs`: asset ids (or storyboard asset ids) named by the bindings of code clips in use; the caller reads them
 * from the clips' manifests (the files are not in the project JSON).
 */
export function cleanupPlan(p: Project, bindingRefs: Iterable<string> = []): CleanupPlan {
  const used = new Set<string>(), usedVersions = new Set<string>();
  for (const c of Object.values(p.compositions)) for (const t of c.tracks) for (const pl of t.placements) {
    used.add(pl.source.assetId); usedVersions.add(pl.source.versionId); if (pl.versionId) usedVersions.add(pl.versionId);
    const fx = codeAssetOf(pl.effect?.preset), tr = codeAssetOf(pl.transitionIn?.kind);
    if (fx) used.add(fx);
    if (tr) used.add(tr);
  }
  const sb = p.storyboard;
  const sbText = sb ? JSON.stringify(sb) : "";
  if (sb) {
    for (const s of Object.values(sb.slots ?? {})) if (s.assetId) used.add(s.assetId);
    for (const id of Object.keys(p.assets)) if (sbText.includes(`"${id}"`)) used.add(id);
  }
  for (const r of bindingRefs) used.add(sb?.slots?.[r]?.assetId ?? r);
  // Sources of what is kept stay too (a derived version's inputs, audio taken from a video).
  const queue = [...used];
  while (queue.length) {
    const a = p.assets[queue.pop()!];
    for (const v of a?.versions ?? []) {
      const refs = [...v.provenance.inputs.map((i) => i.assetId), ...(v.provenance.fromVideo ? [v.provenance.fromVideo.assetId] : [])];
      for (const i of v.provenance.inputs) usedVersions.add(i.versionId);
      for (const r of refs) if (!used.has(r)) { used.add(r); queue.push(r); }
    }
  }
  const unused: UnusedAsset[] = [], oldVersions: OldVersion[] = [];
  for (const a of Object.values(p.assets)) {
    if (a.kind === "text" || a.kind === "effect") continue;
    if (!used.has(a.id)) { unused.push({ assetId: a.id, name: a.name, kind: a.kind, blobKeys: a.versions.flatMap(keysOf) }); continue; }
    const keep = sel(a)?.id;
    a.versions.forEach((v, index) => {
      if (v.id === keep || usedVersions.has(v.id) || sbText.includes(`"${v.id}"`)) return;
      oldVersions.push({ assetId: a.id, versionId: v.id, name: a.name, index, createdAt: v.createdAt, blobKey: v.media.blobKey });
    });
  }
  return { unused, oldVersions };
}

/** Remove the chosen assets and versions (only ones the plan lists, so nothing in use can go). */
export function applyCleanup(p: Project, assetIds: string[], versions: { assetId: string; versionId: string }[], bindingRefs: Iterable<string> = []): Project {
  const plan = cleanupPlan(p, bindingRefs);
  const drop = new Set(assetIds.filter((id) => plan.unused.some((u) => u.assetId === id)));
  const dropV = new Set(versions.filter((v) => plan.oldVersions.some((o) => o.assetId === v.assetId && o.versionId === v.versionId)).map((v) => `${v.assetId}/${v.versionId}`));
  const assets: Project["assets"] = {};
  for (const [id, a] of Object.entries(p.assets)) {
    if (drop.has(id)) continue;
    const vs = a.versions.filter((v) => !dropV.has(`${id}/${v.id}`));
    assets[id] = vs.length === a.versions.length ? a : { ...a, versions: vs };
  }
  return { ...p, assets };
}
