/** Command factories for the MVP timeline. Each wraps a pure domain op. */
import type { Command } from "./engine";
import { DEFAULT_IMAGE_TICKS, newId, trackKindFor, type Asset, type AssetVersion, type Composition, type Placement, type Project, type TrackKind } from "../domain/model";
import * as ops from "../domain/ops";

function withRoot(project: Project, fn: (c: Composition) => Composition): Project {
  const id = project.rootCompositionId;
  const next = fn(project.compositions[id]);
  if (next === project.compositions[id]) return project;
  return { ...project, compositions: { ...project.compositions, [id]: next } };
}

export const importAsset = (asset: Asset): Command => ({
  label: `Import ${asset.name}`,
  apply: (p) => ({ ...p, assets: { ...p.assets, [asset.id]: asset } }),
});

export const removeAsset = (assetId: string): Command => ({
  label: "Remove media",
  apply: (p) => {
    const { [assetId]: _removed, ...rest } = p.assets;
    void _removed;
    return withRoot({ ...p, assets: rest }, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.filter((pl) => pl.source.assetId !== assetId) })) }));
  },
});

export function placementForAsset(asset: Asset, version: AssetVersion, startTicks: number): Placement {
  return {
    id: newId("plc"),
    startTicks,
    durationTicks: asset.kind === "image" ? DEFAULT_IMAGE_TICKS : version.media.durationTicks ?? DEFAULT_IMAGE_TICKS,
    sourceInTicks: 0,
    source: { kind: "assetVersion", assetId: asset.id, versionId: version.id },
    clipType: asset.kind,
    volume: 1,
  };
}

/** Add asset to timeline. Uses given track, else first compatible track, else creates one. */
export const addAssetToTimeline = (assetId: string, startTicks: number, trackId?: string, placementId?: string): Command => ({
  label: "Add to timeline",
  apply: (p) => {
    const asset = p.assets[assetId];
    const version = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
    if (!asset || !version) throw new Error("asset missing");
    const kind: TrackKind = trackKindFor(asset.kind);
    return withRoot(p, (c) => {
      let comp = c;
      let tid = trackId && comp.tracks.find((t) => t.id === trackId && t.kind === kind) ? trackId : comp.tracks.find((t) => t.kind === kind)?.id;
      if (!tid) {
        tid = newId("trk");
        comp = ops.addTrack(comp, kind, tid);
      }
      const pl = placementForAsset(asset, version, startTicks);
      return ops.insertPlacement(comp, tid, placementId ? { ...pl, id: placementId } : pl);
    });
  },
});

export const movePlacement = (id: string, trackId: string, start: number): Command => ({ label: "Move clip", apply: (p) => withRoot(p, (c) => ops.movePlacement(c, id, trackId, start)) });

export const trimPlacement = (id: string, edge: "left" | "right", to: number): Command => ({
  label: "Trim clip",
  apply: (p) =>
    withRoot(p, (c) => {
      const found = c.tracks.flatMap((t) => t.placements).find((pl) => pl.id === id);
      const asset = found && p.assets[found.source.assetId];
      const max = asset?.kind === "image" ? undefined : asset?.versions.find((v) => v.id === found?.source.versionId)?.media.durationTicks;
      return ops.trimPlacement(c, id, edge, to, max);
    }),
});

export const splitPlacement = (id: string, at: number, newIdValue?: string): Command => ({ label: "Split clip", apply: (p) => withRoot(p, (c) => ops.splitPlacement(c, id, at, newIdValue)) });
export const deletePlacement = (id: string): Command => ({ label: "Delete clip", apply: (p) => withRoot(p, (c) => ops.deletePlacement(c, id)) });
export const addTrack = (kind: TrackKind): Command => ({ label: `Add ${kind} track`, apply: (p) => withRoot(p, (c) => ops.addTrack(c, kind)) });
export const toggleTrackMute = (trackId: string): Command => ({
  label: "Toggle mute",
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) })),
});
export const setPlacementVolume = (id: string, volume: number): Command => ({
  label: "Volume",
  coalesceKey: `volume:${id}`,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === id ? { ...pl, volume } : pl)) })) })),
});
export const renameProject = (name: string): Command => ({ label: "Rename project", coalesceKey: "rename", apply: (p) => ({ ...p, name }) });
